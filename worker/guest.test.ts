import { describe, expect, it } from "vitest";
import { parse } from "../src/shared/parse";
import type { Me, Note, SyncResponse } from "../src/shared/protocol";
import { DAY, VN_OFFSET } from "../src/shared/wall";
import { runCron } from "./cron";
import { sweepGuests } from "./guest";
import { SESSION_IDLE_MS } from "./session";
import { cookiePair, testApp } from "./testing/app";

let n = 0;
function note(text: string, now: number): Note {
  const p = parse(text, now, VN_OFFSET);
  return { id: `guest-note-${String(++n).padStart(10, "0")}`, text, title: p.title, items: p.items, tags: p.tags, due: p.due, rule: p.rule, nag: p.nag, done: null, pinned: false, deleted: false, created: now, updated: now, group: null, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [] };
}

async function guest(app: ReturnType<typeof testApp>) {
  const res = await app.post("/api/guest", {});
  expect(res.status).toBe(200);
  return { cookie: cookiePair(res, "nhonha"), me: (await res.json()) as Me };
}

async function sync(app: ReturnType<typeof testApp>, cookie: string, changes: Note[] = [], since = 0) {
  const res = await app.post("/api/sync", { since, changes, offset: VN_OFFSET }, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as SyncResponse;
}

const count = (app: ReturnType<typeof testApp>, sql: string) => (app.sql.db.prepare(sql).get() as { n: number }).n;

describe("using the app without signing in", () => {
  it("starts at once, as an account of this device only", async () => {
    const app = testApp();
    const { cookie, me } = await guest(app);
    expect(me).toMatchObject({ guest: true, name: "", email: "" });
    expect(await (await app.call("/api/me", { cookie })).json()).toMatchObject({ id: me.id, guest: true });
    await sync(app, cookie, [note("mai 8h gọi mẹ", app.clock.now)]);
    expect((await sync(app, cookie)).notes.map((x) => x.title)).toEqual(["Gọi mẹ"]);
  });

  it("is not something another site can start", async () => {
    const app = testApp();
    const res = await app.call("/api/guest", { method: "POST", body: "{}", headers: { origin: "https://evil.test" } });
    expect(res.status).toBe(403);
  });

  it("stops a flood of new guests", async () => {
    const app = testApp();
    app.deps.guestLimits = { perClient: 2, all: 100 };
    await guest(app);
    await guest(app);
    expect((await app.post("/api/guest", {})).status).toBe(429);
  });

  it("brings everything along when the guest signs in with Google", async () => {
    const app = testApp();
    // The Google account already has a phone with a note on it.
    const phone = await app.signIn("fake-a");
    await sync(app, phone, [note("của máy cũ", app.clock.now)]);
    const seen = await sync(app, phone);
    // On another device, someone starts without signing in…
    const g = await guest(app);
    await sync(app, g.cookie, [note("mai 8h gọi mẹ", app.clock.now), note("đi chợ: trứng, sữa", app.clock.now)]);
    await app.post("/api/tokens", { label: "Siri" }, g.cookie);
    // …then signs in with Google on that same device.
    const start = await app.call("/dang-nhap", { cookie: g.cookie });
    const chooser = await app.call(new URL(start.headers.get("location")!).pathname + new URL(start.headers.get("location")!).search);
    const pick = [...(await chooser.text()).matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&")).find((l) => l.includes("code=") && atob(new URL(l).searchParams.get("code")!.replace(/-/g, "+").replace(/_/g, "/")).includes('"fake-a"'))!;
    const back = await app.call(new URL(pick).pathname + new URL(pick).search, { cookie: `${cookiePair(start, "nhonha-signin")}; ${g.cookie}` });
    expect(back.status).toBe(302);
    const signedIn = cookiePair(back, "nhonha");
    // The device now sees all three, as the Google account…
    expect((await sync(app, signedIn)).notes.map((x) => x.title).sort()).toEqual(["Của máy cũ", "Gọi mẹ", "Đi chợ"]);
    // …the old phone picks up the two new ones from where it was…
    expect((await sync(app, phone, [], seen.rev)).notes.map((x) => x.title).sort()).toEqual(["Gọi mẹ", "Đi chợ"]);
    // …the shortcut keeps working for the account, and the guest is gone.
    expect(count(app, "SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = (SELECT id FROM users WHERE google_sub = 'fake-a')")).toBe(1);
    expect(count(app, "SELECT COUNT(*) AS n FROM users WHERE guest = 1")).toBe(0);
    expect((await app.call("/api/me", { cookie: g.cookie })).status).toBe(401);
  });

  it("brings everything along when the guest pairs with a code from a signed-in phone", async () => {
    const app = testApp();
    const phone = await app.signIn("fake-a");
    const { code } = (await (await app.post("/api/pair/code", {}, phone)).json()) as { code: string };
    const g = await guest(app);
    await sync(app, g.cookie, [note("ghi khi chưa đăng nhập", app.clock.now)]);
    const paired = await app.post("/api/pair", { code }, g.cookie);
    expect(paired.status).toBe(200);
    expect((await sync(app, phone)).notes.map((x) => x.title)).toEqual(["Ghi khi chưa đăng nhập"]);
  });

  it("keeps the guest's notes when a link with someone's install code is opened", async () => {
    const app = testApp();
    const stranger = await app.signIn("fake-a");
    const { code } = (await (await app.post("/api/pair/install", {}, stranger)).json()) as { code: string };
    const g = await guest(app);
    await sync(app, g.cookie, [note("9h uống thuốc", app.clock.now)]);
    // Fresh, so a browser still takes it: the page is signed in as the stranger…
    expect((await app.post("/api/pair", { code }, g.cookie)).status).toBe(200);
    // …but what the guest wrote did not go with it.
    expect((await sync(app, stranger)).notes).toEqual([]);
    expect((await sync(app, g.cookie)).notes.map((x) => x.title)).toEqual(["Uống thuốc"]);
  });

  it("never merges a signed-in account away", async () => {
    const app = testApp();
    const a = await app.signIn("fake-a");
    const b = await app.signIn("fake-b");
    await sync(app, b, [note("của B", app.clock.now)]);
    const { code } = (await (await app.post("/api/pair/code", {}, a)).json()) as { code: string };
    await app.post("/api/pair", { code }, b);
    expect((await sync(app, b)).notes.map((x) => x.title)).toEqual(["Của B"]);
    expect((await sync(app, a)).notes).toEqual([]);
  });

  it("sweeps guests nobody can reach any more, and only them", async () => {
    const app = testApp();
    const gone = await guest(app);
    await sync(app, gone.cookie, [note("bị bỏ quên", app.clock.now)]);
    app.clock.now += SESSION_IDLE_MS + 2 * DAY;
    const kept = await guest(app);
    const google = await app.signIn("fake-a");
    expect(await sweepGuests(app.sql, app.clock.now)).toBe(1);
    expect(count(app, "SELECT COUNT(*) AS n FROM notes")).toBe(0);
    expect((await app.call("/api/me", { cookie: kept.cookie })).status).toBe(200);
    expect((await app.call("/api/me", { cookie: google })).status).toBe(200);
  });

  it("runs the sweep from the cron once a day, at three in the morning", async () => {
    const app = testApp();
    await guest(app);
    app.clock.now += SESSION_IDLE_MS + 2 * DAY;
    const at = (h: number) => Date.UTC(2027, 10, 20, h, 0);
    await runCron({ sql: app.sql, now: at(19), vapid: null, subject: "", fetch });
    expect(count(app, "SELECT COUNT(*) AS n FROM users")).toBe(1);
    await runCron({ sql: app.sql, now: at(20), vapid: null, subject: "", fetch });
    expect(count(app, "SELECT COUNT(*) AS n FROM users")).toBe(0);
  });
});
