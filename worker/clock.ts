// The reminders' clock: one Durable Object whose alarm is set to the next
// moment anything must ring. Cloudflare's minute cron proved no guarantee
// on its own: on the first deploy (12/10/2026) the schedule was registered
// yet never ran for half an hour, while every reminder sat there due. An
// alarm fires at its time, and each run sets the next from the database.
//
// Everything that can bring a time closer (a sync, a shortcut, settings, a
// new guest) pokes it; the minute cron pokes it too, as a backstop. One
// instance, so two runs never push the same reminder twice.
import { DurableObject } from "cloudflare:workers";
import { HOUR } from "../src/shared/wall";
import { nextUtcDay, WritesSpent } from "./budget";
import { runCron } from "./cron";
import { d1Sql } from "./d1";
import { vapidFor } from "./push";
import { nextWake } from "./wake";

export interface ClockEnv {
  DB: D1Database;
  VAPID_KEY?: string;
  PUBLIC_ORIGIN?: string;
  CONTACT_EMAIL?: string;
  PUSH_CAP?: string;
}

/** A little after the time named, never before: a run at :00.000 must find what is due at :00. */
const SLACK_MS = 250;
const RETRY_MS = 60_000;
/** In the clock's storage: until when it rests, the day's D1 writes spent (worker/budget.ts), and pokes do not wake it. */
const RESTING = "resting";
/** How long it rests at a time: a budget raised, or the day's count put right by hand, rings again within the hour. */
const REST_MS = HOUR;

export class Clock extends DurableObject<ClockEnv> {
  /** Sets the alarm to the next time anything is due, if that is sooner than the one set. */
  async wake(): Promise<void> {
    const now = Date.now();
    if (now < ((await this.ctx.storage.get<number>(RESTING)) ?? 0)) return;
    const next = await nextWake(d1Sql(this.env.DB), now);
    const set = await this.ctx.storage.getAlarm();
    if (set === null || next + SLACK_MS < set) await this.ctx.storage.setAlarm(Math.max(next + SLACK_MS, now + SLACK_MS));
  }

  async alarm(): Promise<void> {
    const env = this.env;
    const sql = d1Sql(env.DB);
    // Apple refuses a VAPID contact that is not an https: or mailto: URL.
    const subject = env.PUBLIC_ORIGIN?.trim() || (env.CONTACT_EMAIL?.trim() ? `mailto:${env.CONTACT_EMAIL.trim()}` : "");
    const cap = Number(env.PUSH_CAP);
    let failed = false;
    let spent = false;
    try {
      const vapid = subject ? await vapidFor(env.VAPID_KEY) : null;
      const r = await runCron({ sql, now: Date.now(), vapid, subject, fetch, cap: Number.isInteger(cap) && cap > 0 ? cap : undefined });
      if (r.notes || r.digests || r.alerts) console.log(`nho-nha: ${r.notes} reminders, ${r.alerts} looks at undone ones, ${r.digests} morning lists, ${r.sent} pushes`);
    } catch (e) {
      failed = true;
      spent = e instanceof WritesSpent;
      console.error("nho-nha: run failed", String(e));
    } finally {
      // What this run wrote, before it went out of the budget too.
      await sql.flush().catch((e: unknown) => console.error("nho-nha: write count failed", String(e)));
      const now = Date.now();
      if (spent) {
        // Out of the day's writes: every run would read what is due and fail again, and the minute
        // cron's poke would bring the alarm back at once. Nothing rings until the next UTC day (07:00
        // in Vietnam), as on the free plan; it looks again each hour, and pokes wait.
        const until = Math.min(nextUtcDay(now), now + REST_MS);
        await this.ctx.storage.put(RESTING, until);
        await this.ctx.storage.setAlarm(until + SLACK_MS);
      } else {
        // Whatever else happened, wake again: what did not fit this run (PUSH_CAP) is already due. A run
        // that failed (D1 not answering, say) left those rows due: a minute, not a second, or it would
        // spin on them all day, reading.
        await this.ctx.storage.setAlarm(failed ? now + RETRY_MS : Math.max((await nextWake(sql, now)) + SLACK_MS, now + 1_000));
      }
    }
  }
}
