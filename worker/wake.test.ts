import { describe, expect, it } from "vitest";
import { parse } from "../src/shared/parse";
import type { Note } from "../src/shared/protocol";
import { DAY, HOUR, MINUTE, VN_OFFSET } from "../src/shared/wall";
import { testApp } from "./testing/app";
import { nextSweep, nextWake } from "./wake";

function note(text: string, now: number): Note {
  const p = parse(text, now, VN_OFFSET);
  return { id: `wake-note-${text.length}-${now}`.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "x"), text, title: p.title, items: p.items, tags: p.tags, due: p.due, rule: p.rule, nag: p.nag, done: null, pinned: false, deleted: false, created: now, updated: now, group: null, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [] };
}

describe("the reminders' clock", () => {
  it("wakes at the earliest of a reminder, a morning list and the daily sweep", async () => {
    const app = testApp();
    const now = app.clock.now;
    // Nobody yet: only the sweep, at 20:00 UTC.
    expect(await nextWake(app.sql, now)).toBe(nextSweep(now));
    const cookie = await app.signIn();
    // Signed up: the morning list at 07:00 Vietnam (00:00 UTC) is sooner than the sweep? Not at 03:30 UTC.
    const morning = (await nextWake(app.sql, now)) as number;
    expect(morning).toBeLessThanOrEqual(nextSweep(now));
    await app.post("/api/sync", { since: 0, offset: VN_OFFSET, changes: [note("30p nữa tắt bếp", now)] }, cookie);
    expect(await nextWake(app.sql, now)).toBe(Math.floor((now + 30 * MINUTE) / MINUTE) * MINUTE);
  });

  it("sweeps at three in the morning, Vietnam time, every day", () => {
    const day = Date.UTC(2026, 9, 12);
    expect(nextSweep(day + 19 * HOUR)).toBe(day + 20 * HOUR);
    expect(nextSweep(day + 20 * HOUR)).toBe(day + DAY + 20 * HOUR);
  });

  it("is told when a sync brought something in, and not for a plain look", async () => {
    const app = testApp();
    let woken = 0;
    app.deps.wake = () => woken++;
    // Signing in may bring a guest's reminders along: that wakes it too.
    const cookie = await app.signIn();
    expect(woken).toBe(1);
    woken = 0;
    await app.post("/api/sync", { since: 0, offset: VN_OFFSET, changes: [] }, cookie);
    expect(woken).toBe(0);
    await app.post("/api/sync", { since: 0, offset: VN_OFFSET, changes: [note("mai 8h gọi mẹ", app.clock.now)] }, cookie);
    expect(woken).toBe(1);
    // A new guest's morning list, and a shortcut's note, count too.
    await app.post("/api/guest", {});
    expect(woken).toBe(2);
  });
});
