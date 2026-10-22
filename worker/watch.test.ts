// What keeps a group from turning into noise, and "Báo cho tôi nếu chưa
// xong" (Hải, 13/10/2026: "lỡ spam thì sao?"), run end to end: real routes,
// real SQL, the real cron, phones that decrypt what reaches them. Both ways:
// what must ring rings, and what must not, does not.
import { describe, expect, it } from "vitest";
import { markDone } from "../src/lib/notes";
import { parse } from "../src/shared/parse";
import type { GroupSync, Me, Note, SyncResponse } from "../src/shared/protocol";
import { fromWall, VN_OFFSET } from "../src/shared/wall";
import { ALERT_AFTER_MS, runCron } from "./cron";
import { GROUP_RINGS_PER_HOUR } from "./groups";
import { adoptGuest } from "./guest";
import { cookiePair, testApp } from "./testing/app";
import { fakeBrowser, readPush, vapidSecret, type FakeBrowser } from "./testing/push";
import { readVapid, type Vapid } from "./webpush";
import { nextWake } from "./wake";

const at = (d: number, h: number, mi = 0) => fromWall(2026, 10, d, h, mi, VN_OFFSET);
let ids = 0;
const newId = () => `watch-note-${String(++ids).padStart(10, "0")}`;

type App = ReturnType<typeof testApp>;
type Answer = SyncResponse & { rejected: string[] };
type Heard = { who: string; title: string; body: string; tag: string; id?: string; act?: boolean };

function noteIn(group: string, text: string, now: number, extra: Partial<Note> = {}): Note {
  const p = parse(text, now, VN_OFFSET);
  return { id: newId(), text, title: p.title, items: p.items, tags: p.tags, due: p.due, rule: p.rule, nag: p.nag, done: null, pinned: false, deleted: false, created: now, updated: now, group, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [], ...extra };
}

async function sync(app: App, cookie: string, changes: Note[] = []): Promise<Answer> {
  const res = await app.post("/api/sync", { since: 0, changes, offset: VN_OFFSET, groups: {} }, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as Answer;
}
const groupOf = (r: Answer, id: string) => r.groups.find((g) => g.id === id) as GroupSync;
const noteOf = async (app: App, cookie: string, group: string, id: string) => groupOf(await sync(app, cookie), group).notes.find((n) => n.id === id)!;

/**
 * Lan makes "Gia đình", Bố and Mẹ join; each has a phone. Lan and Bố sign in
 * with the fake Google, Mẹ is a guest.
 */
async function family(start: number) {
  const app = testApp(start);
  const { secret } = await vapidSecret();
  app.deps.vapidKey = secret;
  const lan = await app.signIn("fake-a");
  const bo = await app.signIn("fake-b");
  const guest = await app.post("/api/guest", {});
  const me = cookiePair(guest, "nhonha");
  const meId = ((await guest.json()) as Me).id;
  const { id } = (await (await app.post("/api/groups/create", { name: "Gia đình", me: "Lan" }, lan)).json()) as { id: string };
  const code = (await sync(app, lan)).groups[0]!.code;
  for (const [cookie, name] of [
    [bo, "Bố"],
    [me, "Mẹ"],
  ] as const) {
    expect((await app.post("/api/groups/join", { code, me: name }, cookie)).status).toBe(200);
  }
  const phones: Record<string, { browser: FakeBrowser; endpoint: string }> = {};
  for (const [cookie, name] of [
    [lan, "lan"],
    [bo, "bo"],
    [me, "me"],
  ] as const) {
    const browser = await fakeBrowser();
    const endpoint = `https://web.push.apple.com/${name}`;
    expect((await app.post("/api/push/subscribe", { endpoint, keys: browser.keys, device: `${name}-device-0000000000` }, cookie)).status).toBe(200);
    phones[name] = { browser, endpoint };
  }
  const keys = Object.fromEntries(groupOf(await sync(app, lan), id).members.map((m) => [m.name, m.key])) as Record<"Lan" | "Bố" | "Mẹ", string>;
  const vapid = (await readVapid(secret)) as Vapid;

  /** The cron at `now`: what each phone heard, decrypted. */
  async function cron(now: number): Promise<Heard[]> {
    const sent: { url: string; body: Uint8Array }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: new Uint8Array(init.body as ArrayBuffer) });
      return new Response(null, { status: 201 });
    }) as typeof globalThis.fetch;
    app.clock.now = now;
    await runCron({ sql: app.sql, now, vapid, subject: "mailto:test@vi-du.test", fetch, cap: 1_000 });
    const heard: Heard[] = [];
    for (const s of sent) {
      const [who, p] = Object.entries(phones).find(([, p]) => p.endpoint === s.url)!;
      heard.push({ who, ...(JSON.parse(await readPush(s.body as never, p.browser)) as Omit<Heard, "who">) });
    }
    return heard.sort((a, b) => a.who.localeCompare(b.who) || a.title.localeCompare(b.title));
  }
  return { app, lan, bo, me, meId, id, keys, cron };
}

describe("a note for one member, and whoever asked to be told", () => {
  it("rings only on that member's phone, and says who waits on the tap", async () => {
    const f = await family(at(13, 20));
    const n = noteIn(f.id, "21h uống thuốc", at(13, 20), { assignee: f.keys["Bố"], watch: { on: true, t: at(13, 20) } });
    await sync(f.app, f.lan, [n]);
    expect(await f.cron(at(13, 21))).toEqual([{ who: "bo", title: "Uống thuốc", body: "Bấm Xong để Lan yên tâm", id: n.id, tag: n.id, act: true }]);
  });

  it("tells the watcher once, half an hour on, when it is still not done; nobody when it was", async () => {
    const f = await family(at(13, 20));
    const n = noteIn(f.id, "mỗi ngày 21h uống thuốc", at(13, 20), { assignee: f.keys["Bố"], watch: { on: true, t: at(13, 20) } });
    await sync(f.app, f.lan, [n]);
    await f.cron(at(13, 21));
    expect(await f.cron(at(13, 21, 29))).toEqual([]);
    expect(await f.cron(at(13, 21, 30))).toEqual([{ who: "lan", title: "Bố chưa bấm Xong", body: "Uống thuốc 21:00", id: n.id, tag: `watch:${n.id}` }]);
    // Once: never again for this time.
    expect(await f.cron(at(13, 21, 31))).toEqual([]);
    expect(await f.cron(at(13, 23))).toEqual([]);

    // The next evening Bố taps Xong at 21:10: rung, and then nobody is told anything.
    expect((await f.cron(at(14, 21))).map((h) => h.who)).toEqual(["bo"]);
    f.app.clock.now = at(14, 21, 10);
    const atBo = await noteOf(f.app, f.bo, f.id, n.id);
    await sync(f.app, f.bo, [markDone(atBo, at(14, 21, 10), VN_OFFSET)]);
    expect(await f.cron(at(14, 21, 30))).toEqual([]);
  });

  it("tells nobody when Bố put it off: he saw it", async () => {
    const f = await family(at(13, 20));
    const n = noteIn(f.id, "21h uống thuốc", at(13, 20), { assignee: f.keys["Bố"], watch: { on: true, t: at(13, 20) } });
    await sync(f.app, f.lan, [n]);
    await f.cron(at(13, 21));
    f.app.clock.now = at(13, 21, 5);
    const atBo = await noteOf(f.app, f.bo, f.id, n.id);
    await sync(f.app, f.bo, [{ ...atBo, due: at(13, 21, 15), updated: at(13, 21, 5) }]);
    expect((await f.cron(at(13, 21, 15))).map((h) => [h.who, h.title])).toEqual([["bo", "Uống thuốc"]]);
    expect(await f.cron(at(13, 21, 30))).toEqual([]);
    // Put off, and still not done half an hour after the new time: now Lan is told.
    expect((await f.cron(at(13, 21, 45))).map((h) => [h.who, h.title])).toEqual([["lan", "Bố chưa bấm Xong"]]);
  });

  it("waits for the morning when the watcher is asleep, and then only if it is still not done", async () => {
    const f = await family(at(13, 20));
    const late = noteIn(f.id, "22h uống thuốc", at(13, 20), { assignee: f.keys["Bố"], watch: { on: true, t: at(13, 20) } });
    await sync(f.app, f.lan, [late]);
    await f.cron(at(13, 22));
    // 22:30 is in Lan's hours of sleep (22–6 unless she changes them).
    expect(await f.cron(at(13, 22, 30))).toEqual([]);
    expect(f.app.sql.db.prepare("SELECT alert_at FROM notes WHERE id = ?").get(late.id)).toEqual({ alert_at: at(14, 6) });
    expect(await f.cron(at(14, 6))).toEqual([{ who: "lan", title: "Bố chưa bấm Xong", body: "Uống thuốc 22:00 hôm qua", id: late.id, tag: `watch:${late.id}` }]);

    // Done before morning: the morning says nothing.
    const done = noteIn(f.id, "22h uống thuốc", at(14, 20), { assignee: f.keys["Bố"], watch: { on: true, t: at(14, 20) } });
    await sync(f.app, f.lan, [done]);
    await f.cron(at(14, 22));
    await f.cron(at(14, 22, 30));
    f.app.clock.now = at(14, 23);
    await sync(f.app, f.bo, [markDone(await noteOf(f.app, f.bo, f.id, done.id), at(14, 23), VN_OFFSET)]);
    expect(await f.cron(at(15, 6))).toEqual([]);

    // No hours of sleep: told at once, whatever the hour.
    expect((await f.app.post("/api/settings", { quiet: null }, f.lan)).status).toBe(200);
    const third = noteIn(f.id, "22h uống thuốc", at(15, 20), { assignee: f.keys["Bố"], watch: { on: true, t: at(15, 20) } });
    await sync(f.app, f.lan, [third]);
    await f.cron(at(15, 22));
    expect((await f.cron(at(15, 22, 30))).map((h) => h.who)).toEqual(["lan"]);
  });

  it("lets each person sign up only themselves, and shows everyone who is told", async () => {
    const f = await family(at(13, 20));
    const n = noteIn(f.id, "21h uống thuốc", at(13, 20), { assignee: f.keys["Bố"], watch: { on: true, t: at(13, 20) } });
    await sync(f.app, f.lan, [n]);
    // Mẹ's phone, holding Lan's copy with Lan's "on" in it, asks too: hers is added, Lan's stays Lan's.
    const atMe = await noteOf(f.app, f.me, f.id, n.id);
    expect(atMe.watchers).toEqual([{ key: f.keys["Lan"], name: "Lan", me: false }]);
    expect(atMe.watch).toBeNull();
    await sync(f.app, f.me, [{ ...atMe, watch: { on: true, t: at(13, 20, 1) }, updated: at(13, 20, 1) }]);
    // Bố turns "his" off: it was never his, nothing changes for anyone else.
    const atBo = await noteOf(f.app, f.bo, f.id, n.id);
    await sync(f.app, f.bo, [{ ...atBo, watch: { on: false, t: at(13, 20, 2) }, updated: at(13, 20, 2) }]);
    const seen = await noteOf(f.app, f.bo, f.id, n.id);
    expect(seen.watchers.map((w) => w.name).sort()).toEqual(["Lan", "Mẹ"]);
    expect((await noteOf(f.app, f.lan, f.id, n.id)).watch).toEqual({ on: true, t: at(13, 20) });
    await f.cron(at(13, 21));
    expect((await f.cron(at(13, 21, 30))).map((h) => h.who)).toEqual(["lan", "me"]);
  });

  it("rings everyone again when the one it was for left the group", async () => {
    const f = await family(at(13, 20));
    const n = noteIn(f.id, "21h uống thuốc", at(13, 20), { assignee: f.keys["Bố"] });
    await sync(f.app, f.lan, [n]);
    await f.app.post("/api/groups/leave", { id: f.id }, f.bo);
    expect((await f.cron(at(13, 21))).map((h) => h.who)).toEqual(["lan", "me"]);
  });

  it("is in the morning list of the one it is for only", async () => {
    const f = await family(at(13, 6, 30));
    await sync(f.app, f.lan, [noteIn(f.id, "14h đi khám", at(13, 6, 30), { assignee: f.keys["Bố"] }), noteIn(f.id, "15h họp phụ huynh", at(13, 6, 30))]);
    const lists = (await f.cron(at(13, 7))).filter((h) => h.tag === "digest");
    expect(lists.map((h) => [h.who, h.body])).toEqual([
      ["bo", "14:00 Đi khám\n15:00 Họp phụ huynh"],
      ["lan", "15:00 Họp phụ huynh"],
      ["me", "15:00 Họp phụ huynh"],
    ]);
  });
});

describe("a note each ticks off, watched", () => {
  it("tells the watcher in one notification who has not tapped", async () => {
    const f = await family(at(13, 18));
    const n = noteIn(f.id, "19h đi nhậu", at(13, 18), { each: true, watch: { on: true, t: at(13, 18) } });
    await sync(f.app, f.lan, [n]);
    await f.cron(at(13, 19));
    f.app.clock.now = at(13, 19, 5);
    const atMe = await noteOf(f.app, f.me, f.id, n.id);
    await sync(f.app, f.me, [{ ...atMe, mine: { at: at(13, 19, 5), t: at(13, 19, 5) }, updated: at(13, 19, 5) }]);
    // Lan has not tapped either, but she is the one asking.
    expect(await f.cron(at(13, 19, 30))).toEqual([{ who: "lan", title: "Bố chưa bấm Xong", body: "Đi nhậu 19:00", id: n.id, tag: `watch:${n.id}` }]);
  });
});

describe("a repeating note each ticks off for themselves", () => {
  // "9h, 18h hằng ngày uống thuốc", each person each dose (Hải, 14/10/2026); "!" for nhắc dai.
  async function meds(text = "9h, 18h hằng ngày uống thuốc", watchedBy?: "lan") {
    const f = await family(at(13, 8));
    const n = noteIn(f.id, text, at(13, 8), { each: true, ...(watchedBy ? { watch: { on: true, t: at(13, 8) } } : {}) });
    await sync(f.app, f.lan, [n]);
    const tap = async (cookie: string, now: number) => {
      f.app.clock.now = now;
      await sync(f.app, cookie, [markDone(await noteOf(f.app, cookie, f.id, n.id), now, VN_OFFSET)]);
    };
    return { ...f, n, tap };
  }

  it("rings everyone each time, and nags only those who have not tapped for that time", async () => {
    const f = await meds("9h, 18h hằng ngày uống thuốc!");
    expect((await f.cron(at(13, 9))).map((h) => h.who)).toEqual(["bo", "lan", "me"]);
    // Lan takes hers five minutes on: the others are still nagged, she is not.
    await f.tap(f.lan, at(13, 9, 5));
    expect((await f.cron(at(13, 9, 10))).map((h) => [h.who, h.body])).toEqual([
      ["bo", "Nhắc lại vì bạn chưa bấm Xong"],
      ["me", "Nhắc lại vì bạn chưa bấm Xong"],
    ]);
    await f.tap(f.bo, at(13, 9, 12));
    await f.tap(f.me, at(13, 9, 15));
    // Everyone has: nothing more this morning, and the note waits for the evening.
    expect(await f.cron(at(13, 9, 20))).toEqual([]);
    expect(f.app.sql.db.prepare("SELECT fire_at FROM notes WHERE id = ?").get(f.n.id)).toEqual({ fire_at: at(13, 18) });
    // The evening dose rings for everyone again, those who took the morning one too.
    expect((await f.cron(at(13, 18))).map((h) => h.who)).toEqual(["bo", "lan", "me"]);
    // The note on Lan's phone: its own `due` never moved; the ticks are per dose.
    const seen = await noteOf(f.app, f.lan, f.id, f.n.id);
    expect(seen.due).toBe(at(13, 9));
    expect(seen.mine).toMatchObject({ at: at(13, 9, 5), occ: at(13, 9) });
    expect(seen.ticks.map((t) => [t.name, t.occ]).sort()).toEqual([
      ["Bố", at(13, 9)],
      ["Lan", at(13, 9)],
      ["Mẹ", at(13, 9)],
    ]);
  });

  it("does not ring one who skipped the next dose ahead of it", async () => {
    const f = await meds();
    await f.cron(at(13, 9));
    await f.tap(f.bo, at(13, 9, 1));
    // At noon Bố says he has taken the evening one already ("Bỏ qua lần này").
    await f.tap(f.bo, at(13, 12));
    expect((await f.cron(at(13, 18))).map((h) => h.who)).toEqual(["lan", "me"]);
    // Only that one: the morning after rings him again (the morning list, sent then too, aside).
    const next = await f.cron(at(14, 9));
    expect(next.filter((h) => h.tag === f.n.id).map((h) => h.who)).toEqual(["bo", "lan", "me"]);
  });

  it("tells the watcher, dose by dose, who has not tapped", async () => {
    const f = await meds(undefined, "lan");
    await f.cron(at(13, 9));
    await f.tap(f.me, at(13, 9, 5));
    expect(await f.cron(at(13, 9, 30))).toEqual([{ who: "lan", title: "Bố chưa bấm Xong", body: "Uống thuốc 09:00", id: f.n.id, tag: `watch:${f.n.id}` }]);
    // The morning's taps do not count for the evening.
    await f.cron(at(13, 18));
    await f.tap(f.bo, at(13, 18, 2));
    expect(await f.cron(at(13, 18, 30))).toEqual([{ who: "lan", title: "Mẹ chưa bấm Xong", body: "Uống thuốc 18:00", id: f.n.id, tag: `watch:${f.n.id}` }]);
  });

  it("leaves out of the morning list a dose this person already took", async () => {
    const f = await meds();
    await f.cron(at(13, 18));
    await f.tap(f.bo, at(13, 18, 1));
    // Bố takes tomorrow morning's too, late at night: his list leaves it out, the others' do not.
    await f.tap(f.bo, at(13, 23));
    const heard = await f.cron(at(14, 7));
    expect(heard.filter((h) => h.tag === "digest").map((h) => [h.who, h.body])).toEqual([
      ["lan", "09:00 Uống thuốc"],
      ["me", "09:00 Uống thuốc"],
    ]);
  });
});

describe("muting a group", () => {
  it("stops what it sends to whoever muted it, and only them, until they unmute", async () => {
    const f = await family(at(13, 8));
    expect((await f.app.post("/api/groups/mute", { id: f.id, muted: true }, f.bo)).status).toBe(200);
    expect(groupOf(await sync(f.app, f.bo), f.id).muted).toBe(true);
    expect(groupOf(await sync(f.app, f.lan), f.id).muted).toBe(false);
    await sync(f.app, f.lan, [noteIn(f.id, "9h đóng tiền điện", at(13, 8)), noteIn(f.id, "10h đi chợ", at(13, 8), { assignee: f.keys["Bố"] })]);
    expect((await f.cron(at(13, 9))).map((h) => h.who)).toEqual(["lan", "me"]);
    // His to choose: muted, even a note for him alone stays quiet.
    expect(await f.cron(at(13, 10))).toEqual([]);
    await f.app.post("/api/groups/mute", { id: f.id, muted: false }, f.bo);
    await sync(f.app, f.lan, [noteIn(f.id, "11h đón con", at(13, 8))]);
    expect((await f.cron(at(13, 11))).map((h) => h.who)).toEqual(["bo", "lan", "me"]);
  });

  it("leaves the group's notes out of their morning list", async () => {
    const f = await family(at(13, 6));
    await f.app.post("/api/groups/mute", { id: f.id, muted: true }, f.bo);
    await sync(f.app, f.lan, [noteIn(f.id, "15h họp phụ huynh", at(13, 6))]);
    expect((await f.cron(at(13, 7))).map((h) => h.who)).toEqual(["lan", "me"]);
  });

  it("changes nothing for a group one is not in", async () => {
    const f = await family(at(13, 8));
    const stranger = await f.app.post("/api/guest", {});
    const res = await f.app.post("/api/groups/mute", { id: f.id, muted: true }, cookiePair(stranger, "nhonha"));
    expect(res.status).toBe(200);
    // Nothing of theirs to change: the members are as they were.
    expect(groupOf(await sync(f.app, f.lan), f.id).members).toHaveLength(3);
    expect(f.app.sql.db.prepare("SELECT COUNT(*) AS n FROM group_members WHERE muted = 1").get()).toEqual({ n: 0 });
  });
});

describe("a group's rings in an hour", () => {
  it(`stop at ${GROUP_RINGS_PER_HOUR}: the rest of the hour is one notification, "nhắc dai" included`, async () => {
    const f = await family(at(13, 8));
    const many = Array.from({ length: GROUP_RINGS_PER_HOUR + 5 }, (_, i) => noteIn(f.id, `9h việc ${i + 1}${i === GROUP_RINGS_PER_HOUR + 4 ? "!" : ""}`, at(13, 8)));
    await sync(f.app, f.me, many);
    const heard = await f.cron(at(13, 9));
    for (const who of ["bo", "lan", "me"]) {
      const theirs = heard.filter((h) => h.who === who);
      expect(theirs.filter((h) => h.tag !== `flood:${f.id}`)).toHaveLength(GROUP_RINGS_PER_HOUR);
      expect(theirs.filter((h) => h.tag === `flood:${f.id}`).map((h) => [h.title, h.body])).toEqual([["Nhóm Gia đình có nhiều lời nhắc", "Gộp lại tới 10:00 cho đỡ phiền. Mở app để xem."]]);
    }
    // The held "nhắc dai" does not come back ten minutes on.
    expect(await f.cron(at(13, 9, 10))).toEqual([]);
    // Within the hour, a new one is held too; the next hour rings again.
    await sync(f.app, f.lan, [noteIn(f.id, "9h30 thêm việc", at(13, 9, 10)), noteIn(f.id, "10h họp", at(13, 9, 10))]);
    expect(await f.cron(at(13, 9, 30))).toEqual([]);
    expect((await f.cron(at(13, 10))).map((h) => [h.who, h.title])).toEqual([
      ["bo", "Họp"],
      ["lan", "Họp"],
      ["me", "Họp"],
    ]);
  });

  it("count people joining too, so leaving and joining over and over rings nobody past the cap", async () => {
    const f = await family(at(13, 9));
    const pending: Promise<unknown>[] = [];
    const sent: string[] = [];
    Object.assign(f.app.deps, {
      subject: "mailto:test@vi-du.test",
      background: (p: Promise<unknown>) => void pending.push(p),
      fetch: (async (url: string) => {
        sent.push(url);
        return new Response(null, { status: 201 });
      }) as unknown as typeof globalThis.fetch,
    });
    const code = groupOf(await sync(f.app, f.lan), f.id).code;
    const guest = cookiePair(await f.app.post("/api/guest", {}), "nhonha");
    for (let i = 0; i < GROUP_RINGS_PER_HOUR + 5; i++) {
      await f.app.post("/api/groups/join", { code, me: "Ai đó" }, guest);
      await f.app.post("/api/groups/leave", { id: f.id }, guest);
    }
    await Promise.all(pending);
    // Three members each time; never more than the cap's worth.
    expect(sent.length).toBe(GROUP_RINGS_PER_HOUR * 3);
  });
});

describe("news about others while asleep", () => {
  it("is not sent: someone joining at night is there in the app tomorrow", async () => {
    const f = await family(at(13, 23));
    const pending: Promise<unknown>[] = [];
    const sent: string[] = [];
    Object.assign(f.app.deps, {
      subject: "mailto:test@vi-du.test",
      background: (p: Promise<unknown>) => void pending.push(p),
      fetch: (async (url: string) => {
        sent.push(url);
        return new Response(null, { status: 201 });
      }) as unknown as typeof globalThis.fetch,
    });
    // Everyone has 22–6 to begin with; Mẹ turned hers off.
    await f.app.post("/api/settings", { quiet: null }, f.me);
    const code = groupOf(await sync(f.app, f.lan), f.id).code;
    await f.app.post("/api/groups/join", { code, me: "Tú" }, cookiePair(await f.app.post("/api/guest", {}), "nhonha"));
    await Promise.all(pending);
    expect(sent).toEqual(["https://web.push.apple.com/me"]);
  });
});

describe("the clock and leftovers", () => {
  it("drops a look at a note that is no longer a group's, instead of waking for it for ever", async () => {
    const f = await family(at(13, 20));
    const n = noteIn(f.id, "21h uống thuốc", at(13, 20), { assignee: f.keys["Bố"], watch: { on: true, t: at(13, 20) } });
    await sync(f.app, f.lan, [n]);
    await f.cron(at(13, 21));
    for (const c of [f.bo, f.me, f.lan]) await f.app.post("/api/groups/leave", { id: f.id }, c);
    // Lan, last out, has it as her own now, with the look still set.
    expect(f.app.sql.db.prepare("SELECT alert_at FROM notes WHERE id = ?").get(n.id)).toEqual({ alert_at: at(13, 21) + ALERT_AFTER_MS });
    expect(await f.cron(at(13, 21, 30))).toEqual([]);
    expect(f.app.sql.db.prepare("SELECT alert_at FROM notes WHERE id = ?").get(n.id)).toEqual({ alert_at: null });
    expect(await nextWake(f.app.sql, at(13, 21, 31))).toBeGreaterThan(at(13, 21, 31));
  });

  it("keeps a guest's ticks and watches theirs when they sign in to an account", async () => {
    const f = await family(at(13, 18));
    const n = noteIn(f.id, "19h đi nhậu", at(13, 18), { each: true });
    await sync(f.app, f.lan, [n]);
    const atMe = await noteOf(f.app, f.me, f.id, n.id);
    await sync(f.app, f.me, [{ ...atMe, mine: { at: at(13, 18, 5), t: at(13, 18, 5) }, watch: { on: true, t: at(13, 18, 5) }, updated: at(13, 18, 5) }]);
    const into = String((f.app.sql.db.prepare("SELECT id FROM users WHERE guest = 0 ORDER BY created_at LIMIT 1").get() as { id: string }).id);
    // Lan's own account takes Mẹ's guest in (as signing in with Google on that phone would).
    await adoptGuest(f.app.sql, f.meId, into);
    const seen = await noteOf(f.app, f.lan, f.id, n.id);
    expect(seen.mine).toEqual({ at: at(13, 18, 5), t: at(13, 18, 5) });
    expect(seen.watch).toEqual({ on: true, t: at(13, 18, 5) });
  });
});
