// Repeating reminders. A rule names the clock time and which days; the
// next time is always worked out from the rule alone, never from the last
// one, so putting one occurrence off ("+10 phút") never shifts the rest.
import { solarToLunar, lunarMonthLength } from "./lunar";
import { DAY, daysInMonth, fromWall, toWall } from "./wall";

/** Some days of the week at one time, for so many minutes ("thứ 4, 7 từ 20h30 đến 22h"). */
export interface Slot {
  /** 0 = chủ nhật … 6 = thứ 7, ascending, no repeats. */
  wds: number[];
  h: number;
  mi: number;
  /** Minutes it lasts, when a range was given. */
  dur?: number;
}

export type Rule =
  | { kind: "day"; h: number; mi: number }
  | { kind: "week"; wd: number; h: number; mi: number }
  /** Several days, each group at its own time: "thứ 2 20h-20h30, thứ 4 và 7 20h30-22h". */
  | { kind: "weekly"; slots: Slot[] }
  | { kind: "month"; d: number; h: number; mi: number }
  | { kind: "year"; mo: number; d: number; h: number; mi: number }
  | { kind: "lunarMonth"; ld: number; h: number; mi: number }
  | { kind: "lunarYear"; lm: number; ld: number; h: number; mi: number };

export type RuleKind = Rule["kind"];

const int = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

function readSlot(v: unknown): Slot | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  const keys = Object.keys(s).sort().join(",");
  if (keys !== "h,mi,wds" && keys !== "dur,h,mi,wds") return null;
  if (!int(s.h, 0, 23) || !int(s.mi, 0, 59) || !Array.isArray(s.wds) || s.wds.length < 1 || s.wds.length > 7) return null;
  if (!s.wds.every((d, i, a) => int(d, 0, 6) && (i === 0 || d > a[i - 1]))) return null;
  if (s.dur !== undefined && !int(s.dur, 1, 1440)) return null;
  return { wds: [...(s.wds as number[])], h: s.h, mi: s.mi, ...(s.dur !== undefined ? { dur: s.dur as number } : {}) };
}

/** A rule as it came over the wire or out of the database: checked field by field, extra fields refused. */
export function readRule(v: unknown): Rule | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (r.kind === "weekly") {
    if (Object.keys(r).sort().join(",") !== "kind,slots" || !Array.isArray(r.slots) || r.slots.length < 1 || r.slots.length > 7) return null;
    const slots = r.slots.map(readSlot);
    return slots.every((x): x is Slot => x !== null) ? { kind: "weekly", slots } : null;
  }
  if (!int(r.h, 0, 23) || !int(r.mi, 0, 59)) return null;
  const { h, mi } = r;
  const keys = Object.keys(r).sort().join(",");
  switch (r.kind) {
    case "day":
      return keys === "h,kind,mi" ? { kind: "day", h, mi } : null;
    case "week":
      return keys === "h,kind,mi,wd" && int(r.wd, 0, 6) ? { kind: "week", wd: r.wd, h, mi } : null;
    case "month":
      return keys === "d,h,kind,mi" && int(r.d, 1, 31) ? { kind: "month", d: r.d, h, mi } : null;
    case "year":
      return keys === "d,h,kind,mi,mo" && int(r.mo, 1, 12) && int(r.d, 1, 31) && r.d <= daysInMonth(2024, r.mo) ? { kind: "year", mo: r.mo, d: r.d, h, mi } : null;
    case "lunarMonth":
      return keys === "h,kind,ld,mi" && int(r.ld, 1, 30) ? { kind: "lunarMonth", ld: r.ld, h, mi } : null;
    case "lunarYear":
      return keys === "h,kind,ld,lm,mi" && int(r.lm, 1, 12) && int(r.ld, 1, 30) ? { kind: "lunarYear", lm: r.lm, ld: r.ld, h, mi } : null;
    default:
      return null;
  }
}

/** Longer than any rule's gap (a lunar year with a leap month is 385 days): past this, give up rather than loop. */
const SEARCH_DAYS = 400;

/** The first time `rule` comes round strictly after `after`. */
export function nextOccurrence(rule: Rule, after: number, offset: number): number {
  if (rule.kind === "weekly") {
    let best = Infinity;
    for (const s of rule.slots) for (const wd of s.wds) best = Math.min(best, nextOccurrence({ kind: "week", wd, h: s.h, mi: s.mi }, after, offset));
    return best;
  }
  const w = toWall(after, offset);
  const at = (y: number, mo: number, d: number) => fromWall(y, mo, d, rule.h, rule.mi, offset);
  switch (rule.kind) {
    case "day": {
      const t = at(w.y, w.mo, w.d);
      return t > after ? t : t + DAY;
    }
    case "week": {
      const t = at(w.y, w.mo, w.d + ((rule.wd - w.wd + 7) % 7));
      return t > after ? t : t + 7 * DAY;
    }
    case "month": {
      // The 31st of a 30-day month is its last day, not the 1st of the next.
      for (let k = 0; k < 13; k++) {
        const y = w.y + Math.floor((w.mo - 1 + k) / 12);
        const mo = ((w.mo - 1 + k) % 12) + 1;
        const t = at(y, mo, Math.min(rule.d, daysInMonth(y, mo)));
        if (t > after) return t;
      }
      break;
    }
    case "year": {
      // 29/2 comes round on 28/2 in the other years.
      for (let k = 0; k < 2; k++) {
        const y = w.y + k;
        const t = at(y, rule.mo, Math.min(rule.d, daysInMonth(y, rule.mo)));
        if (t > after) return t;
      }
      break;
    }
    case "lunarMonth":
    case "lunarYear": {
      for (let k = 0; k < SEARCH_DAYS; k++) {
        const day = toWall(fromWall(w.y, w.mo, w.d + k, 12, 0, offset), offset);
        const l = solarToLunar(day.y, day.mo, day.d);
        if (!l) break;
        if (rule.kind === "lunarYear" && (l.leap || l.month !== rule.lm)) continue;
        // Day 30 of a 29-day month falls on its last day; a leap month has its rằm too.
        const len = lunarMonthLength(l.month, l.year, l.leap);
        if (l.day !== Math.min(rule.ld, len)) continue;
        const t = at(day.y, day.mo, day.d);
        if (t > after) return t;
      }
      break;
    }
  }
  // Only reached outside the lunar table's years (1900–2199): never in use.
  return after + 365 * DAY;
}

/** How long the occurrence at `at` lasts, in minutes, when its slot gave a range. */
export function durationAt(rule: Rule | null, at: number, offset: number): number | null {
  if (rule?.kind !== "weekly") return null;
  const w = toWall(at, offset);
  return rule.slots.find((s) => s.h === w.h && s.mi === w.mi && s.wds.includes(w.wd))?.dur ?? null;
}

/** Longer than the widest gap between two times a rule comes round (a lunar year with a leap month is 385 days). */
function widestGap(rule: Rule): number {
  switch (rule.kind) {
    case "day":
      return 2 * DAY;
    case "week":
    case "weekly":
      return 8 * DAY;
    case "month":
    case "lunarMonth":
      return 35 * DAY;
    case "year":
      return 367 * DAY;
    case "lunarYear":
      return SEARCH_DAYS * DAY;
  }
}

/**
 * The latest time the rule came round between `from` and `upTo`
 * (inclusive), or null: for a repeating reminder nobody answered, the one
 * that is "đến giờ" now, not the first one missed days ago.
 *
 * Looked for no further back than one gap before `upTo`, where it must be:
 * a note each member ticks off keeps the `due` it started with for good, and
 * walked from there "9h, 18h hằng ngày" ran past the step limit in a year
 * and a half, every row, every minute.
 */
export function latestOccurrence(rule: Rule, from: number, upTo: number, offset: number): number | null {
  let last: number | null = null;
  let t = Math.max(from, upTo - widestGap(rule)) - 1;
  for (let i = 0; i < 1000; i++) {
    t = nextOccurrence(rule, t, offset);
    if (t > upTo) return last;
    last = t;
  }
  return last;
}
