// Signing a phone in without Google on it. An iPhone's home-screen app
// keeps its cookies apart from Safari's, and Google's page opened from
// inside it finishes in Safari, so a person who signed in with Google in
// Safari would find the installed app signed out. Two ways round:
//
// - install: Safari, signed in, asks for a code and opens /cai/<code>/.
//   That page's manifest starts the installed app at the same address,
//   and the app's first launch trades the code for its own session.
// - manual: one screen shows a short code, the other types it in.
//
// A code is good once, is kept only as its SHA-256, and dies on its own.
//
// A code in an address is a way into an account for whoever opens it, and
// a link can be sent to anyone. So a browser takes one only fresh (the app's
// own hand-offs open theirs at once; a link posted somewhere is older), and
// only a typed code ever moves a guest's notes: a click must not hand what
// someone wrote to whoever made the link.
import { MINUTE, DAY } from "../src/shared/wall";
import { randomToken, sha256Hex, hmacHex } from "./crypto";
import { clientBucket } from "./google";
import { isObject, json, readJson } from "./http";
import { adoptGuest } from "./guest";
import { newSession, session, sessionCookie } from "./session";
import type { Sql, UserSql } from "./sql";

export const INSTALL_TTL_MS = 30 * DAY;
export const MANUAL_TTL_MS = 10 * MINUTE;
/**
 * How old an install code may be when a browser, not the installed app,
 * spends it: Zalo's browser out to Safari and the old address to the new
 * make theirs a moment before opening them (src/ui/EscapeInApp.tsx keeps its
 * own for a visit, hence not a minute).
 */
export const LINK_TTL_MS = 30 * MINUTE;
/** Unused codes kept per person and kind; a new one past it ends the oldest. */
export const MAX_CODES = 10;
/** No 0/O, 1/I: read off one screen and typed into another. 32⁸ ≈ 10¹² codes. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MANUAL = /^[A-HJ-NP-Z2-9]{8}$/;
export const INSTALL = /^[A-Za-z0-9_-]{43}$/;
/** Tries per address per ten minutes, and everyone's together. */
export const PAIR_LIMITS = { perClient: 20, all: 2_000 };
const WINDOW_MS = 10 * MINUTE;

function manualCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ALPHABET[b % 32]).join("");
}

/** What a person types: any case, spaces and dashes allowed. */
export function normalCode(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, "");
}

/** Signed in: a code for another of their phones. */
export async function handlePairStart(req: Request, path: string, sql: UserSql, now: number): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const install = path === "/api/pair/install";
  const code = install ? randomToken(32) : manualCode();
  const kind = install ? "install" : "manual";
  await sql.batch([
    { sql: "DELETE FROM pair_codes WHERE user_id = ?1 AND (expires_at < ?2 OR used_at IS NOT NULL)", params: [now] },
    {
      sql: "INSERT INTO pair_codes (hash, user_id, kind, created_at, expires_at) VALUES (?2, ?1, ?3, ?4, ?5)",
      params: [await sha256Hex(code), kind, now, now + (install ? INSTALL_TTL_MS : MANUAL_TTL_MS)],
    },
    // Install codes live a month, and each tap on "Cài" makes one.
    {
      sql: `DELETE FROM pair_codes WHERE user_id = ?1 AND kind = ?2 AND hash NOT IN
              (SELECT hash FROM pair_codes WHERE user_id = ?1 AND kind = ?2 ORDER BY created_at DESC, rowid DESC LIMIT ?3)`,
      params: [kind, MAX_CODES],
    },
  ]);
  return json({ code, expires: now + (install ? INSTALL_TTL_MS : MANUAL_TTL_MS) });
}

export interface PairDeps {
  sql: Sql;
  now: number;
  /** Keys the address hash, so the counters never hold an address. */
  secret: string;
  limits?: typeof PAIR_LIMITS;
}

/**
 * Signed out: a code for a session of this phone's own. `app: true` from
 * the installed app's first launch, whose start address carries the code it
 * was installed with, however long ago; a browser's comes from a link.
 */
export async function handlePairRedeem(req: Request, url: URL, d: PairDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  // Another site's page cannot spend a code to sign the visitor into someone else's account.
  if (req.headers.get("origin") !== url.origin) return json({ error: "origin" }, 403);
  const b = await readJson(req, 500);
  const raw = isObject(b) && typeof b.code === "string" ? b.code : "";
  const installed = isObject(b) && b.app === true;
  const code = INSTALL.test(raw) ? raw : normalCode(raw);
  if (!INSTALL.test(code) && !MANUAL.test(code)) return json({ error: "bad code" }, 400);

  const limits = d.limits ?? PAIR_LIMITS;
  const win = Math.floor(d.now / WINDOW_MS);
  const client = `pair:${await hmacHex(d.secret, clientBucket(req))}`;
  // Every try counts, right or wrong: guessing is what the limit is for.
  const [, , , counts = [], used = []] = await d.sql.batch([
    { sql: "DELETE FROM counters WHERE win < ?1", params: [win - 1] },
    { sql: "INSERT INTO counters (kind, win, n) VALUES (?1, ?2, 1) ON CONFLICT (kind, win) DO UPDATE SET n = n + 1", params: [client, win] },
    { sql: "INSERT INTO counters (kind, win, n) VALUES ('pair', ?1, 1) ON CONFLICT (kind, win) DO UPDATE SET n = n + 1", params: [win] },
    { sql: "SELECT (SELECT n FROM counters WHERE kind = ?1 AND win = ?2) AS mine, (SELECT n FROM counters WHERE kind = 'pair' AND win = ?2) AS everyone", params: [client, win] },
    // Spent in the same statement that finds it: a second try with it, even a racing one, finds nothing.
    // Too old for a browser, it is left as it was: the installed app may still need it.
    {
      sql: `UPDATE pair_codes SET used_at = ?2 WHERE hash = ?1 AND used_at IS NULL AND expires_at > ?2
            AND (kind = 'manual' OR ?7 = 1 OR created_at > ?8)
            AND (SELECT n FROM counters WHERE kind = ?3 AND win = ?4) <= ?5
            AND (SELECT n FROM counters WHERE kind = 'pair' AND win = ?4) <= ?6
            RETURNING user_id, kind`,
      params: [await sha256Hex(code), d.now, client, win, limits.perClient, limits.all, installed ? 1 : 0, d.now - LINK_TTL_MS],
    },
  ]);
  const c = counts[0];
  if (Number(c?.mine) > limits.perClient || Number(c?.everyone) > limits.all) return json({ error: "too many tries" }, 429);
  const userId = used[0]?.user_id;
  if (typeof userId !== "string") return json({ error: "no such code" }, 404);
  // A guest on this device typing a code from their other phone brings their notes along. Only
  // typed: an install code arrives in a link, which anyone could have sent (see the top).
  const before = used[0]?.kind === "manual" ? await session(req, url, d.sql, d.now) : null;
  if (before) await adoptGuest(d.sql, before.userId, userId);
  const token = await newSession(d.sql, userId, d.now);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(url, token) });
}
