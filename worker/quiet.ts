// Hours of sleep (Cài đặt → Giờ ngủ): news about other people ("Bố chưa
// bấm Xong", "Lan đã vào nhóm") waits for the morning, or is not sent. A
// person's own reminders are never held: they set those times themselves.
import { fromWall, toWall } from "../src/shared/wall";

export interface Quiet {
  from: number | null;
  to: number | null;
  offset: number;
}

/** A person's hours as stored: null when they have none, or the hours make no span. */
export function quietOf(r: { quiet_from?: unknown; quiet_to?: unknown; tz_offset?: unknown }): Quiet | null {
  const from = r.quiet_from === null || r.quiet_from === undefined ? null : Number(r.quiet_from);
  const to = r.quiet_to === null || r.quiet_to === undefined ? null : Number(r.quiet_to);
  if (from === null || to === null || from === to) return null;
  return { from, to, offset: Number(r.tz_offset ?? 420) };
}

/** Asleep at `now` by their clock: 22–6 runs over midnight, 0–7 does not. */
export function asleep(q: Quiet | null, now: number): boolean {
  if (!q || q.from === null || q.to === null) return false;
  const h = toWall(now, q.offset).h;
  return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

/** The end of their night: the next `to` o'clock after `now`, on their clock. */
export function wakeAt(q: Quiet, now: number): number {
  const w = toWall(now, q.offset);
  const today = fromWall(w.y, w.mo, w.d, q.to ?? 6, 0, q.offset);
  return today > now ? today : fromWall(w.y, w.mo, w.d + 1, q.to ?? 6, 0, q.offset);
}
