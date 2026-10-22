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

export class Clock extends DurableObject<ClockEnv> {
  /** Sets the alarm to the next time anything is due, if that is sooner than the one set. */
  async wake(): Promise<void> {
    const now = Date.now();
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
    try {
      const vapid = subject ? await vapidFor(env.VAPID_KEY) : null;
      const r = await runCron({ sql, now: Date.now(), vapid, subject, fetch, cap: Number.isInteger(cap) && cap > 0 ? cap : undefined });
      if (r.notes || r.digests || r.alerts) console.log(`nho-nha: ${r.notes} reminders, ${r.alerts} looks at undone ones, ${r.digests} morning lists, ${r.sent} pushes`);
    } finally {
      // Whatever happened, wake again: what did not fit this run (PUSH_CAP) is already due.
      const now = Date.now();
      await this.ctx.storage.setAlarm(Math.max((await nextWake(sql, now)) + SLACK_MS, now + 1_000));
    }
  }
}
