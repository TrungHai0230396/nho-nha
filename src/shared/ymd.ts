// A calendar day with no time and no timezone: what "15/11" or "mai" names.
import { civilFromDays, daysFromCivil } from "./lunar";

export interface Ymd {
  y: number;
  mo: number;
  d: number;
}

export function addDaysWall(day: Ymd, n: number): Ymd {
  const c = civilFromDays(daysFromCivil(day.y, day.mo, day.d) + n);
  return { y: c.y, mo: c.m, d: c.d };
}
