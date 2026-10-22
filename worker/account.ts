// The signed-in person's own account: who they are, the morning list's
// hour, signing out, and deleting everything.
import type { Me } from "../src/shared/protocol";
import { nextDigest } from "./cron";
import { leaveAll, ONE } from "./groups";
import { isObject, json, readJson } from "./http";
import { signedOutCookie } from "./session";
import type { UserSql } from "./sql";

const ME_SQL = "SELECT id, name, email, digest_hour, guest, quiet_from, quiet_to FROM users WHERE id = ?1";

const hour = (h: unknown): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;

/** The hours of sleep as the app shows them: none, or from–to (never a span of nothing). */
export function quietSaid(from: unknown, to: unknown): Me["quiet"] {
  return from === null || to === null || from === undefined || to === undefined || Number(from) === Number(to) ? null : { from: Number(from), to: Number(to) };
}

// Every table with this person's rows, so nothing of them stays behind.
const DELETE_ALL = [
  "DELETE FROM notes WHERE user_id = ?1",
  "DELETE FROM push_subs WHERE user_id = ?1",
  "DELETE FROM api_tokens WHERE user_id = ?1",
  "DELETE FROM pair_codes WHERE user_id = ?1",
  "DELETE FROM sessions WHERE user_id = ?1",
  "DELETE FROM users WHERE id = ?1",
];

export async function handleAccount(req: Request, url: URL, path: string, sql: UserSql, sessionHash: string, now: number): Promise<Response> {
  if (path === "/api/me" && req.method === "GET") {
    const [rows = []] = await sql.batch([{ sql: ME_SQL, params: [] }]);
    const r = rows[0];
    if (!r) return json({ error: "signed out" }, 401);
    return json({
      id: String(r.id),
      name: String(r.name),
      email: String(r.email),
      digestHour: r.digest_hour === null ? null : Number(r.digest_hour),
      guest: Number(r.guest) === 1,
      quiet: quietSaid(r.quiet_from, r.quiet_to),
    } satisfies Me);
  }
  if (path === "/api/settings" && req.method === "POST") {
    // Either or both: the morning list's hour, the hours of sleep. What is not named stays.
    const b = await readJson(req, 500);
    if (!isObject(b) || (!("digestHour" in b) && !("quiet" in b))) return json({ error: "bad request" }, 400);
    const h = b.digestHour;
    if ("digestHour" in b && !(h === null || hour(h))) return json({ error: "bad hour" }, 400);
    const q = b.quiet;
    if ("quiet" in b && !(q === null || (isObject(q) && hour(q.from) && hour(q.to) && q.from !== q.to))) return json({ error: "bad hours" }, 400);
    const stmts = [];
    if ("digestHour" in b) {
      const [rows = []] = await sql.batch([{ sql: "SELECT tz_offset FROM users WHERE id = ?1", params: [] }]);
      const offset = Number(rows[0]?.tz_offset ?? 420);
      stmts.push({ sql: "UPDATE users SET digest_hour = ?2, digest_next = ?3 WHERE id = ?1", params: [h as number | null, h === null ? null : nextDigest(h as number, now, offset)] });
    }
    if ("quiet" in b) {
      const quiet = q as { from: number; to: number } | null;
      stmts.push({ sql: "UPDATE users SET quiet_from = ?2, quiet_to = ?3 WHERE id = ?1", params: [quiet?.from ?? null, quiet?.to ?? null] });
    }
    await sql.batch(stmts);
    return json({ ok: true });
  }
  if (path === "/api/logout" && req.method === "POST") {
    // This phone's notifications go with it: the next person to sign in on it must not get them.
    const b = await readJson(req, 2_000);
    const endpoint = isObject(b) && typeof b.endpoint === "string" ? b.endpoint : "";
    await sql.batch([
      { sql: "DELETE FROM sessions WHERE user_id = ?1 AND hash = ?2", params: [sessionHash] },
      { sql: "DELETE FROM push_subs WHERE user_id = ?1 AND endpoint = ?2", params: [endpoint] },
    ]);
    return json({ ok: true }, 200, { "set-cookie": signedOutCookie(url) });
  }
  if (path === "/api/account/delete" && req.method === "POST") {
    const b = await readJson(req, 500);
    // Typed out, not a single tap: nothing brings these notes back.
    if (!isObject(b) || b.confirm !== "XOA") return json({ error: "confirm" }, 400);
    // Out of every group first: one they own goes to whoever joined next, or away with them.
    await sql.batch([...leaveAll(ONE), ...DELETE_ALL.map((s) => ({ sql: s, params: [] }))]);
    return json({ ok: true }, 200, { "set-cookie": signedOutCookie(url) });
  }
  return json({ error: "not found" }, 404);
}
