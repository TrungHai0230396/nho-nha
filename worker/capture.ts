// Notes from outside the app: an iPhone shortcut (Siri, the share sheet,
// tapping the back of the phone) posts a line here with a token of the
// person's own, made in the app's settings. The line is read exactly as the
// app reads it, by the clock the person's phone last reported.
import { whenLabel } from "../src/shared/describe";
import { parse, partsOf } from "../src/shared/parse";
import { LIMITS, type Note, type TokenInfo } from "../src/shared/protocol";
import { MINUTE } from "../src/shared/wall";
import { randomToken, sha256Hex } from "./crypto";
import { isObject, json, readJson } from "./http";
import { MAX_NOTES, plan } from "./notes";
import { forUser, type Sql, type UserSql } from "./sql";

export const MAX_TOKENS = 5;
/** Lines one token may send per ten minutes: a person talking to Siri, not a script. */
export const CAPTURE_LIMIT = 30;
/** Notes one line may become ("mai 9h và 15h họp" is two); past it, the line is one note. */
export const MAX_PARTS = 10;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const WINDOW_MS = 10 * MINUTE;

const LIST_SQL = "SELECT id, label, created_at, last_used FROM api_tokens WHERE user_id = ?1 ORDER BY created_at DESC";

async function list(sql: UserSql): Promise<TokenInfo[]> {
  const [rows = []] = await sql.batch([{ sql: LIST_SQL, params: [] }]);
  return rows.map((r) => ({ id: String(r.id), label: String(r.label), created: Number(r.created_at), lastUsed: r.last_used === null ? null : Number(r.last_used) }));
}

/** Signed in: the shortcuts' tokens, a new one (shown this once), or one taken back. */
export async function handleTokens(req: Request, path: string, sql: UserSql, now: number): Promise<Response> {
  if (path === "/api/tokens" && req.method === "GET") return json({ tokens: await list(sql) });
  if (path === "/api/tokens" && req.method === "POST") {
    const b = await readJson(req, 500);
    const label = (isObject(b) && typeof b.label === "string" ? b.label : "").trim().slice(0, 40) || "Phím tắt";
    const token = randomToken(32);
    const [counted = []] = await sql.batch([{ sql: "SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?1", params: [] }]);
    if (Number(counted[0]?.n) >= MAX_TOKENS) return json({ error: "too many" }, 409);
    await sql.batch([
      { sql: "INSERT INTO api_tokens (hash, id, user_id, label, created_at) VALUES (?2, ?3, ?1, ?4, ?5)", params: [await sha256Hex(token), randomToken(9), label, now] },
    ]);
    return json({ token, tokens: await list(sql) });
  }
  if (path === "/api/tokens/revoke" && req.method === "POST") {
    const b = await readJson(req, 500);
    if (!isObject(b) || typeof b.id !== "string") return json({ error: "bad id" }, 400);
    await sql.batch([{ sql: "DELETE FROM api_tokens WHERE user_id = ?1 AND id = ?2", params: [b.id] }]);
    return json({ tokens: await list(sql) });
  }
  return json({ error: "not found" }, 404);
}

// ?14: its place among the notes this line makes, so each has a rev of its own.
const INSERT_SQL = `INSERT INTO notes (user_id, id, text, title, items, tags, due, rule, nag, done, pinned, deleted, created, updated, rev, fire_at, occ, nags_left)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, 0, 0, ?10, ?10, (SELECT rev FROM users WHERE id = ?1) + ?14, ?11, ?12, ?13)`;

/** A line from a shortcut. Answers in words the shortcut can show as they are. */
export async function handleCapture(req: Request, all: Sql, now: number): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const auth = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? "";
  if (!TOKEN.test(token)) return json({ error: "token", message: "Thiếu mã của phím tắt. Tạo lại trong Cài đặt của app." }, 401);
  const hash = await sha256Hex(token);
  const win = Math.floor(now / WINDOW_MS);
  const [, , found = []] = await all.batch([
    { sql: "DELETE FROM counters WHERE win < ?1", params: [win - 1] },
    // Counted only for a token that exists: made-up ones, a row each, would let anyone write to the database.
    {
      sql: `INSERT INTO counters (kind, win, n) SELECT 'cap:' || ?1, ?2, 1 WHERE EXISTS (SELECT 1 FROM api_tokens WHERE hash = ?3)
            ON CONFLICT (kind, win) DO UPDATE SET n = n + 1`,
      params: [hash.slice(0, 32), win, hash],
    },
    {
      sql: `UPDATE api_tokens SET last_used = ?2 WHERE hash = ?1 RETURNING user_id,
              (SELECT tz_offset FROM users WHERE id = api_tokens.user_id) AS offset,
              (SELECT n FROM counters WHERE kind = 'cap:' || ?3 AND win = ?4) AS tries,
              (SELECT COUNT(*) FROM notes WHERE user_id = api_tokens.user_id AND deleted = 0) AS open`,
      params: [hash, now, hash.slice(0, 32), win],
    },
  ]);
  const t = found[0];
  if (!t || typeof t.user_id !== "string") return json({ error: "token", message: "Mã của phím tắt không còn dùng được. Tạo lại trong Cài đặt của app." }, 401);
  if (Number(t.tries) > CAPTURE_LIMIT) return json({ error: "slow down", message: "Gửi nhiều quá, thử lại sau ít phút." }, 429);

  // The shortcut's "Get contents of URL" sends JSON ({"text": …}) or plain text.
  const raw = await req.text();
  if (raw.length > LIMITS.text * 2) return json({ error: "too long", message: "Dài quá, ghi ngắn lại nhé." }, 413);
  let text = raw;
  try {
    const b = JSON.parse(raw) as unknown;
    if (isObject(b) && typeof b.text === "string") text = b.text;
  } catch {
    // Plain text, as it is.
  }
  text = text.trim().slice(0, LIMITS.text);
  if (!text) return json({ error: "empty", message: "Chưa nghe được gì để ghi." }, 400);

  const offset = Number(t.offset ?? 420);
  const whole = parse(text, now, offset);
  // "mai 9h và 15h họp" said to Siri: a note for each time, as typed in the app.
  // Not "1h và 2h và 3h…" for two thousand characters: a statement each, past what a request may run.
  const parts = partsOf(whole, now, offset);
  const lines = parts && parts.length <= MAX_PARTS ? parts : [{ text, parsed: whole }];
  // The cap a phone's sync keeps to (worker/notes.ts), here too.
  if (Number(t.open) + lines.length > MAX_NOTES) {
    return json({ error: "full", message: `Đã có ${String(MAX_NOTES).replace(/\B(?=(\d{3})+$)/g, ".")} ghi chú. Xoá bớt trong app rồi gửi lại.` }, 409);
  }
  const notes: Note[] = lines.map(({ text, parsed: p }) => ({ id: randomToken(16), text, title: p.title.slice(0, LIMITS.title), items: p.items, tags: p.tags, due: p.due, rule: p.rule, nag: p.nag, done: null, pinned: false, deleted: false, created: now, updated: now, group: null, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [] }));
  const sql = forUser(all, t.user_id);
  await sql.batch([
    ...notes.map((note, k) => {
      const pl = plan(note, now, offset);
      return {
        sql: INSERT_SQL,
        params: [note.id, note.text, note.title, note.items ? JSON.stringify(note.items) : null, JSON.stringify(note.tags), note.due, note.rule ? JSON.stringify(note.rule) : null, note.nag ? 1 : 0, now, pl.fire_at, pl.occ, pl.nags_left, k + 1],
      };
    }),
    { sql: "UPDATE users SET rev = rev + ?2 WHERE id = ?1", params: [notes.length] },
  ]);
  const first = notes[0]!;
  const timed = notes.filter((n) => n.due !== null);
  const message = timed.length ? `Đã ghi: ${first.title} · nhắc ${timed.map((n) => whenLabel(n.due!, now, offset)).join(", ")}` : `Đã ghi: ${first.title}`;
  return json({ ok: true, message });
}
