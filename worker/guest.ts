// "Dùng ngay": the app without signing in. A guest is an ordinary account
// with no Google behind it, reachable only from the device holding its
// session (and an iPhone's installed app, by the same install code as
// anyone). Its notes are on the server like everyone's: reminders have to
// ring with the app closed, and only the server can do that.
//
// Signing in with Google, or pairing with someone's code, while a guest
// session is on the device moves the guest's notes, phones and shortcuts
// into that account (adoptGuest), so nothing typed before is lost.
import type { Me } from "../src/shared/protocol";
import { DAY, MINUTE, VN_OFFSET } from "../src/shared/wall";
import { nextDigest } from "./cron";
import { hmacHex, randomToken } from "./crypto";
import { clientBucket } from "./google";
import { adoptGroups, LIST, leaveAll } from "./groups";
import { json } from "./http";
import { newSession, SESSION_IDLE_MS, sessionCookie } from "./session";
import type { Sql } from "./sql";

/**
 * New guests per address per ten minutes, and everyone's together. Loose
 * per address: mobile carriers put thousands of phones behind one IPv4.
 */
export const GUEST_LIMITS = { perClient: 30, all: 1_000 };
const WINDOW_MS = 10 * MINUTE;
const DIGEST_HOUR = 7;

export interface GuestDeps {
  sql: Sql;
  now: number;
  /** Keys the address hash, so the counters never hold an address. */
  secret: string;
  limits?: typeof GUEST_LIMITS;
}

export async function handleGuest(req: Request, url: URL, d: GuestDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  // Another site's page cannot quietly sign a visitor up.
  if (req.headers.get("origin") !== url.origin) return json({ error: "origin" }, 403);
  const limits = d.limits ?? GUEST_LIMITS;
  const win = Math.floor(d.now / WINDOW_MS);
  const client = `guest:${await hmacHex(d.secret, clientBucket(req))}`;
  const id = randomToken(16);
  // Counted and created in one transaction: two racing past a separate check cannot both get in.
  const [, , , made = []] = await d.sql.batch([
    { sql: "DELETE FROM counters WHERE win < ?1", params: [win - 1] },
    { sql: "INSERT INTO counters (kind, win, n) VALUES (?1, ?2, 1) ON CONFLICT (kind, win) DO UPDATE SET n = n + 1", params: [client, win] },
    { sql: "INSERT INTO counters (kind, win, n) VALUES ('guest', ?1, 1) ON CONFLICT (kind, win) DO UPDATE SET n = n + 1", params: [win] },
    {
      sql: `INSERT INTO users (id, google_sub, guest, created_at, last_login, digest_next)
            SELECT ?1, 'guest:' || ?1, 1, ?2, ?2, ?3
            WHERE (SELECT n FROM counters WHERE kind = ?4 AND win = ?5) <= ?6
              AND (SELECT n FROM counters WHERE kind = 'guest' AND win = ?5) <= ?7
            RETURNING id`,
      params: [id, d.now, nextDigest(DIGEST_HOUR, d.now, VN_OFFSET), client, win, limits.perClient, limits.all],
    },
  ]);
  if (!made[0]) return json({ error: "too many" }, 429);
  const token = await newSession(d.sql, id, d.now);
  // Hours of sleep as migrations/0005 sets them for everyone new.
  const me: Me = { id, name: "", email: "", digestHour: DIGEST_HOUR, guest: true, quiet: { from: 22, to: 6 } };
  return json(me, 200, { "set-cookie": sessionCookie(url, token) });
}

/**
 * Everything of guest `guestId` becomes `into`'s: notes (with fresh revs, so
 * every phone of `into` picks them up), notification subscriptions and
 * shortcut tokens. The guest account is then gone. Does nothing unless
 * `guestId` really is a guest: a signed-in account is never merged away.
 */
export async function adoptGuest(sql: Sql, guestId: string, into: string): Promise<number> {
  if (guestId === into) return 0;
  const [who = [], ids = []] = await sql.batch([
    { sql: "SELECT guest FROM users WHERE id = ?1", params: [guestId] },
    { sql: "SELECT id FROM notes WHERE user_id = ?1 ORDER BY rev", params: [guestId] },
  ]);
  if (Number(who[0]?.guest) !== 1) return 0;
  const map = JSON.stringify(ids.map((r, k) => ({ id: String(r.id), k: k + 1 })));
  await sql.batch([
    {
      // OR IGNORE: an id already in `into` (two random 128-bit ids alike) stays the guest's and goes with it.
      sql: `UPDATE OR IGNORE notes SET user_id = ?2, rev = (SELECT rev FROM users WHERE id = ?2) + json_extract(j.value, '$.k')
            FROM json_each(?3) AS j WHERE notes.user_id = ?1 AND notes.id = json_extract(j.value, '$.id')`,
      params: [guestId, into, map],
    },
    { sql: "UPDATE users SET rev = rev + ?2 WHERE id = ?1", params: [into, ids.length] },
    { sql: "UPDATE OR IGNORE push_subs SET user_id = ?2 WHERE user_id = ?1", params: [guestId, into] },
    { sql: "UPDATE api_tokens SET user_id = ?2 WHERE user_id = ?1", params: [guestId, into] },
    ...adoptGroups(guestId, into),
    ...dropGuest(guestId),
  ]);
  return ids.length;
}

/** Every row of a guest, for adopting and for sweeping. */
function dropGuest(guestId: string) {
  return [
    "DELETE FROM notes WHERE user_id = ?1",
    "DELETE FROM push_subs WHERE user_id = ?1",
    "DELETE FROM api_tokens WHERE user_id = ?1",
    "DELETE FROM pair_codes WHERE user_id = ?1",
    "DELETE FROM sessions WHERE user_id = ?1",
    "DELETE FROM users WHERE id = ?1 AND guest = 1",
  ].map((sql) => ({ sql, params: [guestId] }));
}

/**
 * Guests nobody can reach any more: every session of theirs has lapsed, so
 * no device holds the way in. Their notes would sit there for ever.
 */
export async function sweepGuests(sql: Sql, now: number): Promise<number> {
  const idle = now - SESSION_IDLE_MS - DAY;
  const [rows = []] = await sql.batch([
    {
      sql: `SELECT id FROM users WHERE guest = 1 AND created_at < ?1
            AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id AND s.last_used >= ?1) LIMIT 50`,
      params: [idle],
    },
  ]);
  const ids = JSON.stringify(rows.map((r) => String(r.id)));
  if (!rows.length) return 0;
  await sql.batch([
    ...leaveAll(LIST).map((st) => ({ ...st, params: [ids] })),
    ...[
      "DELETE FROM notes WHERE user_id IN (SELECT value FROM json_each(?1))",
      "DELETE FROM push_subs WHERE user_id IN (SELECT value FROM json_each(?1))",
      "DELETE FROM api_tokens WHERE user_id IN (SELECT value FROM json_each(?1))",
      "DELETE FROM pair_codes WHERE user_id IN (SELECT value FROM json_each(?1))",
      "DELETE FROM sessions WHERE user_id IN (SELECT value FROM json_each(?1))",
      "DELETE FROM users WHERE guest = 1 AND id IN (SELECT value FROM json_each(?1))",
    ].map((s) => ({ sql: s, params: [ids] })),
  ]);
  return rows.length;
}
