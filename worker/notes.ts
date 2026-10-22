// Every phone keeps its own copy of a person's notes and sends what it
// changed; the Worker keeps the latest of each note and hands back what
// other phones changed since. Of two edits to the same note, the later one
// (by the phone's clock when it was made) wins.
//
// Also where the reminders are planned: each accepted change says when to
// push next (fire_at), which the cron (worker/cron.ts) acts on.
import { GROUP_ID, LIMITS, readNote, tombstone, type GroupSync, type Note, type SyncResponse } from "../src/shared/protocol";
import { nextOccurrence, readRule, type Rule } from "../src/shared/recur";
import { MINUTE } from "../src/shared/wall";
import { groupInfo, MY_GROUPS_SQL } from "./groups";
import { isObject, isOffset, json, readJson } from "./http";
import type { Row, UserSql } from "./sql";

/** Rings after the first for "nhắc dai": six more, ten minutes apart, an hour in all. */
export const NAGS = 6;
export const NAG_GAP_MS = 10 * MINUTE;
/** A change that lands just after its time (a phone a minute slow, a sync a moment late) still rings. */
export const GRACE_MS = 2 * MINUTE;
/** Notes not deleted, per person: room for years of use, a bound on what one account can store. */
export const MAX_NOTES = 5_000;
/** The same for a group's notes, shared by everyone in it. */
export const MAX_GROUP_NOTES = 2_000;
/** A phone's clock this far ahead still counts; further, its edits would win every argument for ever. */
const CLOCK_AHEAD_MS = MINUTE;

export interface Plan {
  fire_at: number | null;
  occ: number | null;
  nags_left: number;
}

/** When to push for a note as a person just left it. */
export function plan(n: Pick<Note, "deleted" | "done" | "due" | "rule" | "nag">, now: number, offset: number): Plan {
  if (n.deleted || n.done !== null || n.due === null) return { fire_at: null, occ: null, nags_left: 0 };
  const nags = n.nag ? NAGS : 0;
  if (n.due > now - GRACE_MS) return { fire_at: n.due, occ: n.due, nags_left: nags };
  // Its time went by unanswered (it synced late, or nobody tapped it): a
  // repeating one rings at its next time, a one-off stays "đã qua" on screen.
  if (n.rule) {
    const t = nextOccurrence(n.rule, now, offset);
    return { fire_at: t, occ: t, nags_left: nags };
  }
  return { fire_at: null, occ: null, nags_left: 0 };
}

/** After pushing for occurrence `occ`: ring it again, move to the next one, or stop. */
export function afterPush(n: { rule: Rule | null; nag: boolean }, occ: number, nagsLeft: number, now: number, offset: number): Plan {
  if (nagsLeft > 0) return { fire_at: now + NAG_GAP_MS, occ, nags_left: nagsLeft - 1 };
  if (n.rule) {
    const t = nextOccurrence(n.rule, Math.max(occ, now), offset);
    return { fire_at: t, occ: t, nags_left: n.nag ? NAGS : 0 };
  }
  return { fire_at: null, occ: null, nags_left: 0 };
}

const COLUMNS = "id, text, title, items, tags, due, rule, nag, done, pinned, deleted, created, updated, rev";

/** A row as phones see it: the Worker's own scheduling columns stay here. `group`: whose it is, if a group's. */
export function noteOf(r: Row, group: string | null = null): Note {
  const parse = (v: unknown) => (typeof v === "string" ? (JSON.parse(v) as unknown) : null);
  return {
    id: String(r.id),
    text: String(r.text),
    title: String(r.title),
    items: (parse(r.items) as Note["items"]) ?? null,
    tags: (parse(r.tags) as string[] | null) ?? [],
    due: r.due === null ? null : Number(r.due),
    rule: r.rule === null ? null : readRule(parse(r.rule)),
    nag: Number(r.nag) === 1,
    done: r.done === null ? null : Number(r.done),
    pinned: Number(r.pinned) === 1,
    deleted: Number(r.deleted) === 1,
    created: Number(r.created),
    updated: Number(r.updated),
    group,
    by:
      group && r.by_at !== null && r.by_at !== undefined
        ? { name: String(r.by_name ?? ""), at: Number(r.by_at), ...(typeof r.by_key === "string" ? { key: r.by_key } : {}) }
        : null,
    each: group !== null && Number(r.each) === 1,
    ticks: group
      ? ((parse(r.tick_list) as { key: string; name: string; at: number; me: number; occ: number | null }[] | null) ?? []).map((t) => ({
          key: String(t.key),
          name: String(t.name),
          at: Number(t.at),
          me: Number(t.me) === 1,
          ...(typeof t.occ === "number" ? { occ: t.occ } : {}),
        }))
      : [],
    mine: group ? mineOf(parse(r.mine_json)) : null,
    assignee: group && typeof r.assignee === "string" ? r.assignee : null,
    watch: group ? watchOf(parse(r.watch_mine)) : null,
    watchers: group ? ((parse(r.watch_list) as { key: string; name: string; me: number }[] | null) ?? []).map((w) => ({ key: String(w.key), name: String(w.name), me: Number(w.me) === 1 })) : [],
  };
}

/** The asker's own entry in a note's ticks, as stored ({at, t}, and `occ` on a repeating note). */
function mineOf(v: unknown): Note["mine"] {
  if (!v || typeof v !== "object") return null;
  const { at, t, occ } = v as { at?: unknown; t?: unknown; occ?: unknown };
  return typeof t === "number" ? { at: typeof at === "number" ? at : null, t, ...(typeof occ === "number" ? { occ } : {}) } : null;
}

/** The asker's own entry in a note's watchers, as stored ({on: 0 or 1, t}). */
function watchOf(v: unknown): Note["watch"] {
  if (!v || typeof v !== "object") return null;
  const { on, t } = v as { on?: unknown; t?: unknown };
  return typeof t === "number" ? { on: Number(on) === 1, t } : null;
}

// An edit that leaves the time alone (a name, a list, a pin, a person's own tick) leaves the ringing
// alone: planned again, a note "nhắc dai" rang for went quiet for everyone the moment anyone touched
// it, since its time had gone by (plan); one each ticks off, the moment the first person ticked.
const SAME_TIME = "excluded.due IS notes.due AND excluded.rule IS notes.rule AND excluded.nag = notes.nag AND excluded.done IS notes.done AND excluded.deleted = notes.deleted";
const KEEP_PLAN = ["fire_at", "occ", "nags_left"].map((c) => `${c} = CASE WHEN ${SAME_TIME} THEN notes.${c} ELSE excluded.${c} END`).join(", ");

// The whole batch in one statement: D1 counts every statement against a
// small per-request allowance on the free plan, so one per note would not
// go far. Revs follow the batch's order; a change that loses to a later
// edit already here writes nothing and leaves a gap in the revs, which is
// harmless (phones only ask for "after rev N").
const UPSERT_SQL = `INSERT INTO notes (user_id, ${COLUMNS}, fire_at, occ, nags_left)
  SELECT ?1, json_extract(j.value, '$.id'), json_extract(j.value, '$.text'), json_extract(j.value, '$.title'),
    json_extract(j.value, '$.items'), json_extract(j.value, '$.tags'), json_extract(j.value, '$.due'),
    json_extract(j.value, '$.rule'), json_extract(j.value, '$.nag'), json_extract(j.value, '$.done'),
    json_extract(j.value, '$.pinned'), json_extract(j.value, '$.deleted'), json_extract(j.value, '$.created'),
    json_extract(j.value, '$.updated'), (SELECT rev FROM users WHERE id = ?1) + j.key + 1,
    json_extract(j.value, '$.fire_at'), json_extract(j.value, '$.occ'), json_extract(j.value, '$.nags_left')
  FROM json_each(?2) AS j WHERE true
  ON CONFLICT (user_id, id) DO UPDATE SET
    text = excluded.text, title = excluded.title, items = excluded.items, tags = excluded.tags,
    due = excluded.due, rule = excluded.rule, nag = excluded.nag, done = excluded.done,
    pinned = excluded.pinned, deleted = excluded.deleted, updated = excluded.updated, rev = excluded.rev,
    ${KEEP_PLAN}
  WHERE excluded.updated > notes.updated`;
const BUMP_SQL = "UPDATE users SET rev = rev + ?2, tz_offset = ?3 WHERE id = ?1";
const PULL_SQL = `SELECT ${COLUMNS} FROM notes WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3`;
const STATE_SQL = `SELECT u.rev, (SELECT COUNT(*) FROM notes WHERE user_id = ?1 AND deleted = 0) AS open,
  (SELECT json_group_array(id) FROM notes WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))) AS known
  FROM users u WHERE u.id = ?1`;

// A group's notes go in the same way, many groups in one statement: each
// row names its group (`owner`) and its place among that group's changes
// (`k`), and goes in only if the sender is in that group, checked in the
// same statement. Who ticked it off is the sender's name in the group,
// stamped here, and only when the tick is newer than the one kept.
const GROUP_UPSERT_SQL = `INSERT INTO notes (user_id, ${COLUMNS}, fire_at, occ, nags_left, by_name, by_at, by_key, each, assignee)
  SELECT json_extract(j.value, '$.owner'), json_extract(j.value, '$.id'), json_extract(j.value, '$.text'), json_extract(j.value, '$.title'),
    json_extract(j.value, '$.items'), json_extract(j.value, '$.tags'), json_extract(j.value, '$.due'),
    json_extract(j.value, '$.rule'), json_extract(j.value, '$.nag'), json_extract(j.value, '$.done'),
    json_extract(j.value, '$.pinned'), json_extract(j.value, '$.deleted'), json_extract(j.value, '$.created'),
    json_extract(j.value, '$.updated'), (SELECT rev FROM groups WHERE id = json_extract(j.value, '$.owner')) + json_extract(j.value, '$.k'),
    json_extract(j.value, '$.fire_at'), json_extract(j.value, '$.occ'), json_extract(j.value, '$.nags_left'),
    json_extract(j.value, '$.by_name'), json_extract(j.value, '$.by_at'), json_extract(j.value, '$.by_key'), json_extract(j.value, '$.each'),
    json_extract(j.value, '$.assignee')
  FROM json_each(?2) AS j
  WHERE EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = json_extract(j.value, '$.owner') AND m.user_id = ?1)
  ON CONFLICT (user_id, id) DO UPDATE SET
    text = excluded.text, title = excluded.title, items = excluded.items, tags = excluded.tags,
    due = excluded.due, rule = excluded.rule, nag = excluded.nag, done = excluded.done,
    pinned = excluded.pinned, deleted = excluded.deleted, updated = excluded.updated, rev = excluded.rev,
    ${KEEP_PLAN}, each = excluded.each, assignee = excluded.assignee,
    by_name = CASE WHEN excluded.by_at > COALESCE(notes.by_at, 0) THEN excluded.by_name ELSE notes.by_name END,
    by_key = CASE WHEN excluded.by_at > COALESCE(notes.by_at, 0) THEN excluded.by_key ELSE notes.by_key END,
    by_at = CASE WHEN excluded.by_at > COALESCE(notes.by_at, 0) THEN excluded.by_at ELSE notes.by_at END
  WHERE excluded.updated > notes.updated`;
// A person's own tick of an "each" note, apart from the note's other fields: the later change of
// that person's own entry wins, whatever happens to the rest of the note (an older edit of the
// title losing to a newer one must not lose the tick that came with it). Only ever their own entry.
// `occ`: on a repeating note, the time it was tapped for (src/shared/ticks.ts).
const GROUP_TICK_SQL = `UPDATE notes SET
    ticks = json_set(COALESCE(notes.ticks, '{}'), '$."' || ?1 || '"',
      json_object('at', json_extract(j.value, '$.at'), 't', json_extract(j.value, '$.t'), 'occ', json_extract(j.value, '$.occ'))),
    rev = (SELECT rev FROM groups WHERE id = notes.user_id) + json_extract(j.value, '$.k')
  FROM json_each(?2) AS j
  WHERE notes.user_id = json_extract(j.value, '$.owner') AND notes.id = json_extract(j.value, '$.id')
    AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = notes.user_id AND m.user_id = ?1)
    AND json_extract(j.value, '$.t') > COALESCE(json_extract(notes.ticks, '$."' || ?1 || '".t'), 0)`;
// "Báo cho tôi nếu chưa xong" the same way: the sender's own entry only, so
// nobody signs someone else up to be told (Hải, 13/10/2026: what if it spams?).
const GROUP_WATCH_SQL = `UPDATE notes SET
    watch = json_set(COALESCE(notes.watch, '{}'), '$."' || ?1 || '"', json_object('on', json_extract(j.value, '$.on'), 't', json_extract(j.value, '$.t'))),
    rev = (SELECT rev FROM groups WHERE id = notes.user_id) + json_extract(j.value, '$.k')
  FROM json_each(?2) AS j
  WHERE notes.user_id = json_extract(j.value, '$.owner') AND notes.id = json_extract(j.value, '$.id')
    AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = notes.user_id AND m.user_id = ?1)
    AND json_extract(j.value, '$.t') > COALESCE(json_extract(notes.watch, '$."' || ?1 || '".t'), 0)`;
const GROUP_BUMP_SQL = `UPDATE groups SET rev = rev + json_extract(j.value, '$.n'), tz_offset = ?3
  FROM json_each(?2) AS j
  WHERE groups.id = json_extract(j.value, '$.g') AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = groups.id AND m.user_id = ?1)`;
// Every group's changes past the phone's cursor for it, at most a pull's worth each.
const GROUP_PULL_SQL = `SELECT * FROM (
    SELECT n.user_id AS grp, ${COLUMNS.split(", ")
      .map((c) => `n.${c}`)
      .join(", ")}, n.by_name, n.by_at, n.by_key, n.each, n.assignee,
      (SELECT json_group_array(json_object('key', m.key, 'name', m.name, 'at', json_extract(n.ticks, '$."' || m.user_id || '".at'),
          'occ', json_extract(n.ticks, '$."' || m.user_id || '".occ'), 'me', m.user_id = ?1))
         FROM group_members m WHERE m.group_id = n.user_id AND json_extract(n.ticks, '$."' || m.user_id || '".at') IS NOT NULL) AS tick_list,
      json_extract(n.ticks, '$."' || ?1 || '"') AS mine_json,
      (SELECT json_group_array(json_object('key', m.key, 'name', m.name, 'me', m.user_id = ?1))
         FROM group_members m WHERE m.group_id = n.user_id AND json_extract(n.watch, '$."' || m.user_id || '".on') = 1) AS watch_list,
      json_extract(n.watch, '$."' || ?1 || '"') AS watch_mine,
      ROW_NUMBER() OVER (PARTITION BY n.user_id ORDER BY n.rev) AS k
    FROM notes n JOIN json_each(?2) AS j ON n.user_id = json_extract(j.value, '$.g') AND n.rev > json_extract(j.value, '$.s')
    WHERE n.user_id IN (SELECT group_id FROM group_members WHERE user_id = ?1)
  ) WHERE k <= ?3 ORDER BY grp, rev`;
const GROUP_KNOWN_SQL = `SELECT json_group_array(n.user_id || ' ' || n.id) AS known FROM notes n
  WHERE n.user_id IN (SELECT group_id FROM group_members WHERE user_id = ?1) AND n.id IN (SELECT value FROM json_each(?2))`;
const GROUP_REVS_SQL = "SELECT id, rev FROM groups WHERE id IN (SELECT group_id FROM group_members WHERE user_id = ?1)";

/** The JSON one note goes into the batch as: SQL values, JSON columns as text, its plan beside it. */
function rowFor(n: Note, now: number, offset: number) {
  const p = plan(n, now, offset);
  return {
    id: n.id,
    text: n.text,
    title: n.title,
    items: n.items === null ? null : JSON.stringify(n.items),
    tags: JSON.stringify(n.tags),
    due: n.due,
    rule: n.rule === null ? null : JSON.stringify(n.rule),
    nag: n.nag ? 1 : 0,
    done: n.done,
    pinned: n.pinned ? 1 : 0,
    deleted: n.deleted ? 1 : 0,
    created: n.created,
    updated: n.updated,
    ...p,
  };
}

/** A phone's cursors for its groups, kept to well-formed ones; a group it does not name starts from 0. */
function cursors(v: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!isObject(v)) return out;
  for (const [g, s] of Object.entries(v)) if (GROUP_ID.test(g) && Number.isSafeInteger(s) && (s as number) >= 0) out.set(g, s as number);
  return out;
}

/**
 * `planned`: told when a change went in, so the reminders' clock can look
 * again. `secret`: keys the groups' invite links (worker/groups.ts).
 */
export async function handleSync(req: Request, sql: UserSql, now: number, planned: (() => void) | undefined, secret: string): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const b = await readJson(req, 1_200_000);
  if (!isObject(b) || !Number.isSafeInteger(b.since) || (b.since as number) < 0 || !isOffset(b.offset) || !Array.isArray(b.changes)) {
    return json({ error: "bad request" }, 400);
  }
  if (b.changes.length > LIMITS.changesPerSync) return json({ error: "too many changes" }, 413);
  const since = b.since as number;
  const offset = b.offset;
  const groupSince = cursors(b.groups);

  // Checked one by one: a note this phone cannot have meant is dropped and named, the rest still go in.
  const rejected: string[] = [];
  const seen = new Map<string, Note>();
  for (const c of b.changes) {
    const n = readNote(c);
    if (!n) {
      if (isObject(c) && typeof c.id === "string") rejected.push(c.id.slice(0, 40));
      continue;
    }
    const fixed: Note = { ...(n.deleted ? tombstone(n) : n), updated: Math.min(n.updated, now + CLOCK_AHEAD_MS) };
    const was = seen.get(n.id);
    if (!was || fixed.updated > was.updated) seen.set(n.id, fixed);
  }
  const all = [...seen.values()];
  let changes = all.filter((c) => c.group === null);
  let shared = all.filter((c) => c.group !== null);

  const [state = [], mine = [], knownInGroups = []] = await sql.batch([
    { sql: STATE_SQL, params: [JSON.stringify(changes.map((c) => c.id))] },
    { sql: MY_GROUPS_SQL, params: [] },
    { sql: GROUP_KNOWN_SQL, params: [JSON.stringify(shared.map((c) => c.id))] },
  ]);
  const row = state[0];
  if (!row) return json({ error: "signed out" }, 401);
  const known = new Set(JSON.parse(String(row.known ?? "[]")) as string[]);
  let room = MAX_NOTES - Number(row.open);
  changes = changes.filter((c) => {
    if (known.has(c.id) || c.deleted) return true;
    if (room > 0) {
      room--;
      return true;
    }
    rejected.push(c.id);
    return false;
  });

  // A group's change goes in only from someone in it, and while the group has room.
  const groups = new Map(mine.map((g) => [String(g.id), g]));
  const knownShared = new Set(JSON.parse(String(knownInGroups[0]?.known ?? "[]")) as string[]);
  const groupRoom = new Map([...groups].map(([id, g]) => [id, MAX_GROUP_NOTES - Number(g.open)]));
  shared = shared.filter((c) => {
    const g = groups.get(c.group!);
    if (!g) {
      rejected.push(c.id);
      return false;
    }
    if (knownShared.has(`${c.group} ${c.id}`) || c.deleted) return true;
    const left = groupRoom.get(c.group!) ?? 0;
    if (left > 0) {
      groupRoom.set(c.group!, left - 1);
      return true;
    }
    rejected.push(c.id);
    return false;
  });
  const counts = new Map<string, number>();
  const groupBatch = shared.map((c) => {
    const k = (counts.get(c.group!) ?? 0) + 1;
    counts.set(c.group!, k);
    const g = groups.get(c.group!);
    const by = c.by ? { by_name: String(g?.my_name ?? ""), by_at: c.by.at, by_key: String(g?.my_key ?? "") } : { by_name: null, by_at: null, by_key: null };
    return { ...rowFor(c, now, offset), owner: c.group, k, each: c.each ? 1 : 0, assignee: c.assignee, ...by };
  });
  // Each person's own tick, and own "báo cho tôi", after the notes they belong to have gone in.
  const own = (pick: (c: Note) => Record<string, unknown> | null) =>
    shared.flatMap((c) => {
      const v = pick(c);
      if (!v) return [];
      const k = (counts.get(c.group!) ?? 0) + 1;
      counts.set(c.group!, k);
      return [{ owner: c.group, id: c.id, ...v, k }];
    });
  const tickBatch = own((c) => c.mine && { at: c.mine.at, t: c.mine.t, occ: c.mine.occ ?? null });
  const watchBatch = own((c) => c.watch && { on: c.watch.on ? 1 : 0, t: c.watch.t });
  const pulls = [...groups.keys()].map((g) => ({ g, s: groupSince.get(g) ?? 0 }));

  const batch = changes.map((c) => rowFor(c, now, offset));
  const results = await sql.batch([
    ...(batch.length ? [{ sql: UPSERT_SQL, params: [JSON.stringify(batch)] }] : []),
    { sql: BUMP_SQL, params: [batch.length, offset] },
    ...(groupBatch.length
      ? [
          { sql: GROUP_UPSERT_SQL, params: [JSON.stringify(groupBatch)] },
          ...(tickBatch.length ? [{ sql: GROUP_TICK_SQL, params: [JSON.stringify(tickBatch)] }] : []),
          ...(watchBatch.length ? [{ sql: GROUP_WATCH_SQL, params: [JSON.stringify(watchBatch)] }] : []),
          { sql: GROUP_BUMP_SQL, params: [JSON.stringify([...counts].map(([g, n]) => ({ g, n }))), offset] },
        ]
      : []),
    { sql: PULL_SQL, params: [since, LIMITS.notesPerPull + 1] },
    { sql: "SELECT rev FROM users WHERE id = ?1", params: [] },
    { sql: GROUP_PULL_SQL, params: [JSON.stringify(pulls), LIMITS.notesPerPull + 1] },
    { sql: GROUP_REVS_SQL, params: [] },
  ]);
  if (batch.length || groupBatch.length) planned?.();
  const pulled = results.at(-4) ?? [];
  const rev = Number(results.at(-3)?.[0]?.rev ?? 0);
  const groupRows = results.at(-2) ?? [];
  const revs = new Map((results.at(-1) ?? []).map((r) => [String(r.id), Number(r.rev)]));
  const more = pulled.length > LIMITS.notesPerPull;
  const rows = more ? pulled.slice(0, LIMITS.notesPerPull) : pulled;

  const synced: GroupSync[] = [];
  for (const [id, g] of groups) {
    const got = groupRows.filter((r) => r.grp === id);
    const gMore = got.length > LIMITS.notesPerPull;
    const gRows = gMore ? got.slice(0, LIMITS.notesPerPull) : got;
    synced.push({
      ...(await groupInfo(g, secret)),
      rev: gMore ? Number(gRows.at(-1)?.rev ?? groupSince.get(id) ?? 0) : (revs.get(id) ?? Number(g.rev)),
      notes: gRows.map((r) => noteOf(r, id)),
      more: gMore,
    });
  }
  const out: SyncResponse & { rejected: string[] } = {
    rev: more ? Number(rows.at(-1)?.rev ?? since) : rev,
    notes: rows.map((r) => noteOf(r)),
    more: more || synced.some((g) => g.more),
    groups: synced,
    rejected,
  };
  return json(out);
}
