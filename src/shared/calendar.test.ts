import { describe, expect, it } from "vitest";
import { dayName, holidaysOn, lunarShort, monthGrid, monthName, occurrences, pageBounds, quocKhanhPlus, yearName } from "./calendar";
import { parse } from "./parse";
import type { Note } from "./protocol";
import { fromWall, VN_OFFSET } from "./wall";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => fromWall(y, mo, d, h, mi, VN_OFFSET);

describe("names of years, months and days", () => {
  it("knows the year", () => {
    expect(yearName(2026)).toBe("Bính Ngọ");
    expect(yearName(2027)).toBe("Đinh Mùi");
    expect(yearName(2024)).toBe("Giáp Thìn");
  });

  it("knows the day, counted from the Julian day", () => {
    // Tết Giáp Thìn, 10/2/2024, was a Giáp Thìn day as well.
    expect(dayName(2024, 2, 10)).toBe("Giáp Thìn");
    // Each day moves one along both cycles.
    expect(dayName(2024, 2, 11)).toBe("Ất Tỵ");
  });

  it("names a lunar month", () => {
    expect(monthName(1, 2024)).toBe("Bính Dần");
  });
});

describe("holidays", () => {
  it("24/11 is Ngày Văn hóa Việt Nam, a day off, from 2026 on", () => {
    expect(holidaysOn(2026, 11, 24, null)).toEqual([{ name: "Ngày Văn hóa Việt Nam", off: true }]);
    expect(holidaysOn(2030, 11, 24, null)).toEqual([{ name: "Ngày Văn hóa Việt Nam", off: true }]);
    // Before the law there was no such day.
    expect(holidaysOn(2025, 11, 24, null)).toEqual([]);
  });

  it("Quốc khánh is two days: 2/9 and the day beside it the government named", () => {
    expect(holidaysOn(2026, 9, 1, null)).toEqual([{ name: "Nghỉ lễ Quốc khánh", off: true }]);
    expect(holidaysOn(2026, 9, 3, null)).toEqual([]);
    expect(holidaysOn(2024, 9, 3, null)).toEqual([{ name: "Nghỉ lễ Quốc khánh", off: true }]);
    expect(holidaysOn(2024, 9, 1, null)).toEqual([]);
    // Not announced yet: only 2/9, and the page says the other day is to come.
    expect(quocKhanhPlus(2027)).toBeNull();
    expect(holidaysOn(2027, 9, 1, null)).toEqual([]);
    expect(holidaysOn(2027, 9, 3, null)).toEqual([]);
    expect(holidaysOn(2027, 9, 2, null)).toEqual([{ name: "Quốc khánh", off: true }]);
  });

  it("marks the days off and the days people keep", () => {
    expect(holidaysOn(2026, 9, 2, null)).toEqual([{ name: "Quốc khánh", off: true }]);
    expect(holidaysOn(2026, 10, 20, null)).toEqual([{ name: "Ngày Phụ nữ Việt Nam", off: false }]);
    // Tết Đinh Mùi is 6/2/2027; Giao thừa is the day before, whether month 12 has 29 days or 30.
    const tet = monthGrid(2027, 2).find((c) => c.m === 2 && c.d === 6)!;
    expect(tet.holidays.map((h) => h.name)).toEqual(["Tết Nguyên Đán"]);
    const eve = monthGrid(2027, 2).find((c) => c.m === 2 && c.d === 5)!;
    expect(eve.holidays).toEqual([{ name: "Tất niên, Giao thừa", off: true }]);
    const midAutumn = monthGrid(2026, 9).find((c) => c.m === 9 && c.d === 25)!;
    expect(midAutumn.holidays.map((h) => h.name)).toEqual(["Tết Trung Thu"]);
  });
});

describe("a page of the month", () => {
  it("starts on Monday and holds six weeks", () => {
    const cells = monthGrid(2026, 10);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({ y: 2026, m: 9, d: 28, wd: 1, inMonth: false });
    expect(cells.find((c) => c.inMonth && c.d === 12)).toMatchObject({ wd: 1, lunar: { day: 3, month: 9 } });
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
  });

  it("shows the lunar month where it begins", () => {
    const cells = monthGrid(2026, 10);
    const first = cells.find((c) => c.lunar?.day === 1 && c.inMonth)!;
    expect(lunarShort(first.lunar!)).toBe("1/9");
    expect(lunarShort({ day: 15, month: 9, year: 2026, leap: false })).toBe("15");
  });

  it("puts each note on the days it comes due, repeats included", () => {
    const now = at(2026, 10, 12, 10, 30);
    const make = (id: string, text: string): Note => {
      const p = parse(text, now, VN_OFFSET);
      return { id, text, title: p.title, items: null, tags: [], due: p.due, rule: p.rule, nag: false, done: null, pinned: false, deleted: false, created: now, updated: now, group: null, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [] };
    };
    const cells = monthGrid(2026, 10);
    const { from, to } = pageBounds(cells, VN_OFFSET);
    const occ = occurrences([make("a".repeat(16), "mai 8h gọi mẹ"), make("b".repeat(16), "học tiếng Anh thứ 2 20h-20h30, thứ 4 và 7 20h30-22h")], from, to, VN_OFFSET);
    expect(occ.filter((o) => o.note.title === "Gọi mẹ")).toHaveLength(1);
    // From Monday 12/10 to Sunday 8/11: T2 ×4, T4 ×4, T7 ×4.
    expect(occ.filter((o) => o.note.title === "Học tiếng Anh")).toHaveLength(12);
    // Twice a day since September: both times on every day of the page, to its last.
    const twice = { ...make("c".repeat(16), "9h, 18h hằng ngày uống thuốc"), due: at(2026, 9, 1, 9) };
    const days = Math.round((to - from) / 86_400_000);
    expect(occurrences([twice], from, to, VN_OFFSET)).toHaveLength(2 * days);
    expect(occurrences([twice], from, to, VN_OFFSET).at(-1)!.at).toBe(to - 6 * 3_600_000);
  });
});
