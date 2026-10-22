import { describe, expect, it } from "vitest";
import { DAY, HOUR, MINUTE, startOfDay, VN_OFFSET } from "../src/shared/wall";
import { runCron } from "./cron";
import { testApp } from "./testing/app";

type App = ReturnType<typeof testApp>;
type Row = Record<string, unknown>;

// Ids as src/lib/count.ts makes them (newId: 22 characters).
const ONE = "AAAAAAAAAAAAAAAAAAAAA1";
const TWO = "BBBBBBBBBBBBBBBBBBBBB2";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

function report(app: App, body: unknown, headers: Record<string, string> = {}, cookie?: string) {
  return app.call("/api/device", { method: "POST", body: JSON.stringify(body), cookie, headers: { "content-type": "application/json", ...headers } });
}
const tell = (app: App, device: string, standalone: boolean, platform = "iphone", headers?: Record<string, string>) => report(app, { device, standalone, platform }, headers);

/** The day a moment falls on, as a row keeps it: its start, Vietnam time. */
const day = (at: number) => startOfDay(at, VN_OFFSET);
/** Rows SQLite has written since the database was opened: what D1's free plan counts. */
const written = (app: App) => (app.sql.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
const devices = (app: App) => app.sql.db.prepare("SELECT * FROM devices ORDER BY id").all() as Row[];

/** Every row of every table, as text: to look for what must not be anywhere. */
function everything(app: App): string {
  const tables = app.sql.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return JSON.stringify(tables.map((t) => [t.name, app.sql.db.prepare(`SELECT * FROM "${t.name}"`).all()]));
}

describe("counting installs", () => {
  it("keeps a device once, with the days it was first and last seen", async () => {
    const app = testApp();
    const first = day(app.clock.now);
    expect((await tell(app, ONE, false)).status).toBe(200);
    expect(devices(app)).toEqual([{ id: ONE, platform: "iphone", standalone: 0, first_seen: first, last_seen: first }]);
    app.clock.now += DAY;
    expect((await tell(app, ONE, false)).status).toBe(200);
    expect(devices(app)).toEqual([{ id: ONE, platform: "iphone", standalone: 0, first_seen: first, last_seen: first + DAY }]);
  });

  it("writes three rows for a new device, none more that day, and one a day after", async () => {
    // 10:30 in Vietnam.
    const app = testApp();
    const first = day(app.clock.now);
    let before = written(app);
    await tell(app, ONE, true);
    // The device, and the two counters that limit new ones.
    expect(written(app) - before).toBe(3);
    before = written(app);
    // 10:35, the same day: answered, and nothing written.
    app.clock.now += 5 * MINUTE;
    expect((await tell(app, ONE, true)).status).toBe(200);
    expect((await tell(app, ONE, false)).status).toBe(200);
    expect(written(app) - before).toBe(0);
    // 22:35: only the two counters go, their window over (any limited route clears them); the device is not written.
    app.clock.now += 12 * HOUR;
    expect((await tell(app, ONE, true)).status).toBe(200);
    expect(written(app) - before).toBe(2);
    expect(devices(app)[0]).toMatchObject({ standalone: 1, last_seen: first });
    // 00:35, the next day in Vietnam: one row.
    before = written(app);
    app.clock.now += 2 * HOUR;
    expect((await tell(app, ONE, true)).status).toBe(200);
    expect(written(app) - before).toBe(1);
    expect(devices(app)[0]).toMatchObject({ first_seen: first, last_seen: first + DAY });
  });

  it("counts a device as installed from the day it first runs as the app, whichever way it is opened after", async () => {
    // Android: a tab and the installed app share one device.
    const app = testApp();
    await tell(app, ONE, false, "android");
    expect(devices(app)[0]).toMatchObject({ standalone: 0 });
    // Installed later that day: told again, and kept.
    let before = written(app);
    expect((await tell(app, ONE, true, "android")).status).toBe(200);
    expect(written(app) - before).toBe(1);
    expect(devices(app)[0]).toMatchObject({ standalone: 1 });
    // A tab again, that day and the next: still installed.
    before = written(app);
    await tell(app, ONE, false, "android");
    expect(written(app) - before).toBe(0);
    app.clock.now += DAY;
    await tell(app, ONE, false, "android");
    expect(devices(app)[0]).toMatchObject({ standalone: 1, last_seen: day(app.clock.now) });
  });

  it("refuses anything but a report, and writes nothing for it", async () => {
    const app = testApp();
    const before = written(app);
    const ok = { device: ONE, standalone: true, platform: "iphone" };
    const bad: unknown[] = [
      // Anything more is refused, so nothing more is ever kept.
      { ...ok, ua: UA },
      { ...ok, user: "u1" },
      { device: ONE, standalone: true },
      { ...ok, device: "AAAA" },
      { ...ok, device: `${ONE}A` },
      { ...ok, device: "AAAAAAAAAAAAAAAAAAAA/=" },
      { ...ok, device: 12345 },
      { ...ok, standalone: "true" },
      { ...ok, standalone: 1 },
      { ...ok, platform: "iPhone" },
      { ...ok, platform: "linux" },
      { ...ok, platform: null },
      [ok],
      "iphone",
      null,
    ];
    for (const b of bad) expect((await report(app, b)).status, JSON.stringify(b)).toBe(400);
    expect((await app.call("/api/device", { method: "POST", body: "{device:" })).status).toBe(400);
    expect((await report(app, { ...ok, pad: "x".repeat(300) })).status).toBe(400);
    // Another site's page cannot add to the count; and it is a POST.
    expect((await app.call("/api/device", { method: "POST", body: JSON.stringify(ok), headers: { origin: "https://evil.test" } })).status).toBe(403);
    expect((await app.call("/api/device")).status).toBe(405);
    expect(devices(app)).toEqual([]);
    expect(written(app) - before).toBe(0);
    // While the report as the app sends it gets in.
    expect((await report(app, ok)).status).toBe(200);
  });

  it("keeps nothing of who sent it: no account, no address, no user agent", async () => {
    const app = testApp();
    const cookie = await app.signIn("fake-a");
    const user = (app.sql.db.prepare("SELECT id FROM users").get() as { id: string }).id;
    const sessions = app.sql.db.prepare("SELECT * FROM sessions").all();
    app.clock.now += MINUTE;
    const res = await report(app, { device: ONE, standalone: true, platform: "iphone" }, { "user-agent": UA, "cf-connecting-ip": "203.0.113.7" }, cookie);
    expect(res.status).toBe(200);
    // Its row has a place for nothing else.
    expect((app.sql.db.prepare("SELECT name FROM pragma_table_info('devices')").all() as { name: string }[]).map((c) => c.name)).toEqual([
      "id",
      "platform",
      "standalone",
      "first_seen",
      "last_seen",
    ]);
    // Nor the time of day, which could be matched to the sign-in a minute before: only the day.
    expect(devices(app)).toEqual([{ id: ONE, platform: "iphone", standalone: 1, first_seen: day(app.clock.now), last_seen: day(app.clock.now) }]);
    expect(day(app.clock.now)).not.toBe(app.clock.now);
    // Nothing the request carried is anywhere in the database, and the device is nowhere but its row.
    const all = everything(app);
    expect(all).not.toContain("203.0.113.7");
    expect(all).not.toContain("iPhone OS");
    expect(all.split(ONE)).toHaveLength(2);
    expect(JSON.stringify(devices(app))).not.toContain(user);
    // The session that came along was not even looked at.
    expect(app.sql.db.prepare("SELECT * FROM sessions").all()).toEqual(sessions);
  });

  it("lets in only so many new devices at once, never holding back one already counted", async () => {
    const app = testApp();
    app.deps.deviceLimits = { perClient: 2, all: 3 };
    const from = (ip: string) => ({ "cf-connecting-ip": ip });
    const id = (n: number) => `C${String(n).padStart(21, "0")}`;
    expect((await tell(app, id(1), false, "android", from("198.51.100.1"))).status).toBe(200);
    expect((await tell(app, id(2), false, "android", from("198.51.100.1"))).status).toBe(200);
    // A third new one from that address waits…
    expect((await tell(app, id(3), false, "android", from("198.51.100.1"))).status).toBe(429);
    // …while another address still gets in, until everyone's limit is reached.
    expect((await tell(app, id(4), false, "android", from("198.51.100.2"))).status).toBe(200);
    expect((await tell(app, id(5), false, "android", from("198.51.100.3"))).status).toBe(429);
    // Past both, a flood from many addresses writes nothing at all.
    const before = written(app);
    for (let i = 10; i < 40; i++) expect((await tell(app, id(i), true, "other", from(`198.51.100.${i}`))).status).toBe(429);
    expect(written(app) - before).toBe(0);
    // A device already counted still is, the day it is installed included.
    expect((await tell(app, id(1), true, "android", from("198.51.100.1"))).status).toBe(200);
    expect(devices(app).find((d) => d.id === id(1))).toMatchObject({ standalone: 1 });
    // Ten minutes on there is room again, for the one that waited.
    app.clock.now += 10 * MINUTE;
    expect((await tell(app, id(3), false, "android", from("198.51.100.1"))).status).toBe(200);
    expect(devices(app).map((d) => d.id)).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it("forgets a device unseen for 90 days, at three in the morning", async () => {
    const app = testApp();
    await tell(app, ONE, true);
    app.clock.now += 60 * DAY;
    await tell(app, TWO, false, "windows");
    // 03:00 in Vietnam (20:00 UTC) on 11/1/2027: more than 90 days after the day ONE was last seen, 12/10.
    const at = (h: number) => Date.UTC(2027, 0, 10, h, 0);
    await runCron({ sql: app.sql, now: at(19), vapid: null, subject: "", fetch });
    expect(devices(app).map((d) => d.id)).toEqual([ONE, TWO]);
    await runCron({ sql: app.sql, now: at(20), vapid: null, subject: "", fetch });
    expect(devices(app).map((d) => d.id)).toEqual([TWO]);
  });

  it("says so on the privacy page", async () => {
    const text = await (await testApp().call("/rieng-tu")).text();
    expect(text).toContain("mã ngẫu nhiên");
    expect(text).toContain("90 ngày");
  });
});
