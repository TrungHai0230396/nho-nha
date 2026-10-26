import { describe, expect, it } from "vitest";
import { heartbeat, LATE_MS } from "./heartbeat";
import type { Sql } from "./sql";
import { memorySql } from "./testing/sqlite";

const URL_ = "https://hc-ping.com/abc";
const NOW = Date.UTC(2026, 9, 26, 3, 0);

async function ping(sql: Sql): Promise<string[]> {
  const sent: string[] = [];
  await heartbeat(URL_, sql, NOW, async (u) => {
    sent.push(String(u));
    return new Response("OK");
  });
  return sent;
}
const oldest = (v: number | null): Sql => ({ batch: async () => [[{ oldest: v }]] });

describe("heartbeat", () => {
  it("says the reminders are kept when none is overdue, on the real schema", async () => {
    expect(await ping(memorySql())).toEqual([URL_]);
    expect(await ping(oldest(NOW - LATE_MS + 1000))).toEqual([URL_]);
  });

  it("says fail when a reminder is overdue, or the database does not answer", async () => {
    expect(await ping(oldest(NOW - LATE_MS - 1000))).toEqual([`${URL_}/fail`]);
    expect(await ping({ batch: async () => Promise.reject(new Error("D1 down")) })).toEqual([`${URL_}/fail`]);
  });

  it("never throws when the ping itself fails", async () => {
    await expect(heartbeat(URL_, oldest(null), NOW, async () => Promise.reject(new Error("offline")))).resolves.toBeUndefined();
  });
});
