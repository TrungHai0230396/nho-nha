import type { Sql } from "./sql";

/**
 * A dead man's switch for the owner's instance (VAN-HANH.md): every ten
 * minutes the cron tells HEARTBEAT_URL (a healthchecks.io check) that the
 * reminders are kept, or "<url>/fail" when one is overdue or the database
 * does not answer; the check emails when either happens, or when pings stop
 * (the cron itself stopped). Only that leaves, never who or what. Unset, as
 * in a copy, nothing is sent. Like the cron, it reads across people.
 */
export const LATE_MS = 10 * 60_000;

export async function heartbeat(url: string, sql: Sql, now: number, send: typeof fetch = fetch): Promise<void> {
  let kept = false;
  try {
    const [rows = []] = await sql.batch([{ sql: "SELECT MIN(fire_at) AS oldest FROM notes WHERE fire_at IS NOT NULL", params: [] }]);
    const oldest = rows[0]?.oldest;
    kept = oldest == null || Number(oldest) >= now - LATE_MS;
  } catch {
    kept = false;
  }
  await send(kept ? url : `${url.replace(/\/+$/, "")}/fail`, { method: "POST" }).catch(() => undefined);
}
