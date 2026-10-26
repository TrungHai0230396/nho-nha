// Two phones, one account, the real Worker in between (on node:sqlite).
import { describe, expect, it } from "vitest";
import { testApp } from "../../worker/testing/app";
import type { Note } from "../shared/protocol";
import { VN_OFFSET } from "../shared/wall";
import { intoGroup, markDone, newNote, remove, snooze } from "./notes";
import { NotesStore, type Persist } from "./store";

function memoryPersist(): Persist & { notes: Map<string, Note>; meta: Map<string, unknown> } {
  const notes = new Map<string, Note>();
  const meta = new Map<string, unknown>();
  return {
    notes,
    meta,
    load: async () => ({ notes: [...notes.values()], meta: new Map(meta) }),
    save: async (ns, m) => {
      for (const n of ns) notes.set(n.id, n);
      for (const [k, v] of Object.entries(m)) meta.set(k, v);
    },
    wipe: async () => {
      notes.clear();
      meta.clear();
    },
    drop: async (ids) => {
      for (const id of ids) notes.delete(id);
    },
  };
}

class Offline extends Error {}

async function phones() {
  const app = testApp();
  const cookie = await app.signIn();
  const net = { up: true };
  const phone = () => {
    const persist = memoryPersist();
    const store = new NotesStore({
      persist,
      offset: () => VN_OFFSET,
      now: () => app.clock.now,
      isSignedOut: (e) => e instanceof Error && e.message === "signed out",
      transport: {
        sync: async (req) => {
          if (!net.up) throw new Offline();
          const res = await app.post("/api/sync", req, cookie);
          if (res.status === 401) throw new Error("signed out");
          return res.json();
        },
      },
    });
    return { store, persist };
  };
  return { app, net, a: phone(), b: phone() };
}

/** Two people, one phone each: Hải (who makes the group) and Lan, through the same Worker. */
async function twoPeople(lanOffset = VN_OFFSET) {
  const app = testApp();
  const phoneOf = (cookie: string, offset = VN_OFFSET) => {
    const persist = memoryPersist();
    const store = new NotesStore({
      persist,
      offset: () => offset,
      now: () => app.clock.now,
      isSignedOut: () => false,
      transport: { sync: async (req) => (await app.post("/api/sync", req, cookie)).json() },
    });
    return { store, persist, cookie };
  };
  const hai = phoneOf(await app.signIn("fake-a"));
  const lan = phoneOf(await app.signIn("fake-b"), lanOffset);
  const { id: group } = (await (await app.post("/api/groups/create", { name: "Gia đình", me: "Hải" }, hai.cookie)).json()) as { id: string };
  await hai.store.sync();
  const code = hai.store.getSnapshot().groups[0]!.code;
  await app.post("/api/groups/join", { code, me: "Lan" }, lan.cookie);
  return { app, hai, lan, group };
}

let k = 0;
const id = () => `phone-note-${String(++k).padStart(10, "0")}`;
const titles = (s: NotesStore) =>
  [...s.getSnapshot().notes.values()]
    .filter((n) => !n.deleted)
    .map((n) => n.title)
    .sort();

describe("NotesStore", () => {
  it("takes the answer to an edit made on a clock that runs fast, and sends it once", async () => {
    const { app, a } = await phones();
    let calls = 0;
    const post = app.post;
    // The server's clock moves on between requests, as it does: each clamp is a little later.
    app.post = (...args) => {
      calls++;
      app.clock.now += 1000;
      return post(...args);
    };
    // Five minutes ahead: the server clamps it to a minute (worker/notes.ts) and answers with that.
    await a.store.put(newNote(id(), "mai 8h gọi mẹ", app.clock.now + 5 * 60_000, VN_OFFSET));
    await a.store.sync();
    expect(calls).toBeLessThanOrEqual(2);
    expect(a.store.getSnapshot().pending).toBe(0);
  });

  it("keeps a group on its maker's clock when a member abroad syncs", async () => {
    const { app, lan, group } = await twoPeople(-420);
    await lan.store.put({ ...newNote(id(), "mỗi ngày 21h bố uống thuốc", app.clock.now, -420), group });
    await lan.store.sync();
    expect(app.sql.db.prepare("SELECT tz_offset FROM groups WHERE id = ?").get(group)).toEqual({ tz_offset: 420 });
    expect(lan.store.getSnapshot().groups[0]!.offset).toBe(420);
  });

  it("carries a note from one phone to the other", async () => {
    const { app, a, b } = await phones();
    await a.store.put(newNote(id(), "mai 8h gọi mẹ", app.clock.now, VN_OFFSET));
    await a.store.sync();
    await b.store.sync();
    expect(titles(b.store)).toEqual(["Gọi mẹ"]);
    expect(a.store.getSnapshot().pending).toBe(0);
  });

  it("works with no signal, and sends everything once it is back", async () => {
    const { app, net, a, b } = await phones();
    net.up = false;
    await a.store.put(newNote(id(), "đi chợ: trứng, sữa", app.clock.now, VN_OFFSET));
    await a.store.put(newNote(id(), "14h gặp khách", app.clock.now, VN_OFFSET));
    await a.store.sync();
    expect(a.store.getSnapshot()).toMatchObject({ status: "offline", pending: 2 });
    expect(titles(a.store)).toEqual(["Gặp khách", "Đi chợ"]);
    net.up = true;
    await a.store.sync();
    expect(a.store.getSnapshot()).toMatchObject({ status: "idle", pending: 0 });
    await b.store.sync();
    expect(titles(b.store)).toEqual(["Gặp khách", "Đi chợ"]);
  });

  it("settles two phones editing the same note on the later edit", async () => {
    const { app, a, b } = await phones();
    const n = newNote(id(), "họp 14:30", app.clock.now, VN_OFFSET);
    await a.store.put(n);
    await a.store.sync();
    await b.store.sync();
    app.clock.now += 1_000;
    await a.store.put(snooze(a.store.get(n.id)!, app.clock.now + 3_600_000, app.clock.now));
    app.clock.now += 1_000;
    await b.store.put(remove(b.store.get(n.id)!, app.clock.now));
    await a.store.sync();
    await b.store.sync();
    await a.store.sync();
    expect(a.store.get(n.id)?.deleted).toBe(true);
    expect(b.store.get(n.id)?.deleted).toBe(true);
  });

  it("keeps waiting changes across a restart", async () => {
    const { app, net, a } = await phones();
    net.up = false;
    await a.store.put(newNote(id(), "ghi khi mất sóng", app.clock.now, VN_OFFSET));
    const again = new NotesStore({ persist: a.persist, transport: { sync: async () => { throw new Offline(); } }, offset: () => VN_OFFSET, isSignedOut: () => false });
    await again.load();
    expect(again.getSnapshot().pending).toBe(1);
  });

  it("puts a note in a group: the others get it, their ticks come back with their name", async () => {
    const { app, hai, lan, group } = await twoPeople();
    const own = newNote(id(), "mai 8h đóng tiền điện", app.clock.now, VN_OFFSET);
    await hai.store.put(own);
    await hai.store.sync();
    const [moved, gone] = intoGroup(hai.store.get(own.id)!, group, id(), app.clock.now + 1);
    await hai.store.put(gone);
    await hai.store.put(moved);
    await hai.store.sync();
    expect(hai.store.get(own.id)?.deleted).toBe(true);

    await lan.store.sync();
    expect(lan.store.getSnapshot().groups.map((g) => g.name)).toEqual(["Gia đình"]);
    expect(titles(lan.store)).toEqual(["Đóng tiền điện"]);

    app.clock.now += 60_000;
    await lan.store.put(markDone(lan.store.get(moved.id)!, app.clock.now, VN_OFFSET));
    await lan.store.sync();
    await hai.store.sync();
    expect(hai.store.get(moved.id)).toMatchObject({ done: app.clock.now, by: { name: "Lan", at: app.clock.now } });
  });

  it("drops a group's notes from the phone of someone who left it, and keeps their own", async () => {
    const { app, hai, lan, group } = await twoPeople();
    await hai.store.put({ ...newNote(id(), "mai 8h đóng tiền điện", app.clock.now, VN_OFFSET), group });
    await hai.store.sync();
    await lan.store.put(newNote(id(), "mai 9h gọi mẹ", app.clock.now, VN_OFFSET));
    await lan.store.sync();
    expect(titles(lan.store)).toEqual(["Gọi mẹ", "Đóng tiền điện"]);
    await app.post("/api/groups/leave", { id: group }, lan.cookie);
    await lan.store.sync();
    expect(titles(lan.store)).toEqual(["Gọi mẹ"]);
    expect(lan.store.getSnapshot().groups).toEqual([]);
    expect([...lan.persist.notes.values()].map((n) => n.title)).toEqual(["Gọi mẹ"]);
  });

  it("gives another account on the same phone a clean copy", async () => {
    const { app, net, a } = await phones();
    net.up = false;
    await a.store.claim("user-1");
    await a.store.put(newNote(id(), "của người thứ nhất", app.clock.now, VN_OFFSET));
    await a.store.claim("user-2");
    expect(a.store.getSnapshot()).toMatchObject({ pending: 0 });
    expect(a.store.getSnapshot().notes.size).toBe(0);
  });
});
