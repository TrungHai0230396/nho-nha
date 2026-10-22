import { describe, expect, it } from "vitest";
import { parse } from "../src/shared/parse";
import type { Note, SyncResponse } from "../src/shared/protocol";
import { DAY, fromWall, MINUTE, VN_OFFSET } from "../src/shared/wall";
import { CAPTURE_LIMIT, MAX_PARTS } from "./capture";
import { runCron } from "./cron";
import { MAX_NOTES, NAGS, NAG_GAP_MS } from "./notes";
import { LINK_TTL_MS, MAX_CODES } from "./pair";
import { cookiePair, ORIGIN, testApp } from "./testing/app";
import { fakeBrowser, readPush, vapidSecret } from "./testing/push";
import { readVapid } from "./webpush";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => fromWall(y, mo, d, h, mi, VN_OFFSET);
let ids = 0;
const newId = () => `note-${String(++ids).padStart(12, "0")}`;

/** A note as the phone makes it from what was typed. */
function noteFrom(text: string, now: number, extra: Partial<Note> = {}): Note {
  const p = parse(text, now, VN_OFFSET);
  return { id: newId(), text, title: p.title, items: p.items, tags: p.tags, due: p.due, rule: p.rule, nag: p.nag, done: null, pinned: false, deleted: false, created: now, updated: now, group: null, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [], ...extra };
}

async function sync(app: ReturnType<typeof testApp>, cookie: string, changes: Note[], since = 0) {
  const res = await app.post("/api/sync", { since, changes, offset: VN_OFFSET }, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as SyncResponse & { rejected: string[] };
}

function row(app: ReturnType<typeof testApp>, id: string) {
  return app.sql.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
}

describe("signing in", () => {
  it("goes through Google and comes back signed in", async () => {
    const app = testApp();
    const cookie = await app.signIn("fake-a");
    const me = await app.call("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: "Người thử A", email: "nguoi-a@vi-du.test", digestHour: 7 });
  });

  it("says signed out without a session, or with a made-up one", async () => {
    const app = testApp();
    expect((await app.call("/api/me")).status).toBe(401);
    expect((await app.call("/api/me", { cookie: "nhonha=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).status).toBe(401);
  });

  it("refuses a change sent from another site", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const res = await app.call("/api/sync", { method: "POST", cookie, body: "{}", headers: { origin: "https://evil.test" } });
    expect(res.status).toBe(403);
  });

  it("signs out, and the session is gone", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const out = await app.post("/api/logout", {}, cookie);
    expect(out.headers.getSetCookie().join()).toContain("Max-Age=0");
    expect((await app.call("/api/me", { cookie })).status).toBe(401);
  });
});

describe("sync", () => {
  it("keeps what one phone wrote for the next phone", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const n = noteFrom("mai 8h gọi mẹ", app.clock.now);
    const first = await sync(app, cookie, [n]);
    expect(first.notes.map((x) => x.id)).toEqual([n.id]);
    const other = await sync(app, cookie, []);
    expect(other.notes).toEqual([n]);
    // Asked again from where it got to: nothing new.
    expect((await sync(app, cookie, [], other.rev)).notes).toEqual([]);
  });

  it("never shows one person's notes to another", async () => {
    const app = testApp();
    const a = await app.signIn("fake-a");
    const b = await app.signIn("fake-b");
    const n = noteFrom("bí mật của A", app.clock.now);
    await sync(app, a, [n]);
    expect((await sync(app, b, [])).notes).toEqual([]);
    // B writing a note with A's id makes B's own note; A's stays A's.
    await sync(app, b, [{ ...n, text: "của B", title: "Của B", updated: n.updated + 1 }]);
    expect((await sync(app, a, [])).notes[0]?.title).toBe("Bí mật của A");
  });

  it("keeps the later of two edits, whichever arrives last", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const n = noteFrom("họp 14:30", app.clock.now);
    await sync(app, cookie, [n]);
    const newer = { ...n, title: "Họp lúc 15h", updated: n.updated + 5_000 };
    const older = { ...n, title: "Họp sửa trên máy cũ", updated: n.updated + 1_000 };
    await sync(app, cookie, [newer]);
    await sync(app, cookie, [older]);
    expect((await sync(app, cookie, [])).notes[0]?.title).toBe("Họp lúc 15h");
  });

  it("does not let a phone whose clock runs ahead win for ever", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const n = noteFrom("đồng hồ chạy nhanh", app.clock.now, { updated: app.clock.now + 30 * 86_400_000 });
    await sync(app, cookie, [n]);
    expect(Number(row(app, n.id)?.updated)).toBeLessThanOrEqual(app.clock.now + MINUTE);
  });

  it("keeps no words of a deleted note", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const n = noteFrom("số tài khoản của mẹ", app.clock.now);
    await sync(app, cookie, [n]);
    await sync(app, cookie, [{ ...n, deleted: true, updated: n.updated + 1 }]);
    const r = row(app, n.id)!;
    expect([r.text, r.title, r.deleted]).toEqual(["", "", 1]);
  });

  it("drops a malformed note, names it, and keeps the rest", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const good = noteFrom("ghi chú tốt", app.clock.now);
    const res = await sync(app, cookie, [good, { ...good, id: "bad id!", text: 5 } as unknown as Note]);
    expect(res.rejected).toEqual(["bad id!"]);
    expect(res.notes.map((x) => x.id)).toEqual([good.id]);
  });

  it("hands back a long history in pages", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const many = Array.from({ length: 200 }, (_, i) => noteFrom(`ghi chú ${i}`, app.clock.now));
    for (let i = 0; i < 3; i++) await sync(app, cookie, many.map((n) => ({ ...n, id: `${n.id}-${i}` })));
    const one = await sync(app, cookie, []);
    expect(one.notes).toHaveLength(500);
    expect(one.more).toBe(true);
    const two = await sync(app, cookie, [], one.rev);
    expect(two.notes).toHaveLength(100);
    expect(two.more).toBe(false);
  });
});

describe("reminders", () => {
  async function withPhone() {
    const app = testApp(at(2026, 10, 12, 10, 30));
    const { secret } = await vapidSecret();
    app.deps.vapidKey = secret;
    const cookie = await app.signIn();
    const browser = await fakeBrowser();
    const endpoint = "https://web.push.apple.com/QGuQyavXutnMsoZu";
    const sub = await app.post("/api/push/subscribe", { endpoint, keys: browser.keys, device: "phone-device-0001" }, cookie);
    expect(sub.status).toBe(200);
    const sent: { url: string; body: Uint8Array }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: new Uint8Array(init.body as ArrayBuffer) });
      return new Response(null, { status: 201 });
    }) as typeof globalThis.fetch;
    const cron = async () => runCron({ sql: app.sql, now: app.clock.now, vapid: await readVapid(secret), subject: "mailto:test@vi-du.test", fetch });
    const read = async (i: number) => JSON.parse(await readPush(sent[i]!.body as never, browser)) as { title: string; body: string; id: string };
    return { app, cookie, sent, cron, read };
  }

  it("rings when the time comes, once", async () => {
    const { app, cookie, sent, cron, read } = await withPhone();
    const n = noteFrom("2 tiếng nữa lấy đồ giặt", app.clock.now);
    await sync(app, cookie, [n]);
    await cron();
    expect(sent).toHaveLength(0);
    app.clock.now = n.due!;
    await cron();
    expect(sent).toHaveLength(1);
    expect(await read(0)).toMatchObject({ title: "Lấy đồ giặt", body: "", id: n.id });
    app.clock.now += 5 * MINUTE;
    await cron();
    expect(sent).toHaveLength(1);
    expect(row(app, n.id)?.fire_at).toBeNull();
  });

  it("nags every ten minutes until answered, then stops", async () => {
    const { app, cookie, sent, cron, read } = await withPhone();
    const n = noteFrom("30p nữa uống thuốc!", app.clock.now);
    await sync(app, cookie, [n]);
    app.clock.now = n.due!;
    await cron();
    app.clock.now += NAG_GAP_MS;
    await cron();
    expect(sent).toHaveLength(2);
    expect((await read(1)).body).toBe("Nhắc lại vì chưa bấm Xong");
    // "Xong" on the phone: no more rings.
    await sync(app, cookie, [{ ...n, done: app.clock.now, updated: app.clock.now }]);
    app.clock.now += NAG_GAP_MS;
    await cron();
    expect(sent).toHaveLength(2);
  });

  it("keeps nagging when the note is changed but not answered: a name fixed, a pin", async () => {
    const { app, cookie, sent, cron } = await withPhone();
    const n = noteFrom("30p nữa uống thuốc!", app.clock.now);
    await sync(app, cookie, [n]);
    app.clock.now = n.due!;
    await cron();
    // Five minutes on, renamed and pinned on the phone, still not ticked off: its time is as it was.
    app.clock.now += 5 * MINUTE;
    await sync(app, cookie, [{ ...n, text: "30p nữa uống thuốc huyết áp!", title: "Uống thuốc huyết áp", pinned: true, updated: app.clock.now }]);
    app.clock.now = n.due! + NAG_GAP_MS;
    await cron();
    expect(sent).toHaveLength(2);
    // Its time changed: planned anew from it.
    await sync(app, cookie, [{ ...n, due: app.clock.now + 60 * MINUTE, updated: app.clock.now }]);
    expect(Number(row(app, n.id)?.fire_at)).toBe(app.clock.now + 60 * MINUTE);
  });

  it("gives up nagging after an hour", async () => {
    const { app, cookie, sent, cron } = await withPhone();
    const n = noteFrom("30p nữa gọi lại cho khách!", app.clock.now);
    await sync(app, cookie, [n]);
    app.clock.now = n.due!;
    for (let i = 0; i < NAGS + 3; i++) {
      await cron();
      app.clock.now += NAG_GAP_MS;
    }
    expect(sent).toHaveLength(1 + NAGS);
  });

  it("rings a repeating one every time, put-off or not", async () => {
    const { app, cookie, sent, cron } = await withPhone();
    const n = noteFrom("mỗi ngày 21h uống thuốc", app.clock.now);
    await sync(app, cookie, [n]);
    app.clock.now = at(2026, 10, 12, 21, 0);
    await cron();
    // Nobody answers; tomorrow it rings again all the same.
    app.clock.now = at(2026, 10, 13, 21, 0);
    await cron();
    expect(sent).toHaveLength(2);
    // Put off by ten minutes: that once only, the next day is 21:00 again.
    await sync(app, cookie, [{ ...n, due: at(2026, 10, 13, 21, 10), updated: app.clock.now }]);
    app.clock.now = at(2026, 10, 13, 21, 10);
    await cron();
    expect(sent).toHaveLength(3);
    expect(Number(row(app, n.id)?.fire_at)).toBe(at(2026, 10, 14, 21, 0));
  });

  it("does not undo a change made while it was ringing", async () => {
    const { app, cookie, cron } = await withPhone();
    const n = noteFrom("10p nữa tắt bếp", app.clock.now);
    await sync(app, cookie, [n]);
    // Put off to later before the cron gets to it: the cron finds nothing due.
    await sync(app, cookie, [{ ...n, due: n.due! + 60 * MINUTE, updated: n.updated + 1 }]);
    app.clock.now = n.due!;
    await cron();
    expect(Number(row(app, n.id)?.fire_at)).toBe(n.due! + 60 * MINUTE);
  });

  it("forgets a phone the push service says is gone", async () => {
    const { app, cookie } = await withPhone();
    const { secret } = await vapidSecret();
    const n = noteFrom("5p nữa họp", app.clock.now);
    await sync(app, cookie, [n]);
    app.clock.now = n.due!;
    const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    await runCron({ sql: app.sql, now: app.clock.now, vapid: await readVapid(secret), subject: "mailto:x@vi-du.test", fetch: gone });
    expect(app.sql.db.prepare("SELECT COUNT(*) AS n FROM push_subs").get()).toEqual({ n: 0 });
  });

  it("sends no more pushes in a run than it may, and the rest next minute", async () => {
    const { app, cookie, sent } = await withPhone();
    const notes = Array.from({ length: 5 }, (_, i) => noteFrom(`${i + 1}p nữa việc ${i}`, app.clock.now));
    await sync(app, cookie, notes);
    app.clock.now += 10 * MINUTE;
    const vapid = await readVapid((app.deps.vapidKey as string) ?? "");
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: new Uint8Array(init.body as ArrayBuffer) });
      return new Response(null, { status: 201 });
    }) as typeof globalThis.fetch;
    await runCron({ sql: app.sql, now: app.clock.now, vapid, subject: "mailto:x@vi-du.test", fetch, cap: 3 });
    expect(sent).toHaveLength(3);
    await runCron({ sql: app.sql, now: app.clock.now + MINUTE, vapid, subject: "mailto:x@vi-du.test", fetch, cap: 3 });
    expect(sent).toHaveLength(5);
  });

  it("says each morning what the day holds, and nothing on an empty day", async () => {
    const { app, cookie, sent, cron, read } = await withPhone();
    // Signed up at 10:30: the first list is tomorrow at seven.
    app.clock.now = at(2026, 10, 13, 7, 0);
    await cron();
    expect(sent).toHaveLength(0);
    await sync(app, cookie, [noteFrom("14h gặp khách", at(2026, 10, 13, 7, 30)), noteFrom("mỗi ngày 21h uống thuốc", at(2026, 10, 13, 7, 30))]);
    // Both ring on the day, and nobody answers either.
    for (const h of [14, 21]) {
      app.clock.now = at(2026, 10, 13, h, 0);
      await cron();
    }
    expect(sent).toHaveLength(2);
    app.clock.now = at(2026, 10, 14, 7, 0);
    await cron();
    expect(sent).toHaveLength(3);
    expect(await read(2)).toMatchObject({ title: "Hôm nay có 1 việc", body: "21:00 Uống thuốc\nCòn 1 việc đã qua giờ chưa xong" });
  });
});

describe("pairing a phone", () => {
  it("lets the installed app sign itself in with the code it was installed with, once", async () => {
    const app = testApp();
    const safari = await app.signIn();
    const { code } = (await (await app.post("/api/pair/install", {}, safari)).json()) as { code: string };
    const manifest = (await (await app.call(`/cai/${code}/manifest.webmanifest`)).json()) as { start_url: string; id: string };
    expect(manifest).toMatchObject({ start_url: `/cai/${code}/`, id: "/" });
    const first = await app.post("/api/pair", { code, app: true });
    expect(first.status).toBe(200);
    const app2 = cookiePair(first, "nhonha");
    expect((await app.call("/api/me", { cookie: app2 })).status).toBe(200);
    expect((await app.post("/api/pair", { code, app: true })).status).toBe(404);
  });

  it("lets a browser in with an install code only while it is fresh, and the installed app for a month", async () => {
    const app = testApp();
    const safari = await app.signIn();
    const mint = async () => ((await (await app.post("/api/pair/install", {}, safari)).json()) as { code: string }).code;
    // Zalo's browser out to Safari: made, then opened at once.
    expect((await app.post("/api/pair", { code: await mint() })).status).toBe(200);
    // A link posted somewhere, opened later in a browser: refused, and not spent…
    const posted = await mint();
    app.clock.now += LINK_TTL_MS + MINUTE;
    expect((await app.post("/api/pair", { code: posted })).status).toBe(404);
    // …since the installed app made from that page still needs it, weeks on.
    app.clock.now += 20 * DAY;
    expect((await app.post("/api/pair", { code: posted, app: true })).status).toBe(200);
  });

  it("keeps a person's newest install codes, not every one ever asked for", async () => {
    const app = testApp();
    const safari = await app.signIn();
    const codes: string[] = [];
    for (let i = 0; i < MAX_CODES + 2; i++) codes.push(((await (await app.post("/api/pair/install", {}, safari)).json()) as { code: string }).code);
    expect((app.sql.db.prepare("SELECT COUNT(*) AS n FROM pair_codes").get() as { n: number }).n).toBe(MAX_CODES);
    expect((await app.post("/api/pair", { code: codes[0], app: true })).status).toBe(404);
    expect((await app.post("/api/pair", { code: codes.at(-1), app: true })).status).toBe(200);
  });

  it("takes a typed code however it is typed, until it expires", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const { code } = (await (await app.post("/api/pair/code", {}, cookie)).json()) as { code: string };
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const typed = `${code.slice(0, 4).toLowerCase()} - ${code.slice(4)}`;
    expect((await app.post("/api/pair", { code: typed })).status).toBe(200);
    const late = await (await app.post("/api/pair/code", {}, cookie)).json() as { code: string };
    app.clock.now += 11 * MINUTE;
    expect((await app.post("/api/pair", { code: late.code })).status).toBe(404);
  });

  it("stops someone guessing", async () => {
    const app = testApp();
    app.deps.pairLimits = { perClient: 3, all: 100 };
    const req = () => app.post("/api/pair", { code: "AAAABBBB" });
    for (let i = 0; i < 3; i++) expect((await req()).status).toBe(404);
    expect((await req()).status).toBe(429);
  });

  it("refuses a code spent from another site's page", async () => {
    const app = testApp();
    const res = await app.call("/api/pair", { method: "POST", body: JSON.stringify({ code: "AAAABBBB" }), headers: { origin: "https://evil.test" } });
    expect(res.status).toBe(403);
  });
});

describe("shortcuts", () => {
  it("adds a note from a line, read as the app reads it", async () => {
    const app = testApp(at(2026, 10, 12, 10, 30));
    const cookie = await app.signIn();
    const made = (await (await app.post("/api/tokens", { label: "Siri" }, cookie)).json()) as { token: string; tokens: { id: string }[] };
    const res = await app.call("/api/capture", { method: "POST", body: JSON.stringify({ text: "mai 8h gọi mẹ" }), headers: { authorization: `Bearer ${made.token}` } });
    expect(await res.json()).toEqual({ ok: true, message: "Đã ghi: Gọi mẹ · nhắc 08:00 · mai, T3 13/10" });
    const plain = await app.call("/api/capture", { method: "POST", body: "mua sữa", headers: { authorization: `Bearer ${made.token}` } });
    expect(plain.status).toBe(200);
    const notes = (await sync(app, cookie, [])).notes;
    expect(notes.map((n) => n.title).sort()).toEqual(["Gọi mẹ", "Mua sữa"]);
    expect(notes.find((n) => n.title === "Gọi mẹ")?.due).toBe(at(2026, 10, 13, 8, 0));
    // Taken back: it works no more.
    await app.post("/api/tokens/revoke", { id: made.tokens[0]!.id }, cookie);
    const after = await app.call("/api/capture", { method: "POST", body: "nữa", headers: { authorization: `Bearer ${made.token}` } });
    expect(after.status).toBe(401);
  });

  it("makes a note for each time of a line said once with several", async () => {
    const app = testApp(at(2026, 10, 12, 10, 30));
    const cookie = await app.signIn();
    const made = (await (await app.post("/api/tokens", { label: "Siri" }, cookie)).json()) as { token: string };
    const res = await app.call("/api/capture", { method: "POST", body: JSON.stringify({ text: "mai 9h và 15h họp" }), headers: { authorization: `Bearer ${made.token}` } });
    expect(await res.json()).toEqual({ ok: true, message: "Đã ghi: Họp · nhắc 09:00 · mai, T3 13/10, 15:00 · mai, T3 13/10" });
    const answer = await sync(app, cookie, []);
    expect(answer.notes.map((n) => [n.text, n.due]).sort()).toEqual([
      ["mai 15h họp", at(2026, 10, 13, 15, 0)],
      ["mai 9h họp", at(2026, 10, 13, 9, 0)],
    ]);
    // Each with a rev of its own, both under the account's.
    expect(new Set(app.sql.db.prepare("SELECT rev FROM notes").all().map((r) => (r as { rev: number }).rev)).size).toBe(2);
    expect(answer.rev).toBe(2);
  });

  it("refuses a missing or made-up token, writing nothing for it", async () => {
    const app = testApp();
    expect((await app.call("/api/capture", { method: "POST", body: "x" })).status).toBe(401);
    for (const c of "ABC") expect((await app.call("/api/capture", { method: "POST", body: "x", headers: { authorization: `Bearer ${c.repeat(43)}` } })).status).toBe(401);
    expect((app.sql.db.prepare("SELECT COUNT(*) AS n FROM counters").get() as { n: number }).n).toBe(0);
  });

  it("slows a real token down past its lines per ten minutes", async () => {
    const app = testApp(at(2026, 10, 12, 10, 30));
    const cookie = await app.signIn();
    const { token } = (await (await app.post("/api/tokens", { label: "Siri" }, cookie)).json()) as { token: string };
    const send = () => app.call("/api/capture", { method: "POST", body: "mua sữa", headers: { authorization: `Bearer ${token}` } });
    for (let i = 0; i < CAPTURE_LIMIT; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  it("makes at most ten notes of one line, and none past the notes an account may keep", async () => {
    const app = testApp(at(2026, 10, 12, 6, 0));
    const cookie = await app.signIn();
    const { token } = (await (await app.post("/api/tokens", { label: "Siri" }, cookie)).json()) as { token: string };
    const send = (text: string) => app.call("/api/capture", { method: "POST", body: text, headers: { authorization: `Bearer ${token}` } });
    const hours = (n: number) => Array.from({ length: n }, (_, i) => `${8 + i}h`).join(", ");
    const open = () => (app.sql.db.prepare("SELECT COUNT(*) AS n FROM notes WHERE deleted = 0").get() as { n: number }).n;
    expect((await send(`${hours(MAX_PARTS)} họp`)).status).toBe(200);
    expect(open()).toBe(MAX_PARTS);
    // One more time on the line and it is one note, not eleven.
    expect((await send(`${hours(MAX_PARTS + 1)} họp`)).status).toBe(200);
    expect(open()).toBe(MAX_PARTS + 1);
    // Filled up to one short of the cap: one more note goes in, two do not.
    const user = (app.sql.db.prepare("SELECT user_id FROM api_tokens").get() as { user_id: string }).user_id;
    const fill = app.sql.db.prepare("INSERT INTO notes (user_id, id, text, title, created, updated, rev) VALUES (?, ?, 'x', 'x', 0, 0, 0)");
    for (let i = open(); i < MAX_NOTES - 1; i++) fill.run(user, `fill-${String(i).padStart(12, "0")}`);
    expect((await send("mai 9h và 15h họp")).status).toBe(409);
    expect((await send("mua sữa")).status).toBe(200);
    const full = await send("mua bánh");
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ message: "Đã có 5.000 ghi chú. Xoá bớt trong app rồi gửi lại." });
  });
});

describe("deleting the account", () => {
  it("wants it typed out, then leaves nothing of the person", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const other = await app.signIn("fake-b");
    await sync(app, cookie, [noteFrom("của tôi", app.clock.now)]);
    await sync(app, other, [noteFrom("của người khác", app.clock.now)]);
    await app.post("/api/tokens", {}, cookie);
    expect((await app.post("/api/account/delete", { confirm: "xoa" }, cookie)).status).toBe(400);
    expect((await app.post("/api/account/delete", { confirm: "XOA" }, cookie)).status).toBe(200);
    const count = (t: string) => (app.sql.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect([count("users"), count("notes"), count("sessions"), count("api_tokens")]).toEqual([1, 1, 1, 0]);
    expect((await app.call("/api/me", { cookie })).status).toBe(401);
  });
});

describe("pages", () => {
  it("says whether Google sign-in is on, so the app offers only what works", async () => {
    const app = testApp();
    expect(await (await app.call("/api/config")).json()).toEqual({ google: true });
    app.deps.google = null;
    expect(await (await app.call("/api/config")).json()).toEqual({ google: false });
    // Without Google, "Dùng ngay" still lets people in.
    expect((await app.post("/api/guest", {})).status).toBe(200);
  });

  it("serves the app shell for an install link, and sends a bad one home", async () => {
    const app = testApp();
    const ok = await app.call(`/cai/${"a".repeat(43)}/`);
    expect(ok.headers.get("content-security-policy")).toContain("default-src 'self'");
    const bad = await app.call("/cai/xyz/");
    expect(bad.status).toBe(302);
    expect(bad.headers.get("location")).toBe(`${ORIGIN}/`);
  });
});
