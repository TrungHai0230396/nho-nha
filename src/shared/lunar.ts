// The Vietnamese lunar calendar (âm lịch), at UTC+7, from 1900 to 2199.
//
// Read from a table (lunar-table.ts) that scripts/lunar-table.ts computes
// from astronomy-engine's new moons and sun, by the calendar's rules; that
// script says which. Here lunar dates are only looked up.
//
// Never Intl's "chinese" calendar instead: it is computed at UTC+8, and a
// new moon between 16:00 and 17:00 UTC starts the month a day later there.
// It puts Tết 2027 on 7/2 while Vietnam's is 6/2, and every day of tháng
// Giêng with it (also Tết 2007; Tết 1985 is a month apart).

import { FIRST_YEAR, YEARS } from "./lunar-table";

export interface LunarDate {
  day: number;
  month: number;
  year: number;
  /** A leap month (tháng nhuận) repeats the number of the month before it. */
  leap: boolean;
}

export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

// Proleptic Gregorian <-> days since 1970-01-01 (H. Hinnant): integers only.
export function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z: number): CivilDate {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

interface Year {
  /** Tết, in days since 1970-01-01. */
  tet: number;
  /** The leap month, 0 when there is none. */
  leap: number;
  /** Bit i set: the i-th month from Tết, the leap one counted where it falls, has 30 days. */
  big: number;
}

/** Lunar year y from the table, or null outside it. */
function lunarYear(y: number): Year | null {
  const v = YEARS[y - FIRST_YEAR];
  if (v === undefined) return null;
  return { tet: daysFromCivil(y, 1, 1) + (v >> 17), leap: (v >> 13) & 15, big: v & 0x1fff };
}

const length = (x: Year, i: number) => 29 + ((x.big >> i) & 1);

/** Where a month comes in its year, the leap one right after its namesake; -1 when it does not exist. */
function indexOf(x: Year, month: number, leap: boolean): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return -1;
  if (leap) return month === x.leap ? month : -1;
  return x.leap && month > x.leap ? month : month - 1;
}

/** Day z (since 1970-01-01) as a date of lunar year y, or null when it falls outside that year. */
function inYear(y: number, z: number): LunarDate | null {
  const x = lunarYear(y);
  if (!x || z < x.tet) return null;
  let start = x.tet;
  for (let i = 0; i < (x.leap ? 13 : 12); i++) {
    const len = length(x, i);
    if (z < start + len) return { day: z - start + 1, month: x.leap && i >= x.leap ? i : i + 1, year: y, leap: x.leap > 0 && i === x.leap };
    start += len;
  }
  return null;
}

export function solarToLunar(y: number, m: number, d: number): LunarDate | null {
  if (!Number.isInteger(y)) return null;
  const z = daysFromCivil(y, m, d);
  // Before Tết, a day belongs to the lunar year before.
  return inYear(y, z) ?? inYear(y - 1, z);
}

/** The solar date of a lunar one, or null when that month (or day 30 of a 29-day month) does not exist. */
export function lunarToSolar(day: number, month: number, year: number, leap = false): CivilDate | null {
  const x = lunarYear(year);
  const i = x ? indexOf(x, month, leap) : -1;
  if (!x || i < 0 || !Number.isInteger(day) || day < 1 || day > length(x, i)) return null;
  let start = x.tet;
  for (let j = 0; j < i; j++) start += length(x, j);
  return civilFromDays(start + day - 1);
}

/** Days in a lunar month (29 or 30); 0 when it does not exist. */
export function lunarMonthLength(month: number, year: number, leap = false): number {
  const x = lunarYear(year);
  const i = x ? indexOf(x, month, leap) : -1;
  return x && i >= 0 ? length(x, i) : 0;
}
