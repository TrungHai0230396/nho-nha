// "Mỗi người tự bấm Xong" (protocol Note.each): whose tap counts for which
// time. Shared, so the phone that shows it and the cron that rings by it
// agree.
import { nextOccurrence, type Rule } from "./recur";

/** A member's own entry in a note's ticks, as kept: when they tapped, and on a repeating note the time they tapped for. */
export interface OwnTick {
  at: number | null;
  occ?: number | null;
}

/**
 * Whether a member's tap counts for the time that came round at `occ`.
 *
 * A one-off: any tap, but not one left over from when it repeated. A
 * repeating note: a tap for that time, or for a later one ("Bỏ qua lần
 * này" ahead of it), which is to say that after the time tapped for, the
 * next one is still to come at `occ`. "Nhắc lại sau" moves a time without
 * making it another: a tap for 9:00 still counts when it rings again at 9:10.
 */
export function ticksOff(tick: OwnTick | null | undefined, rule: Rule | null, occ: number, offset: number): boolean {
  if (!tick || tick.at === null || tick.at === undefined) return false;
  if (!rule) return tick.occ === null || tick.occ === undefined;
  return nextOccurrence(rule, tick.occ ?? tick.at, offset) > occ;
}
