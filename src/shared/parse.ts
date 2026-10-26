// What a line typed in Vietnamese asks for: "mai 8h gọi mẹ", "thứ 6 tuần sau
// nộp báo cáo!", "rằm thắp hương", "mỗi sáng thứ 2 họp team",
// "đi chợ: trứng, sữa, rau". Runs on the phone as the person types (with no
// signal too) and in the Worker for lines sent from an iPhone shortcut, so
// it takes the clock as arguments and touches nothing else.
import { lunarMonthLength, solarToLunar } from "./lunar";
import { nextOccurrence, type Rule } from "./recur";
import { addDaysWall, type Ymd } from "./ymd";
import { DAY, MINUTE, daysInMonth, fromWall, startOfDay, toWall } from "./wall";

export interface Span {
  s: number;
  e: number;
  kind: "time" | "tag" | "nag";
}

export interface Item {
  t: string;
  done: boolean;
}

export interface Parsed {
  /** The line without the words that were about time: what the list shows. */
  title: string;
  items: Item[] | null;
  tags: string[];
  /** When to remind, or null for a plain note. */
  due: number | null;
  rule: Rule | null;
  /** "!" at the end: remind again every few minutes until answered. */
  nag: boolean;
  /** The time named is already behind us ("sáng nay" typed at noon). */
  past: boolean;
  /** What was understood, for highlighting as it is typed. */
  spans: Span[];
  /**
   * A line with several times or days a reminder cannot hold together ("mai
   * 9h và 15h họp", "mùng 1 và rằm hằng tháng thắp hương", "thứ 4, thứ 6
   * tuần sau họp"): the line once per time or day, each saying only its
   * own, in the order written; null otherwise. Each becomes a reminder.
   */
  split: string[] | null;
}

const W = "[\\p{L}\\p{N}]";
/** A whole word or phrase: not inside a longer word ("mai" is not in "maison"). */
const rx = (src: string) => new RegExp(`(?<!${W})(?:${src})(?!${W})`, "giu");
const DNUM = "2|3|4|5|6|7|hai|ba|tư|năm|sáu|bảy|bẩy";
const DAY1 = `(?:thứ\\s*|t)(?:${DNUM})|chủ\\s*nhật|cn`;
/** More days after the first: "thứ 2,4,7", "t3 và t5", "thứ 2 đến thứ 6", "thứ 7, chủ nhật". */
const DAYMORE = `\\s*(?:,|và|&|\\/|-|–|đến|tới)\\s*(?:(?:thứ\\s*|t)?(?:${DNUM})|chủ\\s*nhật|cn)`;
const DAYSET = `(mỗi\\s*|hằng\\s*|hàng\\s*)?(?:các\\s*ngày\\s*)?(?:từ\\s*)?((?:${DAY1})(?:${DAYMORE})*)(\\s*tuần\\s*(?:sau|tới|này)|\\s*này)?(\\s*(?:hằng|hàng|mỗi)\\s*tuần)?`;
/** One clock time: "20h", "20h30", "8 giờ 15", "8h rưỡi", "20:30". */
const TIME = "\\d{1,2}(?::\\d{2}|\\s*(?:h|g|giờ)(?:\\s*\\d{1,2}(?:\\s*(?:phút|p))?|\\s*rưỡi)?)";
const PERIOD = "sáng|trưa|chiều|tối|đêm|khuya";
const LMON = "\\d{1,2}|giêng|chạp";
const NUMBER_WORDS: Record<string, number> = { một: 1, hai: 2, ba: 3, nửa: 0.5 };
type Period = "sáng" | "trưa" | "chiều" | "tối" | "đêm" | "khuya";
const PERIOD_HOUR: Record<Period, number> = { sáng: 8, trưa: 12, chiều: 14, tối: 20, đêm: 22, khuya: 23 };
/** When only the day is named. Offerings for rằm and mùng 1 are made early. */
const DEFAULT_HOUR = 8;
const LUNAR_HOUR = 7;
/** Before this the night is not over: "mai" typed at 00:30 is the morning to come. */
const LATE_HOUR = 4;
/** "Mai" is also a name: "gọi chị Mai" is not "call tomorrow". */
const NAME_BEFORE = /(?:^|\s)(?:chị|em|cô|bà|bạn|bé|con|anh|chú|dì|thím|mợ|cháu|ông|nhà|của|tên|với|cho)\s+$/u;
/** A date these follow is the same day every year. */
const YEARLY_WORDS = /(?<![\p{L}\p{N}])(?:sinh\s*nhật|kỷ\s*niệm|giỗ|ngày\s*cưới)(?![\p{L}\p{N}])/iu;

const WEEKDAY: Record<string, number> = { "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, hai: 1, ba: 2, tư: 3, năm: 4, sáu: 5, bảy: 6, bẩy: 6 };

function weekday(s: string): number {
  const t = s.replace(/\s+/g, " ").trim();
  if (t === "cn" || t === "chủ nhật") return 0;
  const m = /^(?:thứ ?|t)(.+)$/u.exec(t);
  return WEEKDAY[m?.[1] ?? ""] ?? 1;
}

const lunarMonth = (s: string) => (s === "giêng" ? 1 : s === "chạp" ? 12 : parseInt(s, 10));

/** Days of the week named together, and where. */
interface DayTok {
  s: number;
  e: number;
  wds: number[];
  /** "mỗi …", "… hằng tuần": every week. */
  rep: boolean;
  nextWeek: boolean;
  /** "này": the days of this week, once. */
  thisWeek: boolean;
  /** "tuần sau", "này"… as written, for the line once per day. */
  week?: string;
  period?: Period;
}

interface Range {
  s: number;
  e: number;
}

/** A clock time named, or a range of two ("từ 20h đến 20h30", "20h30-22h"). */
interface TimeTok {
  s: number;
  e: number;
  h: number;
  mi: number;
  end?: { h: number; mi: number };
  period?: Period;
  /** Where its period word is ("9h sáng"): it goes with the time when the line is split. */
  ps?: number;
  pe?: number;
}

/** "20h30" → 20:30; "8" (one end of "8-10h") → 8:00. */
function clockOf(t: string): { h: number; mi: number } | null {
  const m = /^(\d{1,2})(?::(\d{2})|\s*(?:h|g|giờ)(?:\s*(\d{1,2})(?:\s*(?:phút|p))?|\s*(rưỡi))?)?$/u.exec(t.trim());
  if (!m) return null;
  const h = +m[1]!;
  const mi = m[2] ? +m[2] : m[3] ? +m[3] : m[4] ? 30 : 0;
  return h <= 24 && mi <= 59 ? { h, mi } : null;
}

/** "thứ 2,4,7" → [1, 3, 6]; "thứ 2 đến thứ 6" → [1…5]; "thứ 7, cn" → [0, 6]. */
function daysOf(list: string): number[] {
  const re = /(thứ\s*|t)?(2|3|4|5|6|7|hai|ba|tư|năm|sáu|bảy|bẩy)|chủ\s*nhật|cn/gu;
  const items: number[] = [];
  const seps: string[] = [];
  let last = 0;
  for (const m of list.matchAll(re)) {
    if (items.length) seps.push(list.slice(last, m.index).trim());
    items.push(m[2] ? WEEKDAY[m[2]]! : 0);
    last = m.index + m[0].length;
  }
  // Two days joined by "-" or "đến" are a run of days; any more are a list.
  if (items.length === 2 && /^(?:-|–|đến|tới)$/u.test(seps[0] ?? "")) {
    const run: number[] = [];
    for (let d = items[0]!, k = 0; k < 7; d = (d + 1) % 7, k++) {
      run.push(d);
      if (d === items[1]) break;
    }
    return [...new Set(run)].sort((a, b) => a - b);
  }
  return [...new Set(items)].sort((a, b) => a - b);
}

interface Found {
  repeat?: "day" | "week" | "month" | "year" | "lunarMonth";
  wd?: number;
  nextWeek?: boolean;
  thisWeek?: boolean;
  nextWeekOnly?: boolean;
  rel?: number;
  period?: Period;
  offsetMin?: number;
  lunar?: { day: number; month: number | null };
  date?: { d: number; mo: number | null; y: number | null };
  end?: "tuần" | "tháng";
  startOfMonth?: boolean;
  h?: number;
  mi?: number;
}

/**
 * The first day from `from` on that is lunar day `day` (of `month`, or of
 * any month). Day 30 of a 29-day month is its last day. A leap month has
 * its own rằm, but "rằm tháng Giêng" never falls in one.
 */
function nextLunarDay(from: Ymd, day: number, month: number | null): Ymd | null {
  for (let k = 0; k < 400; k++) {
    const d = addDaysWall(from, k);
    const l = solarToLunar(d.y, d.mo, d.d);
    if (!l) return null;
    if (month !== null && (l.leap || l.month !== month)) continue;
    if (l.day === Math.min(day, lunarMonthLength(l.month, l.year, l.leap))) return d;
  }
  return null;
}

/**
 * Words in quotes are only words: "đọc “Tám giờ tối”" is a book, not a time.
 * Tapping a marked word puts it in quotes (Understood), which is how a wrong
 * reading is undone without losing the words. Any pair of " “ ”, as iPhone's
 * keyboard turns one into the other.
 */
const QUOTED = /["“”]([^"“”\n]{1,80})["“”]/gu;

export function parse(text: string, now: number, offset: number): Parsed {
  const low = text.toLowerCase();
  const taken = new Array<boolean>(low.length).fill(false);
  for (const q of text.matchAll(QUOTED)) taken.fill(true, q.index, q.index + q[0].length);
  const listed = dayList(text, low, taken);
  const spans: Span[] = [];
  /** Where a day is named: times either side of one are not one run ("mai 8h và thứ 2 9h"). */
  const refs: Range[] = [];
  const f: Found = {};
  const days: DayTok[] = [];
  const times: TimeTok[] = [];

  const grab = (src: string, fn: (m: RegExpExecArray, s: number, e: number) => boolean | void) => {
    const re = rx(src);
    let m: RegExpExecArray | null;
    while ((m = re.exec(low))) {
      const s = m.index;
      const e = s + m[0].length;
      if (e === s) {
        re.lastIndex++;
        continue;
      }
      if (taken.slice(s, e).some(Boolean)) continue;
      if (fn(m, s, e) === false) continue;
      taken.fill(true, s, e);
      spans.push({ s, e, kind: "time" });
    }
  };
  const dayGrab = (src: string, fn: (m: RegExpExecArray, s: number, e: number) => boolean | void) =>
    grab(src, (m, s, e) => {
      const r = fn(m, s, e);
      if (r !== false) refs.push({ s, e });
      return r;
    });

  // Longest phrases first, so "mỗi sáng" is not read as "sáng".
  dayGrab(`(mỗi\\s*|hằng\\s*|hàng\\s*)?(?:các\\s*)?ngày\\s*(?:trong\\s*tuần|thường)`, (m, s, e) => {
    days.push({ s, e, wds: [1, 2, 3, 4, 5], rep: true, nextWeek: false, thisWeek: false });
  });
  dayGrab(`(?:mỗi|hằng|hàng)\\s*cuối\\s*tuần|cuối\\s*tuần\\s*(?:hằng|hàng|mỗi)\\s*tuần`, (m, s, e) => {
    days.push({ s, e, wds: [0, 6], rep: true, nextWeek: false, thisWeek: false });
  });
  dayGrab(DAYSET, (m, s, e) => {
    const wds = daysOf(m[2]!);
    if (!wds.length) return false;
    const thisWeek = !!m[3] && /này/u.test(m[3]);
    days.push({ s, e, wds, rep: !!m[1] || !!m[4], nextWeek: !!m[3] && !thisWeek, thisWeek, week: m[3] });
  });
  dayGrab(`(?:mỗi|hằng|hàng)\\s*(rằm|(?:mùng|mồng)\\s*(\\d{1,2}))|(rằm|(?:mùng|mồng)\\s*(\\d{1,2}))\\s*(?:hằng|hàng|mỗi)\\s*tháng`, (m) => {
    if (f.repeat) return false;
    const word = m[1] ?? m[3] ?? "";
    const day = word.startsWith("rằm") ? 15 : parseInt(m[2] ?? m[4] ?? "", 10);
    if (!(day >= 1 && day <= 30)) return false;
    f.repeat = "lunarMonth";
    f.lunar = { day, month: null };
  });
  grab(`(?:mỗi|hằng|hàng)\\s*(ngày|${PERIOD}|tuần|tháng|năm)`, (m) => {
    if (f.repeat) return false;
    const u = m[1]!;
    if (u === "tuần") f.repeat = "week";
    else if (u === "tháng") f.repeat = "month";
    else if (u === "năm") f.repeat = "year";
    else {
      f.repeat = "day";
      if (u !== "ngày") f.period = u as Period;
    }
  });
  // Hours and minutes together too: "1 tiếng 30 phút nữa", "1h30 nữa".
  grab(`(\\d+|một|hai|ba|nửa)\\s*(phút|p|tiếng|giờ|h|ngày|hôm|tuần)(?:\\s*(rưỡi)|\\s*(\\d{1,2})\\s*(?:phút|p)?)?\\s*(?:nữa|sau)`, (m, s) => {
    // "thứ 6 tuần sau" is a Friday, not six weeks.
    if (/thứ\s*$/u.test(low.slice(0, s))) return false;
    if (f.offsetMin !== undefined) return false;
    const n = NUMBER_WORDS[m[1]!] ?? parseInt(m[1]!, 10);
    const unit = { phút: 1, p: 1, tiếng: 60, giờ: 60, h: 60, ngày: 1440, hôm: 1440, tuần: 10080 }[m[2] as "phút"];
    const extra = m[4] ? +m[4] : 0;
    if (m[4] && (unit !== 60 || extra > 59)) return false;
    f.offsetMin = (n + (m[3] ? 0.5 : 0)) * unit + extra;
  });
  // As said rather than typed: "ngày 12 tháng 5 âm lịch", "10 tháng 3 âm".
  dayGrab(`(?:ngày\\s*)?(\\d{1,2})\\s*tháng\\s*(${LMON})\\s*(?:âm\\s*lịch|âm|âl|al)`, (m) => {
    const day = +m[1]!;
    const month = lunarMonth(m[2]!);
    if (day < 1 || day > 30 || month < 1 || month > 12 || f.lunar) return false;
    f.lunar = { day, month };
  });
  dayGrab(`(\\d{1,2})\\s*[/\\-]\\s*(\\d{1,2})\\s*(?:âm\\s*lịch|âm|âl|al)`, (m) => {
    const day = +m[1]!;
    const month = +m[2]!;
    if (day < 1 || day > 30 || month < 1 || month > 12 || f.lunar) return false;
    f.lunar = { day, month };
  });
  // "tháng sau" after a lunar day changes nothing (the next one is next month's) but is part of it.
  dayGrab(`rằm(?:\\s*tháng\\s*(${LMON})|\\s*tháng\\s*(?:sau|tới))?|(?:mùng|mồng)\\s*(\\d{1,2})(?:\\s*(tết)|\\s*tháng\\s*(${LMON})|\\s*tháng\\s*(?:sau|tới))?`, (m) => {
    if (f.lunar) return false;
    if (m[0].startsWith("rằm")) {
      f.lunar = { day: 15, month: m[1] ? lunarMonth(m[1]) : null };
      return;
    }
    const day = +m[2]!;
    if (day < 1 || day > 10) return false;
    f.lunar = { day, month: m[3] ? 1 : m[4] ? lunarMonth(m[4]) : null };
  });
  // A range before single times and dates: "từ 20h đến 20h30", "20h30-22h", "8-10h".
  grab(`(?:từ\\s*)?(${TIME}|\\d{1,2})\\s*(?:-|–|—|đến|tới)\\s*(${TIME})`, (m, s, e) => {
    const a = clockOf(m[1]!);
    const b = clockOf(m[2]!);
    if (!a || !b) return false;
    times.push({ s, e, ...a, end: b });
  });
  dayGrab(`(?:ngày\\s*)?(\\d{1,2})\\s*[/\\-]\\s*(\\d{1,2})(?:\\s*[/\\-]\\s*(\\d{4}|\\d{2}))?`, (m) => {
    const d = +m[1]!;
    const mo = +m[2]!;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || f.date) return false;
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    if (d > daysInMonth(y ?? 2024, mo)) return false;
    f.date = { d, mo, y };
  });
  // Not "ngày 2 lần", "ngày 3 bữa": how often, not which day.
  dayGrab(`ngày\\s*(\\d{1,2})(?:\\s*tháng\\s*(\\d{1,2}))?(?!\\s*(?:lần|bữa|lượt|viên|cữ))`, (m) => {
    const d = +m[1]!;
    const mo = m[2] ? +m[2] : null;
    if (d < 1 || d > 31 || (mo !== null && (mo < 1 || mo > 12)) || f.date) return false;
    f.date = { d, mo, y: null };
  });
  dayGrab(`(${PERIOD})\\s*(nay|mai|mốt)`, (m) => {
    if (f.rel !== undefined) return false;
    f.period = m[1] as Period;
    f.rel = { nay: 0, mai: 1, mốt: 2 }[m[2] as "nay"];
  });
  dayGrab("hôm\\s*nay|ngày\\s*mai|ngày\\s*(?:mốt|kia|kìa)|mốt|mai", (m, s) => {
    if (f.rel !== undefined) return false;
    const w = m[0].replace(/\s+/g, " ");
    if (w === "mai" && NAME_BEFORE.test(low.slice(0, s))) return false;
    f.rel = w === "hôm nay" ? 0 : w === "mai" || w === "ngày mai" ? 1 : 2;
  });
  dayGrab("tuần\\s*(?:sau|tới)", () => {
    f.nextWeekOnly = true;
  });
  dayGrab("cuối\\s*(tuần|tháng)(?:\\s*này)?", (m) => {
    f.end = m[1] as "tuần";
  });
  dayGrab("đầu\\s*tháng(?:\\s*(?:sau|tới))?", () => {
    f.startOfMonth = true;
  });
  grab("(\\d{1,2})\\s*(?:h|g|giờ)\\s*kém\\s*(\\d{1,2})(?:\\s*(?:phút|p))?", (m, s, e) => {
    const h = +m[1]!;
    const k = +m[2]!;
    if (h < 1 || h > 24 || k < 1 || k > 30) return false;
    times.push({ s, e, h: h - 1, mi: 60 - k });
  });
  grab("(\\d{1,2}):(\\d{2})", (m, s, e) => {
    const h = +m[1]!;
    const mi = +m[2]!;
    if (h > 23 || mi > 59) return false;
    times.push({ s, e, h, mi });
  });
  // Minutes are not the day of a date after it: in "9h 22/10" the 22 is the 22nd, and taking it
  // as 9:22 left the hour unread too (the reminder fell back to 8:00).
  grab("(\\d{1,2})\\s*(?:h|g|giờ)(?:\\s*(\\d{1,2})(?!\\d|\\s*[/\\-]\\s*\\d)(?:\\s*(?:phút|p))?|\\s*(rưỡi))?", (m, s, e) => {
    const h = +m[1]!;
    const mi = m[2] ? +m[2] : m[3] ? 30 : 0;
    if (h > 24 || mi > 59) return false;
    times.push({ s, e, h, mi });
  });
  // "sáng", "chiều"… count only beside another word about time: "sáng tạo" is not the morning.
  // Beside a time or a day, they go with that one: "tối thứ 2 8h, sáng thứ 7 9h".
  // A period the line said for itself ("tối mai", "mỗi sáng"), apart from one a time has ("9h tối").
  const spoken = f.period;
  let loose: Period | undefined;
  const periods: { s: number; e: number; p: Period }[] = [];
  grab(`(${PERIOD})`, (m, s) => {
    periods.push({ s, e: s + m[0].length, p: m[1] as Period });
    return false;
  });
  const near = (c: { s: number; e: number }, t: { s: number; e: number }) => (t.s >= c.e && t.s - c.e <= 2) || (c.s >= t.e && c.s - t.e <= 2);
  for (const c of periods) {
    if (!spans.some((sp) => near(c, sp))) continue;
    f.period ??= c.p;
    for (const t of days) if (near(c, t)) t.period ??= c.p;
    if (!times.some((t) => near(c, t))) loose ??= c.p;
    for (const t of times) {
      if (!near(c, t) || t.period) continue;
      Object.assign(t, { period: c.p, ps: c.s, pe: c.e });
    }
    taken.fill(true, c.s, c.e);
    spans.push({ s: c.s, e: c.e, kind: "time" });
  }
  // "mùng 1 và rằm": both days and what joins them are read, though the first only is scheduled here.
  if (listed) {
    for (let i = listed.s; i < listed.e; ) {
      if (taken[i] || /\s/u.test(low[i]!)) {
        i++;
        continue;
      }
      let j = i;
      while (j < listed.e && !taken[j]) j++;
      const e = low.slice(i, j).trimEnd().length + i;
      taken.fill(true, i, e);
      spans.push({ s: i, e, kind: "time" });
      i = j;
    }
  }
  times.sort((a, b) => a.s - b.s);
  days.sort((a, b) => a.s - b.s);
  // Nothing but what joins two time words between a and b ("9h, 18h", "9h và 18h"); words
  // already read as time count as joins too ("9h sáng và 6h chiều").
  const joined = (a: number, b: number) => {
    if (refs.some((r) => r.s >= a && r.e <= b)) return false;
    let gap = "";
    for (let i = a; i < b; i++) gap += taken[i] ? " " : low[i];
    return b >= a && JOINS.test(gap);
  };

  let nag = false;
  // At the end, or before tags that end the line: "uống thuốc 21h! #sức-khoẻ" asks
  // just as loudly, and left unread its "!" stayed in the title.
  const bang = /\s*!+(?=(?:\s*#[\p{L}\p{N}_-]{1,30})*\s*$)/u.exec(text);
  if (bang) {
    nag = true;
    spans.push({ s: bang.index, e: bang.index + bang[0].length, kind: "nag" });
  }
  const tags: string[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_])#([\p{L}\p{N}_-]{1,30})/gu)) {
    if (taken[m.index]) continue;
    const tag = m[1]!.toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
    spans.push({ s: m.index, e: m.index + m[0].length, kind: "tag" });
  }
  spans.sort((a, b) => a.s - b.s || a.e - b.e);

  // The title is the first line, without the time words and tags: several
  // lines are a note with details ("thứ 2 học từ 20h…" under its heading).
  const firstEnd = text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length;
  let rest = "";
  let pos = 0;
  let afterTime = false;
  for (const sp of spans) {
    if (sp.s >= firstEnd) break;
    // What only joined two times ("9h và 18h") goes with them: it read "Và uống thuốc".
    if (sp.s > pos && !(afterTime && sp.kind === "time" && joined(pos, sp.s))) rest += text.slice(pos, sp.s);
    rest += " ";
    pos = Math.max(pos, sp.e);
    afterTime = sp.kind === "time";
  }
  if (pos < firstEnd) rest += text.slice(pos, firstEnd);
  rest = rest
    .replace(/\s+/g, " ")
    .replace(/\s+([,.:;])/g, "$1")
    // What joined the time words is left dangling once they are out: ", ,", "và ,".
    .replace(/(?:[,;&]\s*|(?<![\p{L}\p{N}])và\s+)+(?=[,;&]|$)/gu, "")
    .trim()
    // Asking to be reminded, and the words that lead into a time: said aloud far more than typed.
    .replace(/^(?:(?:nhớ|hãy|làm\s+ơn)\s+)?(?:nhắc\s+(?:tôi|mình|em|anh|chị|con)|nhắc)\s+/iu, "")
    .replace(/^(?:vào\s+khoảng|khoảng|tầm|đúng|lúc|vào\s+lúc|vào)\s+/iu, "")
    .replace(/(?:\s+(?:(?:nhớ\s+)?nhắc\s+(?:tôi|mình|em|anh|chị|con)|vào\s+khoảng|khoảng|tầm|đúng|lúc|vào|vào\s+lúc|nhé|nha|từ))+$/iu, "")
    .replace(/\s*[.…?]+$/u, "")
    // The quotes that kept words from being read are not part of the title.
    .replace(/["“”]/gu, "")
    .replace(/^[\s,.:;&–-]+|[\s,:;&–-]+$/g, "")
    .trim();

  let items: Item[] | null = null;
  let title = rest;
  // A list's things split at commas and at a last "và": "trứng, sữa và rau".
  const things = (s: string) =>
    s
      .split(/\s*,\s*|\s+và\s+/u)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 50);
  const list = /^([^:]{1,40}):\s*(.+,.+)$/u.exec(rest);
  if (list) {
    const parts = things(list[2]!);
    if (parts.length >= 2) {
      title = list[1]!.trim();
      items = parts.map((t) => ({ t, done: false }));
    }
  }
  // Said rather than typed, a list has no colon: "đi chợ mua cá, đường, muối, bột ngọt".
  // A word for buying or bringing, then three things or more: two ("mua quà cho mẹ và bố")
  // is as often one thing as two.
  if (!items) {
    const said = /^(.{0,40}?(?<![\p{L}\p{N}])(?:cần mua|nhớ mua|mua|gồm có|gồm|lấy|mang theo|mang|đem theo|đem|chuẩn bị|sắm))\s+(.+)$/iu.exec(rest);
    const parts = said ? things(said[2]!) : [];
    if (said && parts.length >= 3) {
      title = said[1]!.trim();
      items = parts.map((t) => ({ t, done: false }));
    }
  }
  if (!title) title = text.slice(0, firstEnd).replace(/\s*!+\s*$/, "").trim() || text.trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const out: Parsed = { title, items, tags, due: null, rule: null, nag, past: false, spans, split: null };
  // Days of one week ("thứ 4, thứ 6 tuần sau", "thứ 3 và thứ 5 này"): once each, not every week.
  const d0 = days[0];
  const eachDay = days.length === 1 && !!d0 && d0.wds.length > 1 && !d0.rep && !f.repeat && (d0.nextWeek || d0.thisWeek);
  const week = eachDay ? null : (weeklyRule(days, times, f, low, joined) ?? dailyRule(days, times, f, joined));
  if (week) Object.assign(out, { due: nextOccurrence(week, now, offset), rule: week });
  else {
    // One day and one time, as before: the first of each.
    const d = days[0];
    if (d) {
      f.wd = d.wds[0];
      f.nextWeek = d.nextWeek;
      f.thisWeek = d.thisWeek;
      if (d.rep) f.repeat ??= "week";
      f.period ??= d.period;
    }
    // The period the line gives its times, unless a time has its own ("tối mai 8h và 10h").
    const linePeriod = spoken ?? d?.period ?? loose;
    const t = times[0];
    if (t) {
      f.h = t.h;
      f.mi = t.mi;
      if (t.period) f.period = t.period;
    }
    Object.assign(out, schedule(f, text, now, offset));
    if (eachDay) out.split = d0.wds.map((w) => oneLine(`${text.slice(0, d0.s)}${DAY_WORD[w]}${d0.week ?? ""}${text.slice(d0.e)}`));
    else if (out.rule === null && out.due !== null) out.split = segments(text, low, spans, refs, times);
    if (!out.split && out.rule === null && out.due !== null && f.offsetMin === undefined) {
      // A day named ("mai", "thứ 2", "20/10"): every time on the one day the first falls on.
      const named = f.rel !== undefined || f.wd !== undefined || !!f.date || !!f.lunar || !!f.nextWeekOnly || !!f.end || !!f.startOfMonth;
      out.split = splitTimes(text, times, linePeriod, joined, named ? { now, offset } : null);
    }
  }
  if (listed) out.split = listed.lines;
  return out;
}

const oneLine = (s: string) => s.replace(/[ \t]{2,}/g, " ").trim();
const DAY_WORD = ["chủ nhật", "thứ 2", "thứ 3", "thứ 4", "thứ 5", "thứ 6", "thứ 7"];
const LDAY = "rằm|(?:mùng|mồng)\\s*\\d{1,2}";
const AND = "\\s*(?:,|và|&)\\s*";

/**
 * Days of the month named together ("mùng 1 và rằm", "rằm, mùng 1", "ngày
 * 1 và 15"): the line once per day, each saying only its own. A reminder
 * holds one day of the month; before, the second was read as words, or lost.
 */
function dayList(text: string, low: string, quoted: boolean[]): { s: number; e: number; lines: string[] } | null {
  const lunar = rx(`(?:${LDAY})(?:${AND}(?:${LDAY}|\\d{1,2}))+`);
  const solar = rx(`ngày\\s*\\d{1,2}(?:${AND}\\d{1,2})+(?!\\s*(?:lần|bữa|lượt|viên|cữ|[/\\-]))`);
  for (const [re, word] of [
    [lunar, (t: string) => (t === "rằm" || +t === 15 ? "rằm" : /^\d+$/u.test(t) ? `mùng ${t}` : t)],
    [solar, (t: string) => `ngày ${t.replace(/^ngày\s*/u, "")}`],
  ] as const) {
    for (const m of low.matchAll(re)) {
      const s = m.index;
      const e = s + m[0].length;
      if (quoted.slice(s, e).some(Boolean)) continue;
      const items = [...new Set(m[0].split(/\s*(?:,|và|&)\s*/u).map((t) => word(t.replace(/\s+/gu, " ").trim())))];
      if (items.length < 2) continue;
      return { s, e, lines: items.map((t) => oneLine(`${text.slice(0, s)}${t}${text.slice(e)}`)) };
    }
  }
  return null;
}

/**
 * "mai 8h và thứ 2 9h họp": each day with its own time, the parts joined by
 * "và" or a comma, as one line per part with the rest of the words. Null
 * unless every part names both a day and a time.
 */
function segments(text: string, low: string, spans: Span[], refs: Range[], times: TimeTok[]): string[] | null {
  const parts: Range[] = [];
  for (const sp of spans.filter((x) => x.kind === "time").sort((a, b) => a.s - b.s)) {
    const last = parts.at(-1);
    if (last && /^\s*$/u.test(low.slice(last.e, sp.s))) last.e = Math.max(last.e, sp.e);
    else parts.push({ s: sp.s, e: sp.e });
  }
  if (parts.length < 2) return null;
  for (let i = 1; i < parts.length; i++) {
    const gap = low.slice(parts[i - 1]!.e, parts[i]!.s);
    if (!JOINS.test(gap) || !/[,;&]|và/u.test(gap)) return null;
  }
  const inside = (p: Range, r: Range) => r.s >= p.s && r.e <= p.e;
  if (!parts.every((p) => refs.some((r) => inside(p, r)) && times.some((t) => inside(p, t)))) return null;
  const head = text.slice(0, parts[0]!.s);
  const tail = text.slice(parts.at(-1)!.e);
  return parts.map((p) => oneLine(`${head}${text.slice(p.s, p.e)}${tail}`));
}

/**
 * "mai 9h và 15h họp" as "mai 9h họp" and "mai 15h họp": the times written
 * together, each in place of all of them, said so that it reads alone as it
 * did among the others ("mai 8h và 9h tối": 20h and 21h; a period word
 * goes with its time). Null for fewer than two. Hải, 14/10/2026.
 */
function splitTimes(
  text: string,
  times: TimeTok[],
  linePeriod: Period | undefined,
  joined: (a: number, b: number) => boolean,
  sameDay: { now: number; offset: number } | null,
): string[] | null {
  const run = times.slice(0, 1);
  for (const t of times.slice(1)) {
    if (!joined(run.at(-1)!.e, t.s)) break;
    run.push(t);
  }
  if (run.length < 2) return null;
  const start = Math.min(...run.map((t) => Math.min(t.s, t.ps ?? t.s)));
  const end = Math.max(...run.map((t) => Math.max(t.e, t.pe ?? t.e)));
  const said = (h: number, mi: number) => `${h}h${mi ? String(mi).padStart(2, "0") : ""}`;
  const minute = (t: TimeTok, p: Period | undefined) => hour(t.h, p) * 60 + t.mi;
  // A time with no period word takes its neighbour's when the times still run in order with it:
  // "8h và 9h tối" is the evening twice; "9h và 3h chiều" is a morning and an afternoon.
  const periodOf = (t: TimeTok, i: number): Period | undefined => {
    if (t.period) return t.period;
    const prev = run[i - 1];
    const next = run[i + 1];
    if (prev?.period && minute(t, prev.period) > minute(prev, prev.period)) return prev.period;
    if (next?.period && minute(t, next.period) < minute(next, next.period)) return next.period;
    // 1–5 o'clock is the afternoon by default ("3h đón con"), unless the next time comes earlier
    // than that and later than the small hours: "4h và 6h dậy" is before dawn.
    if (!linePeriod && next && t.h >= 1 && t.h <= 5) {
      const n = minute(next, periodOf(next, i + 1));
      if (n < minute(t, undefined) && n > t.h * 60 + t.mi) return "sáng";
    }
    return linePeriod;
  };
  const clocks = run.map((t, i) => {
    const p = periodOf(t, i);
    const h = hour(t.h, p);
    // Past midnight of the night named ("1h đêm"): said as it was, "25h" would read as nothing.
    let clock = h > 24 ? `${said(h - 24, t.mi)} đêm` : said(h, t.mi);
    if (t.end) {
      let eh = hour(t.end.h, p);
      if (eh * 60 + t.end.mi <= h * 60 + t.mi && t.end.h < 12) eh += 12;
      clock += `-${said(eh % 24, t.end.mi)}`;
    }
    // 1–5 o'clock alone reads as the afternoon (hour()): the small hours say so.
    if (h >= 1 && h <= 5) clock += " sáng";
    return clock;
  });
  const line = (clock: string) => `${text.slice(0, start)}${clock}${text.slice(end)}`.replace(/[ \t]{2,}/g, " ").trim();
  const lines = clocks.map(line);
  if (!sameDay) return lines;
  // Read alone, "thứ 2 9h" typed on a Monday at ten is next Monday and "thứ 2 18h" today: a time
  // that lands on another day than the first says the first's date ("thứ 2 18h 19/10"). Where
  // even that reads otherwise (a lunar day wins over a date), the line stays one reminder.
  const { now, offset } = sameDay;
  const dayOf = (l: string) => {
    const due = parse(l, now, offset).due;
    return due === null ? null : startOfDay(due, offset);
  };
  const first = dayOf(lines[0]!);
  if (first === null) return null;
  const w = toWall(first, offset);
  const date = ` ${w.d}/${w.mo}${w.y !== toWall(now, offset).y ? `/${w.y}` : ""}`;
  for (let i = 1; i < lines.length; i++) {
    if (dayOf(lines[i]!) === first) continue;
    lines[i] = line(clocks[i] + date);
    if (dayOf(lines[i]!) !== first) return null;
  }
  return lines;
}

/**
 * The reminders a line makes when it is a one-off with several times
 * (Parsed.split): each line read on its own; null when it is one reminder.
 * Each must read alone as one reminder at one time, or the line stays one.
 */
export function partsOf(p: Parsed, now: number, offset: number): { text: string; parsed: Parsed }[] | null {
  if (!p.split) return null;
  const parts = p.split.map((text) => ({ text, parsed: parse(text, now, offset) }));
  // Each one reminder, repeating if the line does ("mùng 1 và rằm hằng tháng") and once if not.
  return parts.every((x) => x.parsed.due !== null && x.parsed.split === null && (x.parsed.rule === null) === (p.rule === null)) ? parts : null;
}

/** A clock time as said, made a real one: "8h tối" is 20:00, "3h" alone is 15:00. */
function hour(h: number, p: Period | undefined): number {
  // "12h tối", "12h đêm", "12h khuya": the midnight that ends the day, not noon.
  if (p === "tối" && h === 12) return 24;
  if ((p === "chiều" || p === "tối") && h < 12) return h + 12;
  if (p === "trưa" && h < 6) return h + 12;
  if ((p === "đêm" || p === "khuya") && h >= 6 && h <= 12) return h === 12 ? 24 : h + 12;
  // The small hours of a night come after its midnight: "2h đêm nay", "1h khuya" are the next day's.
  if ((p === "đêm" || p === "khuya") && h <= 5) return h + 24;
  // "3h đón con" is three in the afternoon; nobody sets one for 3 a.m. without saying so.
  if (!p && h >= 1 && h <= 5) return h + 12;
  return h;
}

/** What may stand between two time words that go together: commas, "và", and space. */
const JOINS = /^[\s,;&/+]*(?:và[\s,;&/+]*)?$/u;

/** A day group (or every day) and one of its times, as written; `g`: which group it came from. */
interface Pair {
  wds: number[];
  t: TimeTok | null;
  period?: Period;
  g: number;
}

/**
 * Several days of the week, each group at its time, read as one weekly
 * rule; null when the line is about one day (handled as before). Days and
 * times pair up in the order they are written: "thứ 2 20h-20h30, thứ 4 và 7
 * 20h30-22h". A set named on its own first and times given later for some
 * of its days leaves the last time to the rest of them, which is how people
 * write it out: "mỗi thứ 2,4,7 học tiếng anh / thứ 2 từ 20h đến 20h30 /
 * 4,7 từ 20h30 đến 22h".
 *
 * A group may have several times, joined only by commas or "và", after it
 * ("thứ 2,4 9h và 18h") or before it ("9h, 18h thứ 2"): every one of them,
 * where only the first was kept and the rest dropped without a word.
 */
function weeklyRule(days: DayTok[], times: TimeTok[], f: Found, low: string, joined: (a: number, b: number) => boolean): Rule | null {
  if (!days.length) return null;
  const tokens = [...days.map((d) => ({ d })), ...times.map((t) => ({ t }))].sort((a, b) => ("d" in a ? a.d.s : a.t.s) - ("d" in b ? b.d.s : b.t.s));
  const pairs: Pair[] = [];
  const declared = new Set<number>();
  const orphans: TimeTok[] = [];
  let g = 0;
  let pend: DayTok | null = null;
  // Times written before the day group they belong to: "9h, 18h thứ 2".
  let pendTs: TimeTok[] = [];
  // The group the last time went with, while more joined times may follow: "thứ 2,4 9h và 18h".
  let last: { wds: number[]; period?: Period; g: number; e: number } | null = null;
  const onlyJoins = (a: number, b: number) => /^[\s,;&/]*(?:và)?[\s,;&/]*$/u.test(low.slice(a, b));
  // A day group with a time of its own right after it.
  const timed = (i: number) => {
    const d = tokens[i];
    const n = tokens[i + 1];
    return !!d && "d" in d && !!n && "t" in n && joined(d.d.e, n.t.s);
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if ("d" in tok) {
      const d = tok.d;
      const cur = pend as DayTok | null;
      if (cur && onlyJoins(cur.e, d.s)) pend = { ...cur, e: d.e, wds: [...new Set([...cur.wds, ...d.wds])], rep: cur.rep || d.rep };
      else {
        if (pend) for (const w of pend.wds) declared.add(w);
        pend = d;
      }
      last = null;
      if (pendTs.length) {
        g++;
        for (const t of pendTs) pairs.push({ wds: pend.wds, t, period: pend.period, g });
        last = { wds: pend.wds, period: pend.period, g, e: pend.e };
        pend = null;
        pendTs = [];
      }
      continue;
    }
    const t = tok.t;
    const next = tokens[i + 1];
    // "thứ 2 9h, 18h thứ 4": a time right before a day group that has no time of its own is that group's.
    const leadsNext = !!next && "d" in next && joined(t.e, next.d.s) && !timed(i + 1);
    if (pend) {
      g++;
      pairs.push({ wds: pend.wds, t, period: pend.period, g });
      last = { wds: pend.wds, period: pend.period, g, e: t.e };
      pend = null;
    } else if (last && joined(last.e, t.s) && !leadsNext) {
      pairs.push({ wds: last.wds, t, period: last.period, g: last.g });
      last.e = t.e;
    } else if (!pendTs.length || joined(pendTs.at(-1)!.e, t.s)) {
      pendTs.push(t);
      last = null;
    } else orphans.push(t);
  }
  if (pend) for (const w of pend.wds) declared.add(w);
  const paired = new Set(pairs.flatMap((p) => p.wds));
  const left = [...declared].filter((w) => !paired.has(w));
  // The rest of a set named first: the times written last, together, or the first stray one.
  const tail = pendTs.length ? pendTs : orphans.slice(0, 1);
  if (left.length && tail.length) {
    g++;
    for (const t of tail) pairs.push({ wds: left, t, g });
  } else if (left.length && !pairs.length) pairs.push({ wds: left, t: times[0] ?? null, g: ++g });

  const groups = new Set(pairs.map((p) => p.g)).size;
  const multiDays = groups > 1 || pairs.some((p) => p.wds.length > 1);
  const every = days.some((d) => d.rep) || f.repeat === "week" || f.repeat === "day";
  const ranged = pairs.some((p) => p.t?.end);
  // Several times for one day group ("mỗi thứ 2 9h và 18h") repeat only when asked to: "thứ 2 9h
  // và 18h" is one Monday, which a single reminder cannot hold both of (its first time it is, as before).
  const multiTimes = pairs.length > groups;
  // One day at one time stays as before ("thứ 6 nộp báo cáo", "mỗi thứ 2 8h"), unless it has a length to keep.
  if (!multiDays && !(every && (ranged || multiTimes))) return null;
  return toWeekly(pairs, f);
}

/**
 * Every day at several times ("9h, 18h hằng ngày uống thuốc", "mỗi ngày 9h
 * và 18h"): a week of slots, each every day. Only the times written
 * together; one time a day stays the plain daily rule. Hải, 14/10/2026: the
 * 18h was marked as read, and dropped.
 */
function dailyRule(days: DayTok[], times: TimeTok[], f: Found, joined: (a: number, b: number) => boolean): Rule | null {
  if (f.repeat !== "day" || days.length || times.length < 2) return null;
  const run = [times[0]!];
  for (const t of times.slice(1)) {
    if (!joined(run.at(-1)!.e, t.s)) break;
    run.push(t);
  }
  if (run.length < 2) return null;
  return toWeekly(
    run.map((t) => ({ wds: [0, 1, 2, 3, 4, 5, 6], t, g: 1 })),
    f,
  );
}

/** Pairs as a week of slots: one per time, the days that share it together; at most the seven a rule holds. */
function toWeekly(pairs: Pair[], f: Found): Rule {
  const slots = new Map<string, { wds: number[]; h: number; mi: number; dur?: number }>();
  for (const p of pairs) {
    const period = p.t?.period ?? p.period ?? f.period;
    let h: number;
    let mi = 0;
    let dur: number | undefined;
    if (p.t) {
      h = hour(p.t.h, period);
      mi = p.t.mi;
      if (p.t.end) {
        let eh = hour(p.t.end.h, period);
        // "20h-22h" with no word for the evening: the end follows the start, not 10 a.m.
        if (eh * 60 + p.t.end.mi <= h * 60 + mi && p.t.end.h < 12) eh += 12;
        const len = (eh * 60 + p.t.end.mi - (h * 60 + mi) + 1440) % 1440;
        if (len > 0) dur = len;
      }
    } else h = period ? PERIOD_HOUR[period] : DEFAULT_HOUR;
    // At 24 and past it, the night after: "mỗi thứ 7 12h đêm" is Sunday 0:00, as "thứ 7 12h đêm" is once.
    const wds = h >= 24 ? p.wds.map((w) => (w + 1) % 7) : p.wds;
    h %= 24;
    const key = `${h}:${mi}:${dur ?? ""}`;
    const had = slots.get(key);
    slots.set(key, { wds: [...new Set([...(had?.wds ?? []), ...wds])].sort((a, b) => a - b), h, mi, ...(dur ? { dur } : {}) });
  }
  // recur.ts readRule takes seven slots at most: past that, a note the server would refuse.
  return { kind: "weekly", slots: [...slots.values()].slice(0, 7) };
}

function schedule(f: Found, text: string, now: number, offset: number): Pick<Parsed, "due" | "rule" | "past"> {
  const none = { due: null, rule: null, past: false };
  const today = toWall(now, offset);
  const todayYmd: Ymd = { y: today.y, mo: today.mo, d: today.d };
  // Before LATE_HOUR the night is not over: "mai", "sáng mai" are the morning to come.
  const late = today.h < LATE_HOUR;
  let rel = f.rel !== undefined && f.rel >= 1 && late ? f.rel - 1 : f.rel;
  if (f.offsetMin !== undefined) {
    const days = f.offsetMin / 1440;
    // "3 ngày nữa 9h": the day from the offset, the time from the hour. Without one, from now.
    if (!(Number.isInteger(days) && days >= 1 && (f.h !== undefined || f.period))) {
      return { due: Math.floor((now + f.offsetMin * MINUTE) / MINUTE) * MINUTE, rule: null, past: false };
    }
    rel = days;
  }

  const hasTime = f.h !== undefined;
  const hasDay = rel !== undefined || f.wd !== undefined || !!f.date || !!f.lunar || !!f.nextWeekOnly || !!f.end || !!f.startOfMonth;
  if (!hasTime && !hasDay && !f.period && !f.repeat) return none;

  // The clock time; 24 and past it is the night after the day named ("12h đêm", "2h đêm nay").
  let h = hasTime ? hour(f.h!, f.period) : f.period ? PERIOD_HOUR[f.period] : f.lunar ? LUNAR_HOUR : DEFAULT_HOUR;
  const mi = hasTime ? (f.mi ?? 0) : 0;
  let dayRolls = h >= 24;
  if (dayRolls) h -= 24;
  // "2h đêm" typed at one in the night is this night's, an hour away.
  if (dayRolls && late && !f.rel && f.wd === undefined && !f.date && !f.lunar && f.offsetMin === undefined) dayRolls = false;

  // Repeating: the rule decides, and the first time is the next one it gives.
  let repeat = f.repeat;
  if (!repeat && (f.date || f.lunar) && YEARLY_WORDS.test(text)) repeat = "year";
  if (repeat === "day" && f.wd !== undefined) repeat = "week";
  if (repeat) {
    let rule: Rule | null = null;
    if (repeat === "day") rule = { kind: "day", h, mi };
    else if (repeat === "week") rule = { kind: "week", wd: ((f.wd ?? today.wd) + (dayRolls ? 1 : 0)) % 7, h, mi };
    else if (repeat === "month") rule = { kind: "month", d: f.date?.d ?? today.d, h, mi };
    else if (repeat === "lunarMonth" && f.lunar) rule = { kind: "lunarMonth", ld: f.lunar.day, h, mi };
    else if (repeat === "year") {
      if (f.lunar?.month) rule = { kind: "lunarYear", lm: f.lunar.month, ld: f.lunar.day, h, mi };
      else if (f.date?.mo) rule = { kind: "year", mo: f.date.mo, d: f.date.d, h, mi };
      else if (!f.lunar && !f.date) rule = { kind: "year", mo: today.mo, d: today.d, h, mi };
    } else if (repeat === "lunarMonth") rule = null;
    if (rule) return { due: nextOccurrence(rule, now, offset), rule, past: false };
  }

  // Once: which day.
  let day: Ymd | null = todayYmd;
  let explicit = true;
  if (f.lunar) {
    day = nextLunarDay(todayYmd, f.lunar.day, f.lunar.month);
  } else if (f.date) {
    if (f.date.mo) {
      const y = f.date.y ?? today.y;
      day = { y, mo: f.date.mo, d: f.date.d };
      if (!f.date.y && before(day, todayYmd)) day = { y: y + 1, mo: f.date.mo, d: f.date.d };
    } else {
      day = { y: today.y, mo: today.mo, d: f.date.d };
      if (before(day, todayYmd) || f.date.d > daysInMonth(today.y, today.mo)) {
        const nm = addMonth(today.y, today.mo);
        day = { y: nm.y, mo: nm.mo, d: Math.min(f.date.d, daysInMonth(nm.y, nm.mo)) };
      }
    }
  } else if (f.wd !== undefined) {
    if (f.nextWeek) {
      const monday = addDaysWall(todayYmd, ((8 - today.wd) % 7) || 7);
      day = addDaysWall(monday, (f.wd + 6) % 7);
    } else {
      day = addDaysWall(todayYmd, (f.wd - today.wd + 7) % 7);
    }
  } else if (rel !== undefined) {
    day = addDaysWall(todayYmd, rel);
  } else if (f.nextWeekOnly) {
    day = addDaysWall(todayYmd, ((8 - today.wd) % 7) || 7);
  } else if (f.end === "tuần") {
    day = addDaysWall(todayYmd, (6 - today.wd + 7) % 7);
  } else if (f.end === "tháng") {
    day = { y: today.y, mo: today.mo, d: daysInMonth(today.y, today.mo) };
  } else if (f.startOfMonth) {
    day = { ...addMonth(today.y, today.mo), d: 1 };
  } else {
    explicit = false;
  }
  if (!day) return none;

  let due = fromWall(day.y, day.mo, day.d, h, mi, offset) + (dayRolls ? DAY : 0);
  let past = false;
  if (due <= now) {
    // "8h" typed at ten: tomorrow at eight. "thứ 2 8h" typed on a Monday at ten: next Monday.
    if (!explicit) due += DAY;
    else if (f.wd !== undefined && !f.nextWeek && !f.thisWeek) due += 7 * DAY;
    else if (f.lunar && !f.lunar.month) {
      const next = nextLunarDay(addDaysWall(todayYmd, 1), f.lunar.day, null);
      if (next) due = fromWall(next.y, next.mo, next.d, h, mi, offset);
    } else past = true;
  }
  // Today named with no time ("hôm nay nộp báo cáo", "23/10 họp" on the 23rd, "thứ 6 này" on a
  // Friday) after its 8:00: the next full hour while today lasts, not a past 8:00 that never rings.
  if (past && !hasTime && !f.period) {
    const next = fromWall(today.y, today.mo, today.d, today.h + 1, 0, offset);
    if (startOfDay(due, offset) === startOfDay(now, offset) && startOfDay(next, offset) === startOfDay(now, offset)) {
      due = next;
      past = false;
    }
  }
  return { due, rule: null, past };
}

const before = (a: Ymd, b: Ymd) => a.y < b.y || (a.y === b.y && (a.mo < b.mo || (a.mo === b.mo && a.d < b.d)));
const addMonth = (y: number, mo: number) => (mo === 12 ? { y: y + 1, mo: 1 } : { y, mo: mo + 1 });
