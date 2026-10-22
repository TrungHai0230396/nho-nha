// Time as the person's own clock shows it. Every calculation goes through
// (epoch + offset) read with Date's UTC methods, so a result never depends
// on the timezone of the machine doing it: the Worker runs in UTC, phones in
// Vietnam, and tests wherever the laptop happens to be.

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Minutes east of UTC. Vietnam is +7 all year: no daylight saving to step around. */
export const VN_OFFSET = 420;

export interface Wall {
  y: number;
  /** 1–12 */
  mo: number;
  d: number;
  h: number;
  mi: number;
  /** 0 = Sunday (chủ nhật) … 6 = Saturday (thứ 7) */
  wd: number;
}

export function toWall(at: number, offset: number): Wall {
  const t = new Date(at + offset * MINUTE);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), wd: t.getUTCDay() };
}

/** The moment the clock reads y-mo-d h:mi. Out-of-range days roll over (d = 32 is the 1st of the next month). */
export function fromWall(y: number, mo: number, d: number, h: number, mi: number, offset: number): number {
  return Date.UTC(y, mo - 1, d, h, mi) - offset * MINUTE;
}

/** Midnight that starts the day `at` falls on, on that clock. */
export function startOfDay(at: number, offset: number): number {
  const w = toWall(at, offset);
  return fromWall(w.y, w.mo, w.d, 0, 0, offset);
}

/** Whole days from the day of `a` to the day of `b` (b later: positive). */
export function dayDiff(a: number, b: number, offset: number): number {
  return Math.round((startOfDay(b, offset) - startOfDay(a, offset)) / DAY);
}

export function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** The device's own offset right now, the way the server wants it. */
export function deviceOffset(): number {
  return -new Date().getTimezoneOffset();
}
