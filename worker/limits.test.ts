import { describe, expect, it } from "vitest";
import { newNote } from "../src/lib/notes";
import type { Note } from "../src/shared/protocol";
import { DAY, VN_OFFSET } from "../src/shared/wall";
import { clientBucket } from "./google";
import { MAX_CHANGES_PER_DAY, MAX_NAGGING, MAX_TIMED } from "./notes";
import { testApp } from "./testing/app";

// Measured on 23/10/2026: one free guest's notes could spend the plan's 100,000 D1 writes a day.
let k = 0;
const id = () => `limit-note-${String(++k).padStart(10, "0")}`;

async function send(app: ReturnType<typeof testApp>, cookie: string, notes: Note[]): Promise<string[]> {
  const rejected: string[] = [];
  for (let i = 0; i < notes.length; i += 200) {
    const res = await app.post("/api/sync", { since: 0, changes: notes.slice(i, i + 200), offset: VN_OFFSET, groups: {} }, cookie);
    rejected.push(...((await res.json()) as { rejected: string[] }).rejected);
  }
  return rejected;
}

describe("one account cannot spend the free plan for everyone", () => {
  it(`keeps at most ${MAX_TIMED} notes with a time to come, ${MAX_NAGGING} of them "nhắc dai"`, async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const timed = Array.from({ length: MAX_TIMED + 3 }, () => newNote(id(), "mai 8h gọi mẹ", app.clock.now, VN_OFFSET));
    expect(await send(app, cookie, timed)).toHaveLength(3);
    const other = testApp();
    const theirs = await other.signIn();
    const nagging = Array.from({ length: MAX_NAGGING + 2 }, () => newNote(id(), "mai 8h gọi mẹ!", other.clock.now, VN_OFFSET));
    expect(await send(other, theirs, nagging)).toHaveLength(2);
  });

  it(`takes at most ${MAX_CHANGES_PER_DAY} changes a day from one person`, async () => {
    const app = testApp();
    const cookie = await app.signIn();
    const plain = Array.from({ length: MAX_CHANGES_PER_DAY + 5 }, () => newNote(id(), "ghi chú", app.clock.now, VN_OFFSET));
    expect(await send(app, cookie, plain)).toHaveLength(5);
    app.clock.now += DAY;
    expect(await send(app, cookie, [newNote(id(), "ghi chú", app.clock.now, VN_OFFSET)])).toEqual([]);
  });

  it("writes nothing more for a refused guest", async () => {
    const app = testApp();
    app.deps.guestLimits = { perClient: 2, all: 100 };
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push((await app.post("/api/guest", {})).status);
    expect(answers).toEqual([200, 200, 429, 429, 429]);
    expect(app.sql.db.prepare("SELECT n FROM counters WHERE kind LIKE 'guest:%'").get()).toEqual({ n: 3 });
    expect(app.sql.db.prepare("SELECT n FROM counters WHERE kind = 'guest'").get()).toEqual({ n: 2 });
  });

  it("counts an IPv6 address by its /56", () => {
    const req = (ip: string) => new Request("https://vi-du.test/", { headers: { "cf-connecting-ip": ip } });
    expect(clientBucket(req("2001:db8:1:2345::1"))).toBe("2001:db8:1:2300::/56");
    expect(clientBucket(req("2001:db8:1:23ff:abcd::9"))).toBe("2001:db8:1:2300::/56");
  });
});
