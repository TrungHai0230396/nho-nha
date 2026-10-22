// Writes src/shared/lunar-table.ts: the Vietnamese lunar calendar from
// FIRST_YEAR to LAST_YEAR, out of the new moons and the sun's longitude that
// astronomy-engine (MIT) computes. Node 24 runs it as it is:
//
//   node scripts/lunar-table.ts
//
// The calendar's rules, every day reckoned at UTC+7:
// - a month starts on the day of a new moon;
// - month 11 is the one in which the December solstice falls;
// - when 13 months lie between one month 11 and the next, the first of them
//   in which the sun reaches no multiple of 30° of longitude (no "trung
//   khí") is the leap month, and it repeats the number of the month before.
//
// lunar-table.test.ts fails until the committed table is this script's output.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MakeTime, SearchMoonPhase, SearchSunLongitude, SunPosition, type AstroTime } from "astronomy-engine";

export const FIRST_YEAR = 1900;
export const LAST_YEAR = 2199;

const DAY_MS = 86_400_000;
const UTC7_MS = 7 * 3_600_000;

// astronomy-engine is not exact to the second: it leaves aberration out of
// its new moons, which come about 40 s after the apparent ones almanacs give,
// and its sun drifts by up to 40 s. So an event it puts within CLOSE_S of a
// midnight takes its day from JPL Horizons (DE441) instead: the moment the
// apparent ecliptic longitudes (quantity 31; Moon 301, Sun 10, seen from
// 500@399) meet, in TT, made UT with astronomy-engine's ΔT (Espenak and
// Meeus) like everything else here. From 2077 on, some of them would fall on
// the other day if ΔT stayed at today's 69 s: no one knows ΔT that far ahead.
const CLOSE_S = 180;

/** The events astronomy-engine puts within CLOSE_S of a midnight, by that midnight's day: their time per Horizons, at UTC+7. */
const CLOSE_CALLS: Record<string, string> = {
  "sun 90° 1924-06-22": "1924-06-21 23:59:22",
  "sun 300° 1938-01-21": "1938-01-20 23:58:45",
  "sun 180° 1938-09-24": "1938-09-23 23:59:30",
  "new moon 1944-06-21": "1944-06-20 23:59:33",
  "sun 30° 1946-04-21": "1946-04-21 00:02:10",
  "sun 90° 1953-06-22": "1953-06-21 23:59:55",
  "new moon 1967-07-08": "1967-07-08 00:00:03",
  "sun 0° 1981-03-21": "1981-03-21 00:02:51",
  "new moon 1997-12-30": "1997-12-29 23:56:32",
  "new moon 1998-09-21": "1998-09-21 00:01:29",
  "sun 60° 2004-05-21": "2004-05-20 23:59:12",
  "new moon 2031-04-22": "2031-04-21 23:56:56",
  "sun 120° 2038-07-23": "2038-07-22 23:59:41",
  "new moon 2054-05-08": "2054-05-08 00:00:27",
  "new moon 2062-12-31": "2062-12-30 23:56:40",
  "new moon 2072-12-10": "2072-12-09 23:58:44",
  "sun 150° 2074-08-23": "2074-08-23 00:00:11",
  "new moon 2077-11-16": "2077-11-15 23:59:51",
  "new moon 2079-08-27": "2079-08-27 00:02:20",
  "new moon 2085-10-19": "2085-10-18 23:59:35",
  "sun 300° 2111-01-21": "2111-01-21 00:00:48",
  "new moon 2125-01-05": "2125-01-04 23:57:03",
  "new moon 2130-05-08": "2130-05-07 23:58:06",
  "new moon 2150-05-27": "2150-05-26 23:59:23",
  "new moon 2153-10-18": "2153-10-18 00:01:19",
  "new moon 2159-05-18": "2159-05-17 23:58:06",
  "new moon 2175-01-23": "2175-01-22 23:59:35",
  "sun 210° 2180-10-23": "2180-10-22 23:58:28",
  "sun 270° 2186-12-22": "2186-12-21 23:58:54",
  "new moon 2188-04-27": "2188-04-27 00:01:50",
  "new moon 2199-01-27": "2199-01-26 23:57:53",
};

const iso = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Turns events into the days they fall on at UTC+7; `unused` then names the close calls never met. */
function calendarDays() {
  const used = new Set<string>();
  return {
    dayOf(name: string, t: AstroTime): number {
      const ms = t.date.getTime() + UTC7_MS;
      const midnight = Math.round(ms / DAY_MS);
      if (Math.abs(ms - midnight * DAY_MS) >= CLOSE_S * 1000) return Math.floor(ms / DAY_MS);
      const key = `${name} ${iso(midnight)}`;
      const at = CLOSE_CALLS[key];
      if (!at) throw new Error(`${key}: too close to midnight for astronomy-engine, time it with Horizons and add it to CLOSE_CALLS`);
      // CLOSE_S counts on astronomy-engine being within a minute of Horizons.
      if (Math.abs(Date.parse(`${at.replace(" ", "T")}Z`) - ms) >= 60_000) throw new Error(`${key}: ${at} is over a minute from astronomy-engine's time`);
      used.add(key);
      return Date.parse(at.slice(0, 10)) / DAY_MS;
    },
    unused: () => Object.keys(CLOSE_CALLS).filter((key) => !used.has(key)),
  };
}

type DayOf = (name: string, t: AstroTime) => number;

/** The days of the new moons from one instant to another. */
function newMoons(from: Date, to: Date, dayOf: DayOf): number[] {
  const days: number[] = [];
  let t = MakeTime(from);
  while (t.date.getTime() < to.getTime()) {
    const moon = SearchMoonPhase(0, t, 35);
    if (!moon) throw new Error(`No new moon after ${t.date.toISOString()}`);
    days.push(dayOf("new moon", moon));
    t = moon.AddDays(1);
  }
  return days;
}

interface Term {
  day: number;
  /** The sun's longitude reached that day, a multiple of 30°. */
  lon: number;
}

/** The days on which the sun reaches a multiple of 30° of longitude (the trung khí), from one instant to another. */
function terms(from: Date, to: Date, dayOf: DayOf): Term[] {
  const out: Term[] = [];
  let t = MakeTime(from);
  while (t.date.getTime() < to.getTime()) {
    const lon = ((Math.floor(SunPosition(t).elon / 30) + 1) * 30) % 360;
    const term = SearchSunLongitude(lon, t, 40);
    if (!term) throw new Error(`The sun does not reach ${lon}° after ${t.date.toISOString()}`);
    out.push({ day: dayOf(`sun ${lon}°`, term), lon });
    t = term.AddDays(1);
  }
  return out;
}

interface Month {
  /** Its first day, counted from 1970-01-01. */
  start: number;
  len: number;
  month: number;
  leap: boolean;
}

/** Every month from the month 11 before FIRST_YEAR's Tết to well past LAST_YEAR's end, numbered. */
function months(): Month[] {
  const from = new Date(Date.UTC(FIRST_YEAR - 2, 9, 1));
  const to = new Date(Date.UTC(LAST_YEAR + 2, 2, 1));
  const days = calendarDays();
  const moons = newMoons(from, to, days.dayOf);
  const sun = terms(from, to, days.dayOf);
  if (days.unused().length) throw new Error(`Not close calls any more: ${days.unused().join(", ")}`);
  const termDays = new Set(sun.map((x) => x.day));
  const hasTerm = (i: number) => {
    for (let d = moons[i]!; d < moons[i + 1]!; d++) if (termDays.has(d)) return true;
    return false;
  };
  // Month 11 starts on the last new moon on or before the day of the December solstice.
  const elevens = sun.filter((x) => x.lon === 270).map((x) => moons.findLastIndex((m) => m <= x.day));
  const out: Month[] = [];
  for (let s = 0; s + 1 < elevens.length; s++) {
    const a = elevens[s]!;
    const b = elevens[s + 1]!;
    if (b - a !== 12 && b - a !== 13) throw new Error(`${b - a} months from month 11 of ${iso(moons[a]!)}`);
    let leapAt = -1;
    for (let i = a + 1; b - a === 13 && i < b && leapAt < 0; i++) if (!hasTerm(i)) leapAt = i;
    if (b - a === 13 && leapAt < 0) throw new Error(`No leap month after month 11 of ${iso(moons[a]!)}`);
    let month = 11;
    for (let i = a; i < b; i++) {
      if (i > a && i !== leapAt) month = (month % 12) + 1;
      out.push({ start: moons[i]!, len: moons[i + 1]! - moons[i]!, month, leap: i === leapAt });
    }
  }
  return out;
}

/** One number per lunar year from FIRST_YEAR to LAST_YEAR, as src/shared/lunar-table.ts describes it. */
export function lunarTable(): number[] {
  const all = months();
  const tets = all.flatMap((m, i) => (m.month === 1 && !m.leap ? [i] : []));
  const out: number[] = [];
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    const jan1 = Date.UTC(y, 0, 1) / DAY_MS;
    const k = tets.findIndex((i) => all[i]!.start >= jan1);
    if (k < 0 || k + 1 >= tets.length) throw new Error(`No months computed for lunar year ${y}`);
    const year = all.slice(tets[k]!, tets[k + 1]);
    const tet = year[0]!.start - jan1;
    const leap = year.find((m) => m.leap)?.month ?? 0;
    if (tet > 63) throw new Error(`Tết ${y} falls on ${iso(year[0]!.start)}`);
    if (year.length !== (leap ? 13 : 12) || (leap && !year[leap]!.leap)) throw new Error(`Lunar year ${y} has ${year.length} months`);
    let big = 0;
    year.forEach((m, i) => {
      if (m.len !== 29 && m.len !== 30) throw new Error(`Month ${m.month} of ${y} has ${m.len} days`);
      if (m.len === 30) big |= 1 << i;
    });
    out.push((tet << 17) | (leap << 13) | big);
  }
  return out;
}

/** The text of src/shared/lunar-table.ts. */
export function render(): string {
  const years = lunarTable();
  const rows: string[] = [];
  for (let i = 0; i < years.length; i += 10) {
    const row = years.slice(i, i + 10).map((v) => `0x${v.toString(16).padStart(6, "0")},`);
    rows.push(`  ${row.join(" ")} // ${FIRST_YEAR + i}`);
  }
  return `// Made by scripts/lunar-table.ts from astronomy-engine's new moons and sun.
// Do not edit: change that script and run it again.
//
// One number per lunar year, from FIRST_YEAR on:
//   bits 0–12   which months have 30 days, the others 29: bit i is the i-th
//               month from Tết, the leap month counted where it falls
//   bits 13–16  the leap month, 0 when there is none
//   bits 17–22  Tết, as days after 1 January
export const FIRST_YEAR = ${FIRST_YEAR};
export const YEARS: readonly number[] = [
${rows.join("\n")}
];
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL("../src/shared/lunar-table.ts", import.meta.url), render());
}
