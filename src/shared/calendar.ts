// The calendar book: a month of solar days with their lunar dates, the
// year/month/day names (can chi), holidays and observances, and which notes
// fall on each day.
import { daysFromCivil, lunarMonthLength, solarToLunar, type LunarDate } from "./lunar";
import type { Note } from "./protocol";
import { nextOccurrence } from "./recur";
import { DAY, fromWall, toWall } from "./wall";

const CAN = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"];
const CHI = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** "Bính Ngọ" for lunar year 2026. */
export const yearName = (y: number) => `${CAN[mod(y + 6, 10)]} ${CHI[mod(y + 8, 12)]}`;
/** The lunar month's name (Hồ Ngọc Đức's rule); a leap month shares it. */
export const monthName = (m: number, y: number) => `${CAN[mod(y * 12 + m + 3, 10)]} ${CHI[mod(m + 1, 12)]}`;
/** The day's name, from its Julian day number. */
export function dayName(y: number, m: number, d: number): string {
  const jd = daysFromCivil(y, m, d) + 2440588;
  return `${CAN[mod(jd + 9, 10)]} ${CHI[mod(jd + 1, 12)]}`;
}

export interface Holiday {
  name: string;
  /** A public holiday off work (Bộ luật Lao động 2019, Điều 112). */
  off: boolean;
}

// Days off by law are marked; the rest are days people mark. Tết's five
// days and the day beside 2/9 are set by the government each year, so only
// the certain ones are marked off here, and the day beside 2/9 for the
// years it has been announced (QUOC_KHANH_PLUS). `from`: the first year a
// day is kept at all.
const SOLAR: Record<string, Holiday & { from?: number }> = {
  "1/1": { name: "Tết Dương lịch", off: true },
  "14/2": { name: "Lễ Tình nhân", off: false },
  "27/2": { name: "Ngày Thầy thuốc Việt Nam", off: false },
  "8/3": { name: "Quốc tế Phụ nữ", off: false },
  "26/3": { name: "Thành lập Đoàn TNCS Hồ Chí Minh", off: false },
  "30/4": { name: "Giải phóng miền Nam", off: true },
  "1/5": { name: "Quốc tế Lao động", off: true },
  "19/5": { name: "Ngày sinh Chủ tịch Hồ Chí Minh", off: false },
  "1/6": { name: "Quốc tế Thiếu nhi", off: false },
  "28/6": { name: "Ngày Gia đình Việt Nam", off: false },
  "27/7": { name: "Ngày Thương binh Liệt sĩ", off: false },
  "19/8": { name: "Cách mạng Tháng Tám", off: false },
  "2/9": { name: "Quốc khánh", off: true },
  "10/10": { name: "Giải phóng Thủ đô", off: false },
  "20/10": { name: "Ngày Phụ nữ Việt Nam", off: false },
  "20/11": { name: "Ngày Nhà giáo Việt Nam", off: false },
  // Nghị quyết 28/2026/QH16, in force from 1/7/2026: a day off on full pay (Hải, 12/10/2026).
  "24/11": { name: "Ngày Văn hóa Việt Nam", off: true, from: 2026 },
  "22/12": { name: "Thành lập Quân đội Nhân dân", off: false },
  "24/12": { name: "Lễ Giáng sinh", off: false },
};

const LUNAR: Record<string, Holiday> = {
  "1/1": { name: "Tết Nguyên Đán", off: true },
  "2/1": { name: "Mùng 2 Tết", off: true },
  "3/1": { name: "Mùng 3 Tết", off: true },
  "15/1": { name: "Tết Nguyên Tiêu", off: false },
  "3/3": { name: "Tết Hàn thực", off: false },
  "10/3": { name: "Giỗ Tổ Hùng Vương", off: true },
  "15/4": { name: "Lễ Phật Đản", off: false },
  "5/5": { name: "Tết Đoan Ngọ", off: false },
  "15/7": { name: "Lễ Vu Lan", off: false },
  "15/8": { name: "Tết Trung Thu", off: false },
  "9/9": { name: "Tết Trùng Cửu", off: false },
  "23/12": { name: "Ông Công Ông Táo", off: false },
};

/**
 * Quốc khánh is two days off (Bộ luật Lao động 2019, Điều 112): 2/9 and one
 * beside it, which the government names each year for its own staff (a firm
 * may pick the other). The day in September, for the years announced.
 */
const QUOC_KHANH_PLUS: Record<number, number> = { 2021: 3, 2022: 1, 2023: 1, 2024: 3, 2025: 1, 2026: 1 };

/** The day beside 2/9 that year, or null when it has not been announced (or is not known here). */
export const quocKhanhPlus = (y: number): number | null => QUOC_KHANH_PLUS[y] ?? null;

export function holidaysOn(y: number, m: number, d: number, l: LunarDate | null): Holiday[] {
  const out: Holiday[] = [];
  const solar = SOLAR[`${d}/${m}`];
  if (solar && (solar.from === undefined || y >= solar.from)) out.push({ name: solar.name, off: solar.off });
  if (m === 9 && quocKhanhPlus(y) === d) out.push({ name: "Nghỉ lễ Quốc khánh", off: true });
  if (l && !l.leap) {
    const lunar = LUNAR[`${l.day}/${l.month}`];
    if (lunar) out.push(lunar);
    // The year's last day is 29 or 30 of tháng Chạp: Giao thừa either way.
    if (l.month === 12 && l.day === lunarMonthLength(12, l.year, false)) out.push({ name: "Tất niên, Giao thừa", off: true });
  }
  return out;
}

export interface Cell {
  y: number;
  m: number;
  d: number;
  /** 0 = chủ nhật. */
  wd: number;
  inMonth: boolean;
  lunar: LunarDate | null;
  holidays: Holiday[];
}

/** Six weeks from the Monday on or before the 1st: the page of one month, Monday first. */
export function monthGrid(y: number, m: number): Cell[] {
  const first = daysFromCivil(y, m, 1);
  const wd1 = mod(first + 4, 7); // 1970-01-01 was a Thursday
  const start = first - mod(wd1 - 1, 7);
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const z = start + i;
    const t = new Date(z * DAY);
    const c = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
    const lunar = solarToLunar(c.y, c.m, c.d);
    cells.push({ ...c, wd: mod(z + 4, 7), inMonth: c.m === m, lunar, holidays: holidaysOn(c.y, c.m, c.d, lunar) });
  }
  return cells;
}

/** "mùng 1/9", "15", "rằm" for a calendar cell: short, and the month where one begins. */
export function lunarShort(l: LunarDate): string {
  if (l.day === 1) return `1/${l.month}${l.leap ? "n" : ""}`;
  return String(l.day);
}

export interface Occurrence {
  note: Note;
  at: number;
}

/**
 * Every time a note comes due between `from` and `to` (a page of the
 * calendar): its reminder if open, or each time its rule comes round.
 * Bounded, so a daily rule over six weeks costs 42 steps, not a loop; the
 * bound is a page's worth at seven times a day, the most a week of slots
 * holds (64 cut "9h, 18h hằng ngày" off after its 32nd day).
 */
const PAGE_TIMES = 42 * 7 + 1;

export function occurrences(notes: Iterable<Note>, from: number, to: number, offset: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const note of notes) {
    if (note.deleted) continue;
    if (note.rule) {
      // The pending one (maybe put off), then the rule's from there on.
      if (note.due !== null && note.due >= from && note.due < to) out.push({ note, at: note.due });
      let t = Math.max(from - 1, note.due ?? from - 1);
      for (let k = 0; k < PAGE_TIMES; k++) {
        t = nextOccurrence(note.rule, t, offset);
        if (t >= to) break;
        if (t !== note.due) out.push({ note, at: t });
      }
    } else if (note.due !== null && note.due >= from && note.due < to) {
      out.push({ note, at: note.due });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The bounds of a calendar page, on the person's clock. */
export function pageBounds(cells: Cell[], offset: number): { from: number; to: number } {
  const a = cells[0]!;
  const z = cells.at(-1)!;
  return { from: fromWall(a.y, a.m, a.d, 0, 0, offset), to: fromWall(z.y, z.m, z.d, 0, 0, offset) + DAY };
}

/** The key a cell and an occurrence share: "2026-10-12". */
export const dayKey = (y: number, m: number, d: number) => `${y}-${m}-${d}`;
export function dayKeyOf(at: number, offset: number): string {
  const w = toWall(at, offset);
  return dayKey(w.y, w.mo, w.d);
}
