// "Nhắc chung", both ways: what a member may do goes through, and what an
// outsider (or someone who left, or a forged name) tries is refused.
import { describe, expect, it } from "vitest";
import { parse } from "../src/shared/parse";
import { LIMITS, type GroupSync, type Me, type Note, type SyncResponse } from "../src/shared/protocol";
import { fromWall, MINUTE, VN_OFFSET } from "../src/shared/wall";
import { runCron } from "./cron";
import { cookiePair, testApp } from "./testing/app";
import { fakeBrowser, readPush, vapidSecret } from "./testing/push";
import { readVapid } from "./webpush";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => fromWall(y, mo, d, h, mi, VN_OFFSET);
let ids = 0;
const newId = () => `gnote-${String(++ids).padStart(12, "0")}`;

type App = ReturnType<typeof testApp>;
type Answer = SyncResponse & { rejected: string[] };

function noteIn(group: string | null, text: string, now: number, extra: Partial<Note> = {}): Note {
  const p = parse(text, now, VN_OFFSET);
  return { id: newId(), text, title: p.title, items: p.items, tags: p.tags, due: p.due, rule: p.rule, nag: p.nag, done: null, pinned: false, deleted: false, created: now, updated: now, group, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [], ...extra };
}

async function sync(app: App, cookie: string, changes: Note[] = [], groups: Record<string, number> = {}): Promise<Answer> {
  const res = await app.post("/api/sync", { since: 0, changes, offset: VN_OFFSET, groups }, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as Answer;
}

async function guest(app: App) {
  const res = await app.post("/api/guest", {});
  expect(res.status).toBe(200);
  return { cookie: cookiePair(res, "nhonha"), me: (await res.json()) as Me };
}

/** A makes "Gia đình", B joins it with the invite; both cookies, the group, its code. */
async function family(app: App) {
  const a = await app.signIn("fake-a");
  const b = await app.signIn("fake-b");
  const made = await app.post("/api/groups/create", { name: "Gia đình", me: "Hải" }, a);
  expect(made.status).toBe(200);
  const { id } = (await made.json()) as { id: string };
  const code = (await sync(app, a)).groups[0]!.code;
  const joined = await app.post("/api/groups/join", { code, me: "Lan" }, b);
  expect(joined.status).toBe(200);
  return { a, b, id, code };
}

const groupOf = (r: Answer, id: string) => r.groups.find((g) => g.id === id) as GroupSync | undefined;

describe("a group", () => {
  it("is made, shown through its invite before signing in, and joined", async () => {
    const app = testApp();
    const { a, b, id, code } = await family(app);
    const preview = await app.call(`/api/groups/invite?code=${encodeURIComponent(code)}`);
    expect(await preview.json()).toEqual({ name: "Gia đình", inviter: "Hải", members: 2 });
    for (const [cookie, me] of [
      [a, "Hải"],
      [b, "Lan"],
    ] as const) {
      const g = groupOf(await sync(app, cookie), id)!;
      expect(g.name).toBe("Gia đình");
      expect(g.members.map((m) => [m.name, m.owner])).toEqual([
        ["Hải", true],
        ["Lan", false],
      ]);
      expect(g.members.find((m) => m.me)?.name).toBe(me);
      expect(g.owner).toBe(me === "Hải");
    }
  });

  it("tells the others when someone joins, and nobody when they were in already", async () => {
    const app = testApp();
    const { secret } = await vapidSecret();
    const pending: Promise<unknown>[] = [];
    const sent: { url: string; body: Uint8Array }[] = [];
    Object.assign(app.deps, {
      vapidKey: secret,
      subject: "mailto:test@vi-du.test",
      background: (p: Promise<unknown>) => void pending.push(p),
      fetch: (async (url: string, init: RequestInit) => {
        sent.push({ url, body: new Uint8Array(init.body as ArrayBuffer) });
        return new Response(null, { status: 201 });
      }) as typeof globalThis.fetch,
    });
    const a = await app.signIn("fake-a");
    const b = await app.signIn("fake-b");
    const phoneA = await fakeBrowser();
    const phoneB = await fakeBrowser();
    await app.post("/api/push/subscribe", { endpoint: "https://web.push.apple.com/hai", keys: phoneA.keys, device: "hai-device-00001" }, a);
    await app.post("/api/push/subscribe", { endpoint: "https://web.push.apple.com/lan", keys: phoneB.keys, device: "lan-device-00001" }, b);
    await app.post("/api/groups/create", { name: "Gia đình", me: "Hải" }, a);
    const code = (await sync(app, a)).groups[0]!.code;
    await app.post("/api/groups/join", { code, me: "Lan" }, b);
    await Promise.all(pending);
    // Hải's phone only: Lan knows she joined.
    expect(sent.map((s) => s.url)).toEqual(["https://web.push.apple.com/hai"]);
    expect(JSON.parse(await readPush(sent[0]!.body as never, phoneA))).toMatchObject({ title: "Lan đã vào nhóm Gia đình", body: "" });
    // The same invite again: already in, nothing new to tell.
    await app.post("/api/groups/join", { code, me: "Lan" }, b);
    await Promise.all(pending);
    expect(sent).toHaveLength(1);
  });

  it("is not joined with a made-up or tampered invite", async () => {
    const app = testApp();
    const { id, code } = await family(app);
    const c = await guest(app);
    const tampered = `${code.slice(0, -1)}${code.endsWith("0") ? "1" : "0"}`;
    for (const bad of [tampered, `${id}.${"0".repeat(32)}`, "g_nope.0", ""]) {
      const res = await app.post("/api/groups/join", { code: bad, me: "Ai đó" }, c.cookie);
      expect([400, 404]).toContain(res.status);
    }
    expect((await app.call(`/api/groups/invite?code=${encodeURIComponent(tampered)}`)).status).toBe(404);
    expect((await sync(app, c.cookie)).groups).toEqual([]);
  });

  it("shares its notes: a member's change reaches the others, an outsider's is refused", async () => {
    const app = testApp();
    const { a, b, id } = await family(app);
    const now = app.clock.now;
    const n = noteIn(id, "mai 8h đóng tiền điện", now);
    const first = await sync(app, a, [n]);
    expect(first.rejected).toEqual([]);
    // Not among A's own notes: it is the group's.
    expect(first.notes).toEqual([]);

    const atB = groupOf(await sync(app, b), id)!;
    expect(atB.notes.map((x) => [x.id, x.title, x.group])).toEqual([[n.id, "Đóng tiền điện", id]]);

    // B moves it to 9h; A sees it from where A's phone left off.
    const moved = { ...atB.notes[0]!, due: n.due! + 60 * MINUTE, updated: now + 1 };
    await sync(app, b, [moved]);
    const forA = groupOf(await sync(app, a, [], { [id]: groupOf(first, id)!.rev }), id)!;
    expect(forA.notes.map((x) => x.due)).toEqual([moved.due]);

    // Someone not in it can neither write nor read it.
    const c = await guest(app);
    const sneak = await sync(app, c.cookie, [{ ...moved, title: "Bị sửa", updated: now + 2 }]);
    expect(sneak.rejected).toEqual([n.id]);
    expect(sneak.groups).toEqual([]);
    expect(groupOf(await sync(app, a), id)!.notes[0]!.title).toBe("Đóng tiền điện");
  });

  it("says who ticked a note off, by the group's name for them, whatever their phone claims", async () => {
    const app = testApp();
    const { a, b, id } = await family(app);
    const now = app.clock.now;
    const n = noteIn(id, "mai 8h đóng tiền điện", now);
    await sync(app, a, [n]);
    await sync(app, b, [{ ...n, done: now + 5, updated: now + 5, by: { name: "Hải", at: now + 5 } }]);
    const forA = groupOf(await sync(app, a), id)!;
    const seen = forA.notes[0]!;
    const lan = forA.members.find((m) => m.name === "Lan")!.key;
    expect(seen.done).toBe(now + 5);
    // The member's key too, for the nickname A's phone may keep for her.
    expect(seen.by).toEqual({ name: "Lan", at: now + 5, key: lan });
    // A later edit that only carries the old tick along keeps the name.
    await sync(app, a, [{ ...seen, title: "Đóng tiền điện tháng 10", updated: now + 9 }]);
    expect(groupOf(await sync(app, b), id)!.notes[0]!.by).toEqual({ name: "Lan", at: now + 5, key: lan });
  });

  it("rings every member's phone, with whose it is when nothing else is said", async () => {
    const app = testApp(at(2026, 10, 12, 10, 30));
    const { secret } = await vapidSecret();
    app.deps.vapidKey = secret;
    const { a, b, id } = await family(app);
    const phones: { browser: Awaited<ReturnType<typeof fakeBrowser>>; endpoint: string }[] = [];
    for (const [cookie, n] of [
      [a, 1],
      [b, 2],
    ] as const) {
      const browser = await fakeBrowser();
      const endpoint = `https://web.push.apple.com/group-phone-${n}`;
      const res = await app.post("/api/push/subscribe", { endpoint, keys: browser.keys, device: `group-device-000${n}` }, cookie);
      expect(res.status).toBe(200);
      phones.push({ browser, endpoint });
    }
    const n = noteIn(id, "30p nữa đón con", app.clock.now);
    await sync(app, b, [n]);
    const sent: { url: string; body: Uint8Array }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: new Uint8Array(init.body as ArrayBuffer) });
      return new Response(null, { status: 201 });
    }) as typeof globalThis.fetch;
    app.clock.now = n.due!;
    await runCron({ sql: app.sql, now: app.clock.now, vapid: await readVapid(secret), subject: "mailto:test@vi-du.test", fetch });
    expect(sent.map((s) => s.url).sort()).toEqual(phones.map((p) => p.endpoint).sort());
    for (const p of phones) {
      const msg = JSON.parse(await readPush(sent.find((s) => s.url === p.endpoint)!.body as never, p.browser)) as { title: string; body: string; id: string };
      expect(msg).toMatchObject({ title: "Đón con", body: "Nhóm Gia đình", id: n.id });
    }
  });

  it("puts the group's day in each member's morning list", async () => {
    const app = testApp(at(2026, 10, 12, 10, 30));
    const { secret } = await vapidSecret();
    app.deps.vapidKey = secret;
    const { a, b, id } = await family(app);
    const browser = await fakeBrowser();
    await app.post("/api/push/subscribe", { endpoint: "https://web.push.apple.com/lan", keys: browser.keys, device: "lan-device-00001" }, b);
    await sync(app, a, [noteIn(id, "14h ngày 13/10 họp phụ huynh", at(2026, 10, 12, 10, 30))]);
    const sent: { body: Uint8Array }[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      sent.push({ body: new Uint8Array(init.body as ArrayBuffer) });
      return new Response(null, { status: 201 });
    }) as typeof globalThis.fetch;
    await runCron({ sql: app.sql, now: at(2026, 10, 13, 7, 0), vapid: await readVapid(secret), subject: "mailto:test@vi-du.test", fetch });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(await readPush(sent[0]!.body as never, browser))).toMatchObject({ title: "Hôm nay có 1 việc", body: "14:00 Họp phụ huynh" });
  });
});

describe("a note each member ticks off for themselves", () => {
  async function party(app: App) {
    const { a, b, id } = await family(app);
    const c = await guest(app);
    const code = groupOf(await sync(app, a), id)!.code;
    await app.post("/api/groups/join", { code, me: "Tú" }, c.cookie);
    const n = noteIn(id, "7h tối nay đi nhậu", app.clock.now, { each: true });
    await sync(app, a, [n]);
    return { a, b, c: c.cookie, id, n };
  }

  it("keeps each person's tick, even five at once, and shows who", async () => {
    const app = testApp();
    const { a, b, c, id, n } = await party(app);
    const t = app.clock.now;
    // B and C tick from phones that both still hold the note as A left it: neither undoes the other.
    const atB = groupOf(await sync(app, b), id)!.notes[0]!;
    const atC = groupOf(await sync(app, c), id)!.notes[0]!;
    await sync(app, b, [{ ...atB, mine: { at: t + 1, t: t + 1 }, updated: t + 1 }]);
    await sync(app, c, [{ ...atC, mine: { at: t + 2, t: t + 2 }, updated: t + 2 }]);
    const seen = groupOf(await sync(app, a), id)!.notes[0]!;
    expect(seen.each).toBe(true);
    expect(seen.done).toBeNull();
    expect(seen.ticks.map((x) => [x.name, x.at, x.me]).sort()).toEqual([
      ["Lan", t + 1, false],
      ["Tú", t + 2, false],
    ]);
    expect(seen.mine).toBeNull();
    // Each sees their own.
    expect(groupOf(await sync(app, b), id)!.notes[0]!.mine).toEqual({ at: t + 1, t: t + 1 });
    void n;
  });

  it("lets a person change only their own tick, and the later change of it wins", async () => {
    const app = testApp();
    const { a, b, id } = await party(app);
    const t = app.clock.now;
    const atB = groupOf(await sync(app, b), id)!.notes[0]!;
    await sync(app, b, [{ ...atB, mine: { at: t + 5, t: t + 5 }, updated: t + 5 }]);
    // B's other phone, still holding an untick from before: older, so it loses.
    await sync(app, b, [{ ...atB, mine: { at: null, t: t + 3 }, updated: t + 6 }]);
    expect(groupOf(await sync(app, a), id)!.notes[0]!.ticks.map((x) => x.name)).toEqual(["Lan"]);
    // A cannot tick for B: whatever A sends is A's own.
    const atA = groupOf(await sync(app, a), id)!.notes[0]!;
    await sync(app, a, [{ ...atA, mine: { at: t + 7, t: t + 7 }, updated: t + 7 }]);
    expect(groupOf(await sync(app, b), id)!.notes[0]!.ticks.map((x) => x.name).sort()).toEqual(["Hải", "Lan"]);
    // B unticks later: gone from the list.
    await sync(app, b, [{ ...atB, mine: { at: null, t: t + 9 }, updated: t + 9 }]);
    expect(groupOf(await sync(app, a), id)!.notes[0]!.ticks.map((x) => x.name)).toEqual(["Hải"]);
  });

  it("rings only those who have not ticked it off", async () => {
    const app = testApp(at(2026, 10, 12, 10, 30));
    const { secret } = await vapidSecret();
    app.deps.vapidKey = secret;
    const { a, b, id } = await family(app);
    for (const [cookie, n] of [
      [a, 1],
      [b, 2],
    ] as const) {
      const browser = await fakeBrowser();
      await app.post("/api/push/subscribe", { endpoint: `https://web.push.apple.com/each-${n}`, keys: browser.keys, device: `each-device-000${n}` }, cookie);
    }
    const n = noteIn(id, "30p nữa đi nhậu", app.clock.now, { each: true });
    await sync(app, a, [n]);
    const atB = groupOf(await sync(app, b), id)!.notes[0]!;
    await sync(app, b, [{ ...atB, mine: { at: app.clock.now, t: app.clock.now }, updated: app.clock.now + 1 }]);
    const sent: string[] = [];
    const fetch = (async (url: string) => {
      sent.push(url);
      return new Response(null, { status: 201 });
    }) as unknown as typeof globalThis.fetch;
    app.clock.now = n.due!;
    await runCron({ sql: app.sql, now: app.clock.now, vapid: await readVapid(secret), subject: "mailto:test@vi-du.test", fetch });
    expect(sent).toEqual(["https://web.push.apple.com/each-1"]);
  });
});

describe("leaving and the owner's say", () => {
  it("a member who leaves stops seeing it and can no longer write to it", async () => {
    const app = testApp();
    const { a, b, id } = await family(app);
    const n = noteIn(id, "mai 8h đóng tiền điện", app.clock.now);
    await sync(app, a, [n]);
    expect((await app.post("/api/groups/leave", { id }, b)).status).toBe(200);
    const afterB = await sync(app, b, [{ ...n, title: "Bị sửa", updated: n.updated + 1 }]);
    expect(afterB.groups).toEqual([]);
    expect(afterB.rejected).toEqual([n.id]);
    expect(groupOf(await sync(app, a), id)!.members.map((m) => m.name)).toEqual(["Hải"]);
  });

  it("an owner who leaves hands the group on; the last one out keeps its notes as their own", async () => {
    const app = testApp();
    const { a, b, id } = await family(app);
    const n = noteIn(id, "mai 8h đóng tiền điện", app.clock.now);
    await sync(app, a, [n]);
    await app.post("/api/groups/leave", { id }, a);
    const atB = await sync(app, b);
    expect(groupOf(atB, id)!.owner).toBe(true);
    expect(groupOf(atB, id)!.notes).toHaveLength(1);
    await app.post("/api/groups/leave", { id }, b);
    expect(app.sql.db.prepare("SELECT COUNT(*) AS n FROM groups").get()).toEqual({ n: 0 });
    expect(app.sql.db.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = ?").get(id)).toEqual({ n: 0 });
    // From where B's phone left off: the note again, now B's own, and no group.
    const after = await app.post("/api/sync", { since: atB.rev, changes: [], offset: VN_OFFSET, groups: { [id]: groupOf(atB, id)!.rev } }, b);
    const got = (await after.json()) as Answer;
    expect(got.groups).toEqual([]);
    expect(got.notes.map((x) => [x.id, x.title, x.group])).toEqual([[n.id, "Đóng tiền điện", null]]);
    // And A, who left first, does not get it.
    expect((await sync(app, a)).notes.map((x) => x.id)).not.toContain(n.id);
  });

  it("only the owner renames, removes people, renews the invite and deletes", async () => {
    const app = testApp();
    const { a, b, id, code } = await family(app);
    for (const path of ["/api/groups/rename", "/api/groups/renew", "/api/groups/delete", "/api/groups/remove"]) {
      expect((await app.post(path, { id, name: "Của Lan", key: "x" }, b)).status, path).toBe(403);
    }
    expect((await app.post("/api/groups/rename", { id, name: "Nhà mình" }, a)).status).toBe(200);
    expect(groupOf(await sync(app, b), id)!.name).toBe("Nhà mình");

    // A renewed invite: the old link no longer lets anyone in, the new one does.
    await app.post("/api/groups/renew", { id }, a);
    const c = await guest(app);
    expect((await app.post("/api/groups/join", { code, me: "Bạn" }, c.cookie)).status).toBe(404);
    const fresh = groupOf(await sync(app, a), id)!.code;
    expect(fresh).not.toBe(code);
    expect((await app.post("/api/groups/join", { code: fresh, me: "Bạn" }, c.cookie)).status).toBe(200);

    const lan = groupOf(await sync(app, a), id)!.members.find((m) => m.name === "Lan")!;
    await app.post("/api/groups/remove", { id, key: lan.key }, a);
    expect((await sync(app, b)).groups).toEqual([]);

    await app.post("/api/groups/delete", { id }, a);
    expect((await sync(app, c.cookie)).groups).toEqual([]);
    expect(app.sql.db.prepare("SELECT COUNT(*) AS n FROM group_members").get()).toEqual({ n: 0 });
  });

  it("a member renames themselves", async () => {
    const app = testApp();
    const { a, b, id } = await family(app);
    await app.post("/api/groups/me", { id, name: "Mẹ Bin" }, b);
    expect(groupOf(await sync(app, a), id)!.members.map((m) => m.name)).toEqual(["Hải", "Mẹ Bin"]);
  });
});

describe("accounts around groups", () => {
  it("a deleted account leaves its groups to the others", async () => {
    const app = testApp();
    const { a, b, id } = await family(app);
    await sync(app, a, [noteIn(id, "mai 8h đóng tiền điện", app.clock.now)]);
    expect((await app.post("/api/account/delete", { confirm: "XOA" }, a)).status).toBe(200);
    const atB = groupOf(await sync(app, b), id)!;
    expect(atB.owner).toBe(true);
    expect(atB.members.map((m) => m.name)).toEqual(["Lan"]);
    expect(atB.notes).toHaveLength(1);
  });

  it("a guest who joined keeps the group after signing in with Google", async () => {
    const app = testApp();
    const a = await app.signIn("fake-a");
    const { id } = (await (await app.post("/api/groups/create", { name: "Lớp 12A", me: "Hải" }, a)).json()) as { id: string };
    const code = (await sync(app, a)).groups[0]!.code;
    const g = await guest(app);
    await app.post("/api/groups/join", { code, me: "Khách" }, g.cookie);
    // Signing in with Google while the guest's session is on this phone.
    const start = await app.call("/dang-nhap", { cookie: g.cookie });
    const signin = cookiePair(start, "nhonha-signin");
    const chooser = await app.call(new URL(start.headers.get("location")!).pathname + new URL(start.headers.get("location")!).search);
    // As Người thử B (the fake Google's second person): someone not yet in the group.
    const who = (l: string) => {
      const c = new URL(l).searchParams.get("code");
      return c ? (JSON.parse(atob(c.replace(/-/g, "+").replace(/_/g, "/"))) as { p: string }).p : null;
    };
    const pick = [...(await chooser.text()).matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&")).find((l) => l.includes("code=") && who(l) === "fake-b")!;
    const back = await app.call(new URL(pick).pathname + new URL(pick).search, { cookie: `${signin}; ${g.cookie}` });
    expect(back.status).toBe(302);
    const now = cookiePair(back, "nhonha");
    const mine = (await sync(app, now)).groups;
    expect(mine.map((x) => x.id)).toEqual([id]);
    expect(mine[0]!.members.map((m) => m.name)).toEqual(["Hải", "Khách"]);
  });

  it("a person is in at most so many groups", async () => {
    const app = testApp();
    const a = await app.signIn("fake-a");
    for (let i = 0; i < LIMITS.groupsPerPerson; i++) expect((await app.post("/api/groups/create", { name: `Nhóm ${i}`, me: "Hải" }, a)).status).toBe(200);
    expect((await app.post("/api/groups/create", { name: "Một nhóm nữa", me: "Hải" }, a)).status).toBe(409);
  });
});
