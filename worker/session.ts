// Signed in: a cookie holding a random token, of which only the SHA-256 is
// kept (sessions.hash). Made by Google sign-in (worker/google.ts) or by a
// pairing code (worker/pair.ts), for a phone that cannot use Google itself.
import { DAY, VN_OFFSET } from "../src/shared/wall";
import { nextDigest } from "./cron";
import { clearCookie, cookieName, cookieOf, setCookie } from "./cookies";
import { randomToken, sha256Hex } from "./crypto";
import type { AuthDeps, Who } from "./google";
import type { Sql } from "./sql";

/**
 * Signed out after this long unused. Long on purpose: signing a phone in
 * again is the chore that makes people leave a notes app. 400 days is also
 * the longest any browser keeps a cookie.
 */
export const SESSION_IDLE_MS = 400 * DAY;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
/** The morning list starts on, at seven. */
const DIGEST_HOUR = 7;

/** A new session for `userId`: the cookie's value. */
export async function newSession(sql: Sql, userId: string, now: number): Promise<string> {
  const token = randomToken(24);
  await sql.batch([
    { sql: "DELETE FROM sessions WHERE user_id = ?1 AND last_used < ?2", params: [userId, now - SESSION_IDLE_MS] },
    { sql: "INSERT INTO sessions (hash, user_id, created_at, last_used) VALUES (?1, ?2, ?3, ?3)", params: [await sha256Hex(token), userId, now] },
  ]);
  return token;
}

/** After Google said who it is: the account made or brought up to date, and a new session. */
export async function signIn(deps: AuthDeps, who: Who): Promise<{ token: string; userId: string; maxAgeSeconds: number }> {
  const now = deps.now();
  const [, rows = []] = await deps.sql.batch([
    {
      // ON CONFLICT: the same account finishing two sign-ins at once.
      sql: `INSERT INTO users (id, google_sub, email, name, email_verified, created_at, last_login, digest_next)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)
            ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name,
              email_verified = excluded.email_verified, last_login = excluded.last_login`,
      params: [randomToken(16), who.sub, who.email, who.name, who.emailVerified ? 1 : 0, now, nextDigest(DIGEST_HOUR, now, VN_OFFSET)],
    },
    { sql: "SELECT id FROM users WHERE google_sub = ?1", params: [who.sub] },
  ]);
  const userId = String(rows[0]?.id);
  return { token: await newSession(deps.sql, userId, now), userId, maxAgeSeconds: SESSION_IDLE_MS / 1000 };
}

export function sessionCookie(url: URL, token: string): string {
  return setCookie(url, cookieName(url, "nhonha"), token, SESSION_IDLE_MS / 1000);
}

export const signedOutCookie = (url: URL) => clearCookie(url, cookieName(url, "nhonha"));

/** The signed-in person and their session, or null. Kept alive by use. */
export async function session(req: Request, url: URL, sql: Sql, now: number): Promise<{ userId: string; hash: string } | null> {
  const token = cookieOf(req, cookieName(url, "nhonha"));
  if (!token || !TOKEN.test(token)) return null;
  const hash = await sha256Hex(token);
  const [rows = []] = await sql.batch([
    { sql: "UPDATE sessions SET last_used = ?2 WHERE hash = ?1 AND last_used >= ?3 RETURNING user_id", params: [hash, now, now - SESSION_IDLE_MS] },
  ]);
  const userId = rows[0]?.user_id;
  return typeof userId === "string" ? { userId, hash } : null;
}
