import { route } from "./app";
import type { ClockEnv } from "./clock";
import { d1Sql } from "./d1";
import { googleConfig, type GoogleEnv } from "./google";
import { heartbeat } from "./heartbeat";

// The Durable Object's class, for the runtime (wrangler.jsonc "durable_objects").
export { Clock } from "./clock";

interface Env extends GoogleEnv, ClockEnv {
  ASSETS: Fetcher;
  CLOCK: DurableObjectNamespace<import("./clock").Clock>;
  /** .dev.vars only: a fake push service to test against. */
  PUSH_TEST_ORIGIN?: string;
  /** Optional secret: a healthchecks.io ping URL, told every ten minutes that reminders are kept (worker/heartbeat.ts). */
  HEARTBEAT_URL?: string;
}

/** The one instance: two clocks would ring the same reminder twice. */
const clock = (env: Env) => env.CLOCK.get(env.CLOCK.idFromName("reminders"));

/**
 * Once an isolate has made sure the clock is wound. Its alarm winds itself
 * after every ring; this is for the very first one after a deploy, and for
 * any way it could ever stop: the first request a fresh isolate sees, of
 * any kind, winds it again.
 */
let wound = false;

export default {
  fetch(req, env, ctx) {
    const wake = () => ctx.waitUntil(clock(env).wake().catch((e: unknown) => console.error("nho-nha: wake failed", String(e))));
    if (!wound) {
      wound = true;
      wake();
    }
    // Each request metered against the day's D1 writes (worker/budget.ts). What it wrote is counted
    // once it has answered and the work it left running is done (a group's "đã vào nhóm" push).
    const sql = d1Sql(env.DB);
    const after: Promise<unknown>[] = [];
    const answer = route(req, {
      sql,
      assets: env.ASSETS,
      now: Date.now,
      vapidKey: env.VAPID_KEY,
      pushTestOrigin: env.PUSH_TEST_ORIGIN,
      google: googleConfig(env),
      contactEmail: env.CONTACT_EMAIL?.trim() || undefined,
      wake,
      // As the clock has it (worker/clock.ts): Apple refuses a VAPID contact that is not https: or mailto:.
      subject: env.PUBLIC_ORIGIN?.trim() || (env.CONTACT_EMAIL?.trim() ? `mailto:${env.CONTACT_EMAIL.trim()}` : undefined),
      background: (work) => {
        after.push(work);
        ctx.waitUntil(work);
      },
    });
    ctx.waitUntil(
      Promise.allSettled([answer])
        .then(() => Promise.allSettled(after))
        .then(() => sql.flush())
        .catch((e: unknown) => console.error("nho-nha: write count failed", String(e))),
    );
    return answer;
  },
  // Every minute, if Cloudflare runs it: a backstop that makes sure the clock's alarm is set.
  scheduled(event, env, ctx) {
    ctx.waitUntil(clock(env).wake().catch((e: unknown) => console.error("nho-nha: wake failed", String(e))));
    const url = env.HEARTBEAT_URL?.trim();
    // Reads only: nothing to count, so no flush.
    if (url && new Date(event.scheduledTime).getUTCMinutes() % 10 === 0) ctx.waitUntil(heartbeat(url, d1Sql(env.DB), event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
