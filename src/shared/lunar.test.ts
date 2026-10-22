import { describe, expect, it } from "vitest";
import { civilFromDays, daysFromCivil, lunarMonthLength, lunarToSolar, solarToLunar } from "./lunar";

// Tết as Hồ Ngọc Đức's calendar gives it; this app used a port of it before
// the table. Day by day from 1900 to 2199 the two differ in eight months
// only, each starting on a new moon within three minutes of midnight.
const TET: Record<number, string> = {
  2020: "2020-01-25",
  2021: "2021-02-12",
  2022: "2022-02-01",
  2023: "2023-01-22",
  2024: "2024-02-10",
  2025: "2025-01-29",
  2026: "2026-02-17",
  2027: "2027-02-06",
  2028: "2028-01-26",
  2029: "2029-02-13",
  2030: "2030-02-02",
  2031: "2031-01-23",
  2032: "2032-02-11",
  2033: "2033-01-31",
  2034: "2034-02-19",
  2035: "2035-02-08",
};

const iso = (c: { y: number; m: number; d: number } | null) => (c ? `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}` : null);

describe("lunar calendar", () => {
  it("puts Tết where the Vietnamese calendar does", () => {
    for (const [y, day] of Object.entries(TET)) expect(iso(lunarToSolar(1, 1, Number(y)))).toBe(day);
  });

  it("is computed at UTC+7, not as the Chinese calendar (UTC+8)", () => {
    // Each of these is a day earlier, or a month, than Chinese New Year.
    expect(iso(lunarToSolar(1, 1, 1985))).toBe("1985-01-21");
    expect(iso(lunarToSolar(1, 1, 2007))).toBe("2007-02-17");
    expect(iso(lunarToSolar(1, 1, 2027))).toBe("2027-02-06");
    expect(iso(lunarToSolar(1, 1, 2030))).toBe("2030-02-02");
    // Rằm tháng Giêng 2027 follows Tết, not the Chinese date.
    expect(iso(lunarToSolar(15, 1, 2027))).toBe("2027-02-20");
  });

  it("knows the leap months", () => {
    expect(lunarMonthLength(6, 2025, true)).toBeGreaterThan(0);
    expect(lunarMonthLength(6, 2026, true)).toBe(0);
    expect(solarToLunar(2025, 7, 30)).toEqual({ day: 6, month: 6, year: 2025, leap: true });
    expect(solarToLunar(2025, 8, 23)).toEqual({ day: 1, month: 7, year: 2025, leap: false });
  });

  it("reads the days this app was written on", () => {
    expect(solarToLunar(2026, 10, 12)).toEqual({ day: 3, month: 9, year: 2026, leap: false });
    expect(iso(lunarToSolar(15, 9, 2026))).toBe("2026-10-24");
    expect(iso(lunarToSolar(15, 8, 2026))).toBe("2026-09-25");
  });

  it("puts months 11 and 12 in the lunar year before the solar one", () => {
    expect(solarToLunar(2027, 1, 20)).toMatchObject({ month: 12, year: 2026 });
  });

  it("goes there and back for every day of the table", () => {
    const wrong: string[] = [];
    for (let z = daysFromCivil(1900, 1, 31); z <= daysFromCivil(2200, 2, 14); z++) {
      const c = civilFromDays(z);
      const l = solarToLunar(c.y, c.m, c.d);
      if (!l || iso(lunarToSolar(l.day, l.month, l.year, l.leap)) !== iso(c)) wrong.push(iso(c)!);
    }
    expect(wrong).toEqual([]);
  });

  it("covers the lunar years 1900 to 2199", () => {
    expect(solarToLunar(1900, 1, 30)).toBeNull();
    expect(solarToLunar(1900, 1, 31)).toEqual({ day: 1, month: 1, year: 1900, leap: false });
    expect(solarToLunar(2200, 2, 14)).toEqual({ day: 30, month: 12, year: 2199, leap: false });
    expect(solarToLunar(2200, 2, 15)).toBeNull();
    expect(lunarToSolar(1, 1, 1899)).toBeNull();
    expect(lunarToSolar(1, 1, 2200)).toBeNull();
  });

  it("times a new moon or a solar term near midnight with JPL Horizons", () => {
    // New moon 1944-06-20 23:59:33 at UTC+7: Hồ Ngọc Đức's formulas and
    // astronomy-engine both put it after midnight.
    expect(solarToLunar(1944, 6, 20)).toEqual({ day: 1, month: 5, year: 1944, leap: false });
    // Autumn equinox 1938-09-23 23:59:30: it falls in the month from 25/8,
    // so the leap month is the next one, 8 (astronomy-engine alone: 7).
    expect(solarToLunar(1938, 9, 23)).toEqual({ day: 30, month: 8, year: 1938, leap: false });
    expect(solarToLunar(1938, 9, 24)).toEqual({ day: 1, month: 8, year: 1938, leap: true });
  });

  it("puts a leap month after month 11 when the rule says so", () => {
    // 2033: the month after month 11 has no trung khí; Tết 2034 comes a month later.
    expect(lunarMonthLength(11, 2033, true)).toBeGreaterThan(0);
    expect(iso(lunarToSolar(1, 1, 2034))).toBe("2034-02-19");
  });

  it("says no to days and years that do not exist", () => {
    const short = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((m) => lunarMonthLength(m, 2026) === 29)!;
    expect(lunarToSolar(30, short, 2026)).toBeNull();
    expect(lunarToSolar(1, 13, 2026)).toBeNull();
    expect(solarToLunar(1500, 1, 1)).toBeNull();
  });
});
