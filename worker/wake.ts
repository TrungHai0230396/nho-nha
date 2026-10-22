// When the reminders' clock (worker/clock.ts) must next wake: the earliest
// reminder still to ring, the earliest morning list, and the daily sweep of
// unreachable guests and devices no longer counted. Kept apart from the
// Durable Object so it is tested on node:sqlite like the rest.
import { DAY, HOUR } from "../src/shared/wall";
import type { Sql } from "./sql";

/** 03:00 in Vietnam, 20:00 UTC: when guests nobody can reach, and devices unseen for 90 days, are swept. */
export function nextSweep(now: number): number {
  const t = Math.floor(now / DAY) * DAY + 20 * HOUR;
  return t > now ? t : t + DAY;
}

export async function nextWake(sql: Sql, now: number): Promise<number> {
  const [fire = [], digest = [], alert = []] = await sql.batch([
    { sql: "SELECT MIN(fire_at) AS t FROM notes WHERE fire_at IS NOT NULL", params: [] },
    { sql: "SELECT MIN(digest_next) AS t FROM users WHERE digest_next IS NOT NULL", params: [] },
    // "Báo cho tôi nếu chưa xong": the look half an hour after, and the morning of those asleep then.
    { sql: "SELECT MIN(alert_at) AS t FROM notes WHERE alert_at IS NOT NULL", params: [] },
  ]);
  const times = [fire[0]?.t, digest[0]?.t, alert[0]?.t].filter((t): t is number => typeof t === "number");
  return Math.min(nextSweep(now), ...times);
}
