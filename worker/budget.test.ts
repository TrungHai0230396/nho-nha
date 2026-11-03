import { describe, expect, it } from "vitest";
import { parse } from "../src/shared/parse";
import type { Note } from "../src/shared/protocol";
import { HOUR, MINUTE, VN_OFFSET } from "../src/shared/wall";
import { DAILY_WRITE_BUDGET, metered, nextUtcDay, rowsWritten, SPENT_FOR_MS, spentFlag, utcDay, writes, WritesSpent, type CountedSql } from "./budget";
import { runCron } from "./cron";
import { testApp } from "./testing/app";
import { changes, countedSql, memorySql } from "./testing/sqlite";

type App = ReturnType<typeof testApp>;

let ids = 0;
function note(text: string, now: number): Note {
  const p = parse(text, now, VN_OFFSET);
  return { id: `budget-note-${String(++ids).padStart(8, "0")}`, text, title: p.title, items: p.items, tags: p.tags, due: p.due, rule: p.rule, nag: p.nag, done: null, pinned: false, deleted: false, created: now, updated: now, group: null, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [] };
}

/**
 * testApp with each request metered as worker/index.ts meters it: a meter
 * of its own, shared memory of the budget being spent, and what it wrote
 * added to the day's count once it has answered.
 */
function budgetApp(start?: number) {
  const app = testApp(start);
  const flag = spentFlag();
  const db = countedSql(app.sql);
  async function metering(send: () => Promise<Response>): Promise<Response> {
    const sql = metered(db, flag, app.deps.now);
    app.deps.sql = sql;
    try {
      return await send();
    } finally {
      app.deps.sql = app.sql;
      await sql.flush();
    }
  }
  return {
    app,
    call: (path: string, init?: Parameters<App["call"]>[1]) => metering(() => app.call(path, init)),
    post: (path: string, body: unknown, cookie?: string) => metering(() => app.post(path, body, cookie)),
  };
}

/** A day's count as the table keeps it. */
const counted = (app: App, at = app.clock.now) => (app.sql.db.prepare("SELECT n FROM daily_writes WHERE day = ?").get(utcDay(at)) as { n: number } | undefined)?.n ?? 0;
/** Today's count set, as if everyone else's requests had written it. */
const spend = (app: App, n = DAILY_WRITE_BUDGET) =>
  app.sql.db.prepare("INSERT INTO daily_writes (day, n) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET n = excluded.n").run(utcDay(app.clock.now), n);
const sync = (b: ReturnType<typeof budgetApp>, cookie: string, notes: Note[]) => b.post("/api/sync", { since: 0, offset: VN_OFFSET, changes: notes }, cookie);

/** A database that notes how often the day's count is read and added to. */
function watched(db: CountedSql) {
  const seen = { reads: 0, adds: 0 };
  const sql: CountedSql = {
    batch(stmts) {
      for (const s of stmts) {
        if (s.sql.startsWith("SELECT n FROM daily_writes")) seen.reads++;
        if (s.sql.startsWith("INSERT INTO daily_writes")) seen.adds++;
      }
      return db.batch(stmts);
    },
  };
  return { seen, sql };
}
const INSERT = (k: number) => ({ sql: "INSERT INTO counters (kind, win, n) VALUES (?1, 0, 1)", params: [`k${k}`] });

describe("the day's D1 write budget", () => {
  it("lets writes through under the budget, and counts every row, its own too", async () => {
    const b = budgetApp();
    const { app } = b;
    const cookie = await app.signIn();
    const before = changes(app.sql);
    expect((await sync(b, cookie, [note("mai 8h gọi mẹ", app.clock.now)])).status).toBe(200);
    // The session kept alive, the note, the account's rev, and the count's own upsert.
    expect(counted(app)).toBe(4);
    expect(changes(app.sql) - before).toBe(4);
    // Added to, request by request.
    expect((await b.call("/api/me", { cookie })).status).toBe(200);
    expect(counted(app)).toBe(changes(app.sql) - before);
    expect(counted(app)).toBe(6);
  });

  it("reads the count once a request, at its first write, and adds to it once, when it is done", async () => {
    const mem = memorySql();
    const { seen, sql: db } = watched(countedSql(mem));
    const sql = metered(db, spentFlag(), () => Date.UTC(2026, 10, 3, 3));
    // Reads alone neither read nor write the count.
    await sql.batch([{ sql: "SELECT COUNT(*) AS n FROM users", params: [] }]);
    await sql.flush();
    expect(seen).toEqual({ reads: 0, adds: 0 });
    for (let k = 0; k < 3; k++) await sql.batch([INSERT(k)]);
    expect(seen).toEqual({ reads: 1, adds: 0 });
    expect(sql.written).toBe(3);
    await sql.flush();
    await sql.flush();
    expect(seen).toEqual({ reads: 1, adds: 1 });
    expect(mem.db.prepare("SELECT day, n FROM daily_writes").all()).toEqual([{ day: utcDay(Date.UTC(2026, 10, 3)), n: 4 }]);
    // Two writes racing at the start of a request share its one read.
    const racing = metered(db, spentFlag(), () => Date.UTC(2026, 10, 3, 3));
    await Promise.all([racing.batch([INSERT(10)]), racing.batch([INSERT(11)])]);
    expect(seen.reads).toBe(2);
  });

  it("refuses the write that would go past it, within a request too", async () => {
    const mem = memorySql();
    const now = () => Date.UTC(2026, 10, 3, 3);
    mem.db.prepare("INSERT INTO daily_writes (day, n) VALUES (?, ?)").run(utcDay(now()), DAILY_WRITE_BUDGET - 2);
    const sql = metered(countedSql(mem), spentFlag(), now);
    await sql.batch([INSERT(1)]);
    await sql.batch([INSERT(2)]);
    await expect(sql.batch([INSERT(3)])).rejects.toBeInstanceOf(WritesSpent);
    // A batch is all or nothing: one write in it, and its reads are refused with it.
    await expect(sql.batch([{ sql: "SELECT 1 AS one", params: [] }, INSERT(4)])).rejects.toBeInstanceOf(WritesSpent);
    expect(await sql.batch([{ sql: "SELECT COUNT(*) AS n FROM counters", params: [] }])).toEqual([[{ n: 2 }]]);
    await sql.flush();
    expect(mem.db.prepare("SELECT n FROM daily_writes").get()).toEqual({ n: DAILY_WRITE_BUDGET + 1 });
  });

  it("answers 503 with the reason once the day's writes are spent, and writes nothing, not even the count", async () => {
    const b = budgetApp();
    const { app } = b;
    const cookie = await app.signIn();
    const { token } = (await (await app.post("/api/tokens", { label: "Siri" }, cookie)).json()) as { token: string };
    spend(app);
    const before = changes(app.sql);
    const res = await sync(b, cookie, [note("mai 8h gọi mẹ", app.clock.now)]);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "out of writes", message: "Hôm nay máy chủ đã hết lượt ghi, 7 giờ sáng mai dùng lại được." });
    // 03:30 UTC: 20 h 30 min to the next UTC day.
    expect(res.headers.get("retry-after")).toBe(String(20.5 * 3600));
    // The shortcut shows the message as it is; "Dùng ngay", the cheapest way to write, makes no one.
    const captured = await b.call("/api/capture", { method: "POST", body: "mua sữa", headers: { authorization: `Bearer ${token}` } });
    expect(captured.status).toBe(503);
    expect(await captured.json()).toMatchObject({ message: "Hôm nay máy chủ đã hết lượt ghi, 7 giờ sáng mai dùng lại được." });
    expect((await b.post("/api/guest", {})).status).toBe(503);
    expect((await b.post("/api/settings", { digestHour: 8 }, cookie)).status).toBe(503);
    // On the way through sign-in, a page that says the same.
    const signIn = await b.call("/dang-nhap");
    expect(signIn.status).toBe(503);
    expect(signIn.headers.get("content-type")).toContain("text/html");
    expect(await signIn.text()).toContain("Hôm nay máy chủ đã hết lượt ghi, 7 giờ sáng mai dùng lại được.");
    expect(changes(app.sql)).toBe(before);
    expect(counted(app)).toBe(DAILY_WRITE_BUDGET);
  });

  it("still reads once the writes are spent: the account, its shortcuts, a group's invite", async () => {
    const b = budgetApp();
    const { app } = b;
    const cookie = await app.signIn();
    await app.post("/api/tokens", { label: "Siri" }, cookie);
    const { id } = (await (await app.post("/api/groups/create", { name: "Nhà", me: "Lan" }, cookie)).json()) as { id: string };
    const synced = (await (await app.post("/api/sync", { since: 0, offset: VN_OFFSET, changes: [] }, cookie)).json()) as { groups: { id: string; code: string }[] };
    const invite = synced.groups.find((g) => g.id === id)!.code;
    spend(app);
    const before = changes(app.sql);
    const me = await b.call("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: "Người thử A", email: "nguoi-a@vi-du.test" });
    const tokens = await b.call("/api/tokens", { cookie });
    expect(tokens.status).toBe(200);
    expect(((await tokens.json()) as { tokens: unknown[] }).tokens).toHaveLength(1);
    const looked = await b.call(`/api/groups/invite?code=${encodeURIComponent(invite)}`);
    expect(await looked.json()).toMatchObject({ name: "Nhà", inviter: "Lan" });
    // Signed in all the same, the session's last use left as it was.
    expect(changes(app.sql)).toBe(before);
    // A made-up session is still nobody's.
    expect((await b.call("/api/me", { cookie: "nhonha=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).status).toBe(401);
  });

  it("starts each UTC day from zero, at 07:00 in Vietnam", async () => {
    // 23:30 UTC, 06:30 in Vietnam: the count starts again this morning.
    const b = budgetApp(Date.UTC(2026, 10, 3, 23, 30));
    const { app } = b;
    const cookie = await app.signIn();
    spend(app);
    const refused = await sync(b, cookie, [note("mai 8h gọi mẹ", app.clock.now)]);
    expect(await refused.json()).toMatchObject({ message: "Máy chủ đã hết lượt ghi, 7 giờ sáng nay dùng lại được." });
    expect(refused.headers.get("retry-after")).toBe(String(30 * 60));
    const yesterday = app.clock.now;
    app.clock.now = nextUtcDay(app.clock.now);
    const before = changes(app.sql);
    expect((await sync(b, cookie, [note("mai 8h gọi mẹ", app.clock.now)])).status).toBe(200);
    expect(counted(app)).toBe(changes(app.sql) - before);
    expect(counted(app)).toBe(4);
    expect(counted(app, yesterday)).toBe(DAILY_WRITE_BUDGET);
  });

  it("remembers for a minute that the budget is spent, so a flood reads the count once a minute", async () => {
    const mem = memorySql();
    let now = Date.UTC(2026, 10, 3, 3);
    mem.db.prepare("INSERT INTO daily_writes (day, n) VALUES (?, ?)").run(utcDay(now), DAILY_WRITE_BUDGET);
    const { seen, sql: db } = watched(countedSql(mem));
    const flag = spentFlag();
    const request = () => metered(db, flag, () => now).batch([INSERT(1)]);
    for (let i = 0; i < 5; i++) await expect(request()).rejects.toBeInstanceOf(WritesSpent);
    expect(seen.reads).toBe(1);
    now += SPENT_FOR_MS;
    await expect(request()).rejects.toBeInstanceOf(WritesSpent);
    expect(seen.reads).toBe(2);
    // Never into the next day: found spent a few seconds before midnight, the first write after it goes through.
    now = nextUtcDay(now) - 5_000;
    await expect(request()).rejects.toBeInstanceOf(WritesSpent);
    expect(seen.reads).toBe(3);
    now += 10_000;
    await expect(request()).resolves.toEqual([[]]);
  });

  it("stops the reminders' writes too: nothing rings, and what is due stays due for the next day", async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const n = note("30p nữa tắt bếp", app.clock.now);
    await app.post("/api/sync", { since: 0, offset: VN_OFFSET, changes: [n] }, cookie);
    app.clock.now += 31 * MINUTE;
    spend(app);
    const due = () => app.sql.db.prepare("SELECT fire_at FROM notes WHERE id = ?").get(n.id) as { fire_at: number | null };
    const was = due().fire_at;
    const run = () => runCron({ sql: metered(countedSql(app.sql), spentFlag(), () => app.clock.now), now: app.clock.now, vapid: null, subject: "", fetch });
    await expect(run()).rejects.toBeInstanceOf(WritesSpent);
    expect(due().fire_at).toBe(was);
    app.clock.now = nextUtcDay(app.clock.now) + HOUR;
    await run();
    expect(due().fire_at).toBeNull();
  });

  it("counts what D1 says a batch wrote, index entries included, else its changes", () => {
    expect(rowsWritten([{ meta: { rows_written: 3, changes: 1 } }, { meta: { rows_written: 0, changes: 0 } }, { meta: { changes: 2 } }, {}])).toBe(5);
  });

  it("takes anything but a SELECT as a write", () => {
    for (const s of ["INSERT INTO x VALUES (1)", "  update x set y = 1", "DELETE FROM x", "REPLACE INTO x VALUES (1)", "INSERT OR IGNORE INTO x VALUES (1)", "UPDATE OR IGNORE x SET y = 1", "WITH a AS (SELECT 1) DELETE FROM x", "PRAGMA user_version = 2"]) {
      expect(writes(s)).toBe(true);
    }
    for (const s of ["SELECT 1", "\n    select n FROM daily_writes"]) expect(writes(s)).toBe(false);
  });
});
