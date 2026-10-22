// How a time reads on screen and in a notification.
import { solarToLunar } from "./lunar";
import type { Rule, Slot } from "./recur";
import { dayDiff, toWall } from "./wall";

export const DOW = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const DOW_LONG = ["chủ nhật", "thứ 2", "thứ 3", "thứ 4", "thứ 5", "thứ 6", "thứ 7"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "Lan", "Lan và Hải", "Tú, Lan và Minh". */
export const andList = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} và ${names.at(-1)}`);

/** "08:00" */
export function clock(at: number, offset: number): string {
  const w = toWall(at, offset);
  return `${pad(w.h)}:${pad(w.mi)}`;
}

/** "hôm nay", "mai, T3 13/10", "hôm qua", "T6 16/10", "T6 16/10/2027" (another year). */
export function dayLabel(at: number, now: number, offset: number): string {
  const w = toWall(at, offset);
  const n = dayDiff(now, at, offset);
  const date = `${DOW[w.wd]} ${w.d}/${w.mo}${w.y !== toWall(now, offset).y ? `/${w.y}` : ""}`;
  if (n === 0) return "hôm nay";
  if (n === 1) return `mai, ${date}`;
  if (n === 2) return `ngày kia, ${date}`;
  if (n === -1) return `hôm qua, ${date}`;
  return date;
}

/** "20:00–20:30", or "20:00" without a length. */
export function clockRange(at: number, dur: number | null, offset: number): string {
  return dur ? `${clock(at, offset)}–${clock(at + dur * 60_000, offset)}` : clock(at, offset);
}

/** "08:00 · mai, T3 13/10", or "20:00–20:30 · T2 19/10" with a length. */
export function whenLabel(at: number, now: number, offset: number, dur: number | null = null): string {
  return `${clockRange(at, dur, offset)} · ${dayLabel(at, now, offset)}`;
}

/** Monday first, the way a Vietnamese week is read: "T2, T4, T7", "T7, CN". */
export function daysLabel(wds: number[]): string {
  return [...wds]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => DOW[d])
    .join(", ");
}

const hm = (h: number, mi: number) => `${pad(h)}:${pad(mi)}`;
const slotTime = (s: Slot) => (s.dur ? `${hm(s.h, s.mi)}–${hm(Math.floor(((s.h * 60 + s.mi + s.dur) % 1440) / 60), (s.mi + s.dur) % 60)}` : hm(s.h, s.mi));

export function ruleLabel(rule: Rule): string {
  switch (rule.kind) {
    case "day":
      return "mỗi ngày";
    case "week":
      return `${DOW_LONG[rule.wd]} hằng tuần`;
    case "month":
      return `ngày ${rule.d} hằng tháng`;
    case "year":
      return `${rule.d}/${rule.mo} hằng năm`;
    case "lunarMonth":
      return `${lunarDayName(rule.ld)} hằng tháng (âm)`;
    case "lunarYear":
      return `${rule.ld}/${rule.lm} âm hằng năm`;
    case "weekly": {
      // One time for all the days: the days are the news (the time is on the other chip).
      if (rule.slots.length === 1) return `${daysLabel(rule.slots[0]!.wds)} hằng tuần`;
      // The same days at several times: the days once ("mỗi ngày 09:00, 18:00"), not seven names twice.
      const days = rule.slots[0]!.wds;
      if (rule.slots.every((s) => s.wds.join() === days.join())) return `${days.length === 7 ? "mỗi ngày" : daysLabel(days)} ${rule.slots.map(slotTime).join(", ")}`;
      return rule.slots.map((s) => `${daysLabel(s.wds)} ${slotTime(s)}`).join(" · ");
    }
  }
}

const lunarDayName = (d: number) => (d === 15 ? "rằm" : d <= 10 ? `mùng ${d}` : `ngày ${d}`);

/** "rằm tháng 9 âm", "mùng 1 tháng 10 âm", "16 tháng 6 nhuận âm". */
export function lunarLabel(at: number, offset: number): string {
  const w = toWall(at, offset);
  const l = solarToLunar(w.y, w.mo, w.d);
  if (!l) return "";
  const day = l.day === 15 ? "rằm" : l.day <= 10 ? `mùng ${l.day}` : String(l.day);
  return `${day} tháng ${l.month === 1 ? "giêng" : l.month === 12 ? "chạp" : l.month}${l.leap ? " nhuận" : ""} âm`;
}
