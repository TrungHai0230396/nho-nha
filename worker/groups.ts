// "Nhắc chung": groups of people who all see a group's notes, change them,
// and are reminded of them. The notes themselves sync like anyone's
// (worker/notes.ts); this is the groups around them: making one, the
// invite, joining, leaving, the owner's few powers.
//
// The invite is `<group id>.<HMAC of the id and its version>`, so nothing
// secret is stored and any member can always show it; renewing it (the
// owner) bumps the version and every older link stops working.
import { GROUP_ID, LIMITS, type GroupInfo, type PushMessage } from "../src/shared/protocol";
import { HOUR } from "../src/shared/wall";
import { hmacHex, randomToken, sameText } from "./crypto";
import { isObject, json, readJson } from "./http";
import { sendAll, subsOf, type SendDeps } from "./push";
import { asleep, quietOf } from "./quiet";
import type { Row, Sql, Stmt, UserSql } from "./sql";

/**
 * Times a group may ring its members in an hour, its reminders and its
 * news together, "nhắc dai" included: a family's busiest hour is well under
 * it. Past it, one notification says so and the rest of that hour is quiet,
 * whoever filled the group with reminders (Hải, 13/10/2026: what if it spams?).
 */
export const GROUP_RINGS_PER_HOUR = 20;
/** The hour a group's rings are counted in. */
export const ringWindow = (now: number) => Math.floor(now / HOUR);
/** Counts `?3` more rings for group ?1 in hour ?2 and gives back the hour's count. */
const RING_SQL = `UPDATE groups SET ring_n = CASE WHEN ring_win = ?2 THEN ring_n + ?3 ELSE ?3 END, ring_win = ?2
  WHERE id = ?1 RETURNING ring_n`;

const CODE = /^(g_[A-Za-z0-9_-]{22})\.([0-9a-f]{32})$/;

/** 'g_' and 22 characters: never the length of a user id (22), whose place its notes take. */
export const newGroupId = () => `g_${randomToken(16)}`;

async function token(secret: string, id: string, v: number): Promise<string> {
  return (await hmacHex(secret, `invite:${id}:${v}`)).slice(0, 32);
}

export async function inviteCode(secret: string, id: string, v: number): Promise<string> {
  return `${id}.${await token(secret, id, v)}`;
}

/** A name as people type it: one line, trimmed, inside its limit; null when nothing is left. */
export function cleanName(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

/** The groups a person is in, with their members (the owner first, then by when they joined), as sync and the screens see them. */
// `push`: has notifications on somewhere. A reminder given to someone who has
// none never reaches them, and whoever watches it would hear "chưa bấm Xong"
// every time: the app says so before that happens.
export const MY_GROUPS_SQL = `SELECT g.id, g.name, g.owner_id = ?1 AS owner, g.rev, g.invite_v,
    (SELECT COUNT(*) FROM notes n WHERE n.user_id = g.id AND n.deleted = 0) AS open,
    (SELECT name FROM group_members WHERE group_id = g.id AND user_id = ?1) AS my_name,
    (SELECT key FROM group_members WHERE group_id = g.id AND user_id = ?1) AS my_key,
    (SELECT muted FROM group_members WHERE group_id = g.id AND user_id = ?1) AS my_muted,
    (SELECT json_group_array(json_object('key', m.key, 'name', m.name, 'me', m.user_id = ?1, 'owner', m.user_id = g.owner_id,
                                         'push', EXISTS (SELECT 1 FROM push_subs s WHERE s.user_id = m.user_id)))
       FROM (SELECT gm.*, gm.user_id = (SELECT owner_id FROM groups WHERE id = gm.group_id) AS is_owner
             FROM group_members gm WHERE gm.group_id = g.id ORDER BY is_owner DESC, gm.joined_at, gm.key) AS m) AS members
  FROM groups g WHERE g.id IN (SELECT group_id FROM group_members WHERE user_id = ?1) ORDER BY g.created_at, g.id`;

export async function groupInfo(r: Row, secret: string): Promise<GroupInfo> {
  const members = (JSON.parse(String(r.members ?? "[]")) as { key: string; name: string; me: number; owner: number; push: number }[]).map((m) => ({
    key: String(m.key),
    name: String(m.name),
    me: Number(m.me) === 1,
    owner: Number(m.owner) === 1,
    push: Number(m.push) === 1,
  }));
  return {
    id: String(r.id),
    name: String(r.name),
    owner: Number(r.owner) === 1,
    code: await inviteCode(secret, String(r.id), Number(r.invite_v)),
    muted: Number(r.my_muted) === 1,
    members,
  };
}

/** ?1 is the last one in group ?2. */
const LAST = `EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = ?2 AND m.user_id = ?1)
  AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = ?2 AND m.user_id != ?1)`;

/**
 * Leaving group ?2 (person ?1): an owner hands it to whoever joined first
 * after them. The last one out takes the group's notes back as their own
 * (with revs past their cursor, so their phones pick them up as theirs):
 * what they put in a group of one would otherwise go with it.
 */
function leave(group: string): Stmt[] {
  return [
    {
      sql: `UPDATE OR IGNORE notes SET user_id = ?1, rev = (SELECT rev FROM users WHERE id = ?1) + r.k
            FROM (SELECT id AS nid, ROW_NUMBER() OVER (ORDER BY rev, id) AS k FROM notes WHERE user_id = ?2) AS r
            WHERE notes.user_id = ?2 AND notes.id = r.nid AND ${LAST}`,
      params: [group],
    },
    {
      sql: "UPDATE users SET rev = (SELECT MAX(rev) FROM notes WHERE user_id = ?1) WHERE id = ?1 AND (SELECT MAX(rev) FROM notes WHERE user_id = ?1) > rev",
      params: [],
    },
    {
      sql: `UPDATE groups SET owner_id = (SELECT m.user_id FROM group_members m WHERE m.group_id = ?2 AND m.user_id != ?1 ORDER BY m.joined_at, m.key LIMIT 1)
            WHERE id = ?2 AND owner_id = ?1 AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = ?2 AND m.user_id != ?1)`,
      params: [group],
    },
    // Still the owner here means nobody else was in it.
    { sql: "DELETE FROM notes WHERE user_id = ?2 AND EXISTS (SELECT 1 FROM groups WHERE id = ?2 AND owner_id = ?1)", params: [group] },
    { sql: "DELETE FROM groups WHERE id = ?2 AND owner_id = ?1", params: [group] },
    { sql: "DELETE FROM group_members WHERE group_id = ?2 AND user_id = ?1", params: [group] },
  ];
}

/** The people `leaveAll` takes out: one account (?1), or a JSON list of them (?1). */
export const ONE = "(SELECT ?1)";
export const LIST = "(SELECT value FROM json_each(?1))";

/**
 * Everyone in `gone` out of every group they are in (an account deleted,
 * guests swept): the same as each of them leaving, all at once.
 */
export function leaveAll(gone: typeof ONE | typeof LIST): Stmt[] {
  return [
    `UPDATE groups SET owner_id = (SELECT m.user_id FROM group_members m WHERE m.group_id = groups.id AND m.user_id NOT IN ${gone} ORDER BY m.joined_at, m.key LIMIT 1)
     WHERE owner_id IN ${gone} AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = groups.id AND m.user_id NOT IN ${gone})`,
    `DELETE FROM notes WHERE user_id IN (SELECT id FROM groups WHERE owner_id IN ${gone})`,
    `DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE owner_id IN ${gone})`,
    `DELETE FROM groups WHERE owner_id IN ${gone}`,
    `DELETE FROM group_members WHERE user_id IN ${gone}`,
  ].map((sql) => ({ sql, params: [] }));
}

/**
 * A person's own entries in a group note's per-person columns (`ticks`,
 * `watch`), from ?1 to ?2, where ?2 has none of its own there.
 */
const moveOwn = (column: "ticks" | "watch") => ({
  sql: `UPDATE notes SET ${column} = json_set(json_remove(${column}, '$."' || ?1 || '"'), '$."' || ?2 || '"', json(json_extract(${column}, '$."' || ?1 || '"')))
        WHERE user_id IN (SELECT group_id FROM group_members WHERE user_id = ?2)
          AND json_extract(${column}, '$."' || ?1 || '"') IS NOT NULL AND json_extract(${column}, '$."' || ?2 || '"') IS NULL`,
});

/** What a guest is in becomes `into`'s (worker/guest.ts adoptGuest). Each statement takes only what it names. */
export function adoptGroups(guest: string, into: string): Stmt[] {
  return [
    // Both already in a group: the account's place stays, the guest's goes.
    { sql: "UPDATE OR IGNORE group_members SET user_id = ?2 WHERE user_id = ?1", params: [guest, into] },
    { sql: "DELETE FROM group_members WHERE user_id = ?1", params: [guest] },
    { sql: "UPDATE groups SET owner_id = ?2 WHERE owner_id = ?1", params: [guest, into] },
    // What the guest ticked off, and asked to be told about, stays theirs under the account.
    { ...moveOwn("ticks"), params: [guest, into] },
    { ...moveOwn("watch"), params: [guest, into] },
  ];
}

const ok = () => json({ ok: true });

/** Before signing in: what an invite is to, for the page it opens ("Hải mời bạn vào nhóm Gia đình"). */
export async function handleInvite(url: URL, sql: Sql, secret: string): Promise<Response> {
  const m = CODE.exec(url.searchParams.get("code") ?? "");
  if (!m) return json({ error: "bad code" }, 400);
  const [rows = []] = await sql.batch([
    {
      sql: `SELECT g.name, g.invite_v, (SELECT name FROM group_members WHERE group_id = g.id AND user_id = g.owner_id) AS inviter,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS members
            FROM groups g WHERE g.id = ?1`,
      params: [m[1]!],
    },
  ]);
  const g = rows[0];
  if (!g || !sameText(m[2]!, await token(secret, m[1]!, Number(g.invite_v)))) return json({ error: "no such invite" }, 404);
  return json({ name: String(g.name), inviter: String(g.inviter ?? ""), members: Number(g.members) });
}

/**
 * "Lan đã vào nhóm Gia đình", on the phones of everyone else in it: the
 * one who sent the invite learns it worked, and everyone that the group's
 * reminders now reach one more person. Run after the answer has gone
 * (worker/app.ts), so joining never waits on push services.
 *
 * Not to those who muted the group or are asleep (worker/quiet.ts): it is
 * news, there in the app tomorrow. Counted with the group's rings, so
 * joining and leaving over and over cannot ring anyone more than the cap.
 */
export async function notifyJoined(sql: Sql, group: string, who: string, send: SendDeps): Promise<number> {
  const [rows = [], others = [], counted = []] = await sql.batch([
    { sql: "SELECT g.name AS group_name, m.name AS who FROM groups g JOIN group_members m ON m.group_id = g.id AND m.user_id = ?2 WHERE g.id = ?1", params: [group, who] },
    {
      sql: `SELECT m.user_id, u.tz_offset, u.quiet_from, u.quiet_to FROM group_members m JOIN users u ON u.id = m.user_id
            WHERE m.group_id = ?1 AND m.user_id != ?2 AND m.muted = 0`,
      params: [group, who],
    },
    { sql: RING_SQL, params: [group, ringWindow(send.now), 1] },
  ]);
  const r = rows[0];
  if (!r || Number(counted[0]?.ring_n) > GROUP_RINGS_PER_HOUR) return 0;
  const awake = others.filter((o) => !asleep(quietOf(o), send.now));
  if (!awake.length) return 0;
  const subs = await subsOf(sql, awake.map((o) => String(o.user_id)));
  // Its own tag: three joining in a row are three notifications, not the last one only.
  const message: PushMessage = { title: `${String(r.who)} đã vào nhóm ${String(r.group_name)}`, body: "", tag: `join:${group}:${who}` };
  const jobs = [...subs.values()].flat().map((sub) => ({ sub, message }));
  if (!jobs.length) return 0;
  const { sent, gone } = await sendAll(jobs, send);
  if (gone.length) await sql.batch([{ sql: "DELETE FROM push_subs WHERE endpoint IN (SELECT value FROM json_each(?1))", params: [JSON.stringify(gone)] }]);
  return sent;
}

/** `joined`: told when someone came into a group they were not in, for notifyJoined. */
export async function handleGroups(req: Request, path: string, sql: UserSql, now: number, secret: string, joined?: (group: string) => void): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const b = await readJson(req, 2_000);
  if (!isObject(b)) return json({ error: "bad request" }, 400);

  if (path === "/api/groups/create") {
    const name = cleanName(b.name, LIMITS.groupName);
    const me = cleanName(b.me, LIMITS.memberName);
    if (!name || !me) return json({ error: "bad name" }, 400);
    const id = newGroupId();
    // Counted and made in one go: two quick taps cannot both slip under the limit.
    const [made = []] = await sql.batch([
      {
        sql: `INSERT INTO groups (id, name, owner_id, created_at)
              SELECT ?2, ?3, ?1, ?4 WHERE (SELECT COUNT(*) FROM group_members WHERE user_id = ?1) < ?5 RETURNING id`,
        params: [id, name, now, LIMITS.groupsPerPerson],
      },
      { sql: "INSERT INTO group_members (group_id, user_id, key, name, joined_at) SELECT ?2, ?1, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?2 AND owner_id = ?1)", params: [id, randomToken(9), me, now] },
    ]);
    if (!made[0]) return json({ error: "too many groups" }, 409);
    return json({ id });
  }

  if (path === "/api/groups/join") {
    const m = CODE.exec(typeof b.code === "string" ? b.code.trim() : "");
    const me = cleanName(b.me, LIMITS.memberName);
    if (!m || !me) return json({ error: "bad request" }, 400);
    const id = m[1]!;
    const [rows = []] = await sql.batch([
      {
        sql: `SELECT g.invite_v, EXISTS (SELECT 1 FROM group_members WHERE group_id = ?2 AND user_id = ?1) AS already,
                (SELECT COUNT(*) FROM group_members WHERE group_id = ?2) AS members,
                (SELECT COUNT(*) FROM group_members WHERE user_id = ?1) AS mine
              FROM groups g WHERE g.id = ?2`,
        params: [id],
      },
    ]);
    const g = rows[0];
    if (!g || !sameText(m[2]!, await token(secret, id, Number(g.invite_v)))) return json({ error: "no such invite" }, 404);
    if (Number(g.already) === 1) return json({ id });
    if (Number(g.members) >= LIMITS.membersPerGroup) return json({ error: "group full" }, 409);
    if (Number(g.mine) >= LIMITS.groupsPerPerson) return json({ error: "too many groups" }, 409);
    const [added = []] = await sql.batch([
      {
        sql: "INSERT OR IGNORE INTO group_members (group_id, user_id, key, name, joined_at) SELECT ?2, ?1, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?2) RETURNING group_id",
        params: [id, randomToken(9), me, now],
      },
    ]);
    if (added[0]) joined?.(id);
    return json({ id });
  }

  const id = typeof b.id === "string" && GROUP_ID.test(b.id) ? b.id : null;
  if (!id) return json({ error: "bad group" }, 400);

  if (path === "/api/groups/leave") {
    await sql.batch(leave(id));
    return ok();
  }

  if (path === "/api/groups/me") {
    const me = cleanName(b.name, LIMITS.memberName);
    if (!me) return json({ error: "bad name" }, 400);
    await sql.batch([{ sql: "UPDATE group_members SET name = ?3 WHERE group_id = ?2 AND user_id = ?1", params: [id, me] }]);
    return ok();
  }

  // "Tắt tiếng nhóm này": anyone, for themselves only.
  if (path === "/api/groups/mute") {
    if (typeof b.muted !== "boolean") return json({ error: "bad request" }, 400);
    await sql.batch([{ sql: "UPDATE group_members SET muted = ?3 WHERE group_id = ?2 AND user_id = ?1", params: [id, b.muted ? 1 : 0] }]);
    return ok();
  }

  // The rest is the owner's: refused, it changes nothing.
  const [own = []] = await sql.batch([{ sql: "SELECT 1 AS yes FROM groups WHERE id = ?2 AND owner_id = ?1", params: [id] }]);
  if (!own[0]) return json({ error: "not the owner" }, 403);

  if (path === "/api/groups/rename") {
    const name = cleanName(b.name, LIMITS.groupName);
    if (!name) return json({ error: "bad name" }, 400);
    await sql.batch([{ sql: "UPDATE groups SET name = ?3 WHERE id = ?2 AND owner_id = ?1", params: [id, name] }]);
    return ok();
  }
  if (path === "/api/groups/renew") {
    await sql.batch([{ sql: "UPDATE groups SET invite_v = invite_v + 1 WHERE id = ?2 AND owner_id = ?1", params: [id] }]);
    return ok();
  }
  if (path === "/api/groups/remove") {
    const key = typeof b.key === "string" ? b.key : "";
    // Not themselves: that is leaving, which hands the group on.
    await sql.batch([
      {
        sql: "DELETE FROM group_members WHERE group_id = ?2 AND key = ?3 AND user_id != ?1 AND EXISTS (SELECT 1 FROM groups WHERE id = ?2 AND owner_id = ?1)",
        params: [id, key],
      },
    ]);
    return ok();
  }
  if (path === "/api/groups/delete") {
    await sql.batch([
      { sql: "DELETE FROM notes WHERE user_id = ?2 AND EXISTS (SELECT 1 FROM groups WHERE id = ?2 AND owner_id = ?1)", params: [id] },
      { sql: "DELETE FROM group_members WHERE group_id = ?2 AND EXISTS (SELECT 1 FROM groups WHERE id = ?2 AND owner_id = ?1)", params: [id] },
      { sql: "DELETE FROM groups WHERE id = ?2 AND owner_id = ?1", params: [id] },
    ]);
    return ok();
  }
  return json({ error: "not found" }, 404);
}
