import { describe, expect, it } from "vitest";
import { lunarLabel, ruleLabel, whenLabel } from "./describe";
import { durationAt } from "./recur";
import { solarToLunar } from "./lunar";
import { latestOccurrence, nextOccurrence, readRule, type Rule } from "./recur";
import { DAY, fromWall, HOUR, MINUTE, toWall, VN_OFFSET } from "./wall";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => fromWall(y, mo, d, h, mi, VN_OFFSET);
const show = (t: number) => {
  const w = toWall(t, VN_OFFSET);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.mo)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`;
};
const next = (rule: Rule, after: number) => show(nextOccurrence(rule, after, VN_OFFSET));
const series = (rule: Rule, after: number, n: number) => {
  const out: string[] = [];
  let t = after;
  for (let i = 0; i < n; i++) out.push(show((t = nextOccurrence(rule, t, VN_OFFSET))));
  return out;
};

describe("nextOccurrence", () => {
  it("every day: later today, else tomorrow, never the same minute twice", () => {
    const rule: Rule = { kind: "day", h: 9, mi: 0 };
    expect(next(rule, at(2026, 10, 12, 8, 59))).toBe("2026-10-12 09:00");
    expect(next(rule, at(2026, 10, 12, 9, 0))).toBe("2026-10-13 09:00");
    expect(series(rule, at(2026, 12, 30, 12), 3)).toEqual(["2026-12-31 09:00", "2027-01-01 09:00", "2027-01-02 09:00"]);
  });

  it("every week on a weekday", () => {
    const monday: Rule = { kind: "week", wd: 1, h: 8, mi: 0 };
    expect(next(monday, at(2026, 10, 12, 7))).toBe("2026-10-12 08:00");
    expect(next(monday, at(2026, 10, 12, 8))).toBe("2026-10-19 08:00");
    expect(next({ kind: "week", wd: 0, h: 9, mi: 30 }, at(2026, 10, 12))).toBe("2026-10-18 09:30");
  });

  it("the 31st of a short month is its last day, and the series keeps its day", () => {
    expect(series({ kind: "month", d: 31, h: 8, mi: 0 }, at(2027, 1, 31, 9), 4)).toEqual([
      "2027-02-28 08:00",
      "2027-03-31 08:00",
      "2027-04-30 08:00",
      "2027-05-31 08:00",
    ]);
  });

  it("29 February comes round on the 28th in other years", () => {
    expect(series({ kind: "year", mo: 2, d: 29, h: 8, mi: 0 }, at(2026, 10, 12), 3)).toEqual(["2027-02-28 08:00", "2028-02-29 08:00", "2029-02-28 08:00"]);
  });

  it("every rằm, leap months included", () => {
    const out = series({ kind: "lunarMonth", ld: 15, h: 7, mi: 0 }, at(2025, 6, 1), 4);
    expect(out[0]).toBe("2025-06-10 07:00");
    for (const s of out) {
      const [y, mo, d] = s.slice(0, 10).split("-").map(Number);
      expect(solarToLunar(y!, mo!, d!)?.day).toBe(15);
    }
    // 2025 has a leap sixth month: its rằm is one of these.
    expect(out.some((s) => solarToLunar(...(s.slice(0, 10).split("-").map(Number) as [number, number, number]))?.leap)).toBe(true);
  });

  it("day 30 of a 29-day lunar month falls on its last day", () => {
    for (const s of series({ kind: "lunarMonth", ld: 30, h: 7, mi: 0 }, at(2026, 1, 1), 12)) {
      const [y, mo, d] = s.slice(0, 10).split("-").map(Number) as [number, number, number];
      expect(solarToLunar(y, mo, d)!.day).toBeGreaterThanOrEqual(29);
    }
  });

  it("a lunar date every year, never in a leap month", () => {
    expect(series({ kind: "lunarYear", lm: 3, ld: 10, h: 7, mi: 0 }, at(2026, 10, 12), 2)).toEqual(["2027-04-16 07:00", "2028-04-04 07:00"]);
    // 2025's leap month is the sixth: the date falls once that year.
    const sixth = series({ kind: "lunarYear", lm: 6, ld: 1, h: 7, mi: 0 }, at(2025, 1, 1), 2);
    expect(sixth).toEqual(["2025-06-25 07:00", "2026-07-14 07:00"]);
  });
});

describe("latestOccurrence", () => {
  it("is the one due now, not the first one missed", () => {
    const rule: Rule = { kind: "day", h: 9, mi: 0 };
    expect(show(latestOccurrence(rule, at(2026, 10, 12, 9), at(2026, 10, 14, 10), VN_OFFSET)!)).toBe("2026-10-14 09:00");
    expect(show(latestOccurrence(rule, at(2026, 10, 12, 9), at(2026, 10, 14, 8), VN_OFFSET)!)).toBe("2026-10-13 09:00");
    expect(latestOccurrence(rule, at(2026, 10, 12, 9), at(2026, 10, 12, 8), VN_OFFSET)).toBeNull();
  });

  it("finds the one walking every time from the start finds, however long ago the start", () => {
    const walk = (rule: Rule, from: number, upTo: number) => {
      let last: number | null = null;
      for (let t = nextOccurrence(rule, from - 1, VN_OFFSET); t <= upTo; t = nextOccurrence(rule, t, VN_OFFSET)) last = t;
      return last;
    };
    const everyDay = [0, 1, 2, 3, 4, 5, 6];
    const rules: Rule[] = [
      { kind: "day", h: 9, mi: 0 },
      { kind: "week", wd: 0, h: 23, mi: 30 },
      { kind: "weekly", slots: [{ wds: everyDay, h: 9, mi: 0 }, { wds: everyDay, h: 18, mi: 0 }] },
      { kind: "weekly", slots: [{ wds: [1], h: 20, mi: 0, dur: 30 }, { wds: [3, 6], h: 20, mi: 30, dur: 90 }] },
      { kind: "month", d: 31, h: 8, mi: 0 },
      { kind: "year", mo: 2, d: 29, h: 7, mi: 0 },
      { kind: "lunarMonth", ld: 30, h: 7, mi: 0 },
      { kind: "lunarYear", lm: 6, ld: 1, h: 7, mi: 0 },
    ];
    const from = at(2024, 1, 1, 12);
    for (const rule of rules) {
      for (let upTo = from - DAY; upTo < at(2027, 3, 1); upTo += 23 * DAY + 5 * HOUR + 7 * MINUTE) {
        expect([rule.kind, latestOccurrence(rule, from, upTo, VN_OFFSET)]).toEqual([rule.kind, walk(rule, from, upTo)]);
      }
    }
  });

  it("is today's even for a note that started years ago, twice a day", () => {
    const twice: Rule = { kind: "weekly", slots: [{ wds: [0, 1, 2, 3, 4, 5, 6], h: 9, mi: 0 }, { wds: [0, 1, 2, 3, 4, 5, 6], h: 18, mi: 0 }] };
    expect(show(latestOccurrence(twice, at(2016, 1, 1), at(2026, 10, 14, 10), VN_OFFSET)!)).toBe("2026-10-14 09:00");
  });
});

describe("readRule", () => {
  it("takes what the parser makes", () => {
    for (const r of [
      { kind: "day", h: 9, mi: 0 },
      { kind: "week", wd: 6, h: 23, mi: 59 },
      { kind: "month", d: 31, h: 0, mi: 0 },
      { kind: "year", mo: 2, d: 29, h: 8, mi: 0 },
      { kind: "lunarMonth", ld: 15, h: 7, mi: 0 },
      { kind: "lunarYear", lm: 12, ld: 30, h: 7, mi: 0 },
    ]) {
      expect(readRule(r)).toEqual(r);
    }
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      "day",
      [],
      { kind: "day", h: 24, mi: 0 },
      { kind: "day", h: 9, mi: 0, extra: 1 },
      { kind: "week", wd: 7, h: 9, mi: 0 },
      { kind: "month", d: 0, h: 9, mi: 0 },
      { kind: "year", mo: 2, d: 30, h: 9, mi: 0 },
      { kind: "lunarYear", lm: 13, ld: 1, h: 9, mi: 0 },
      { kind: "hour", h: 9, mi: 0 },
      { kind: "day", h: 9.5, mi: 0 },
    ]) {
      expect(readRule(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("describe", () => {
  const now = at(2026, 10, 12, 10, 30);
  it("reads like a person would say it", () => {
    expect(whenLabel(at(2026, 10, 12, 20), now, VN_OFFSET)).toBe("20:00 · hôm nay");
    expect(whenLabel(at(2026, 10, 13, 8), now, VN_OFFSET)).toBe("08:00 · mai, T3 13/10");
    expect(whenLabel(at(2026, 10, 11, 8), now, VN_OFFSET)).toBe("08:00 · hôm qua, CN 11/10");
    expect(whenLabel(at(2026, 10, 23, 8), now, VN_OFFSET)).toBe("08:00 · T6 23/10");
    expect(whenLabel(at(2027, 2, 20, 7), now, VN_OFFSET)).toBe("07:00 · T7 20/2/2027");
  });

  it("names rules and lunar days", () => {
    expect(ruleLabel({ kind: "week", wd: 1, h: 8, mi: 0 })).toBe("thứ 2 hằng tuần");
    expect(ruleLabel({ kind: "lunarMonth", ld: 15, h: 7, mi: 0 })).toBe("rằm hằng tháng (âm)");
    expect(ruleLabel({ kind: "lunarMonth", ld: 1, h: 7, mi: 0 })).toBe("mùng 1 hằng tháng (âm)");
    expect(ruleLabel({ kind: "lunarYear", lm: 3, ld: 10, h: 7, mi: 0 })).toBe("10/3 âm hằng năm");
    expect(lunarLabel(at(2026, 10, 24, 7), VN_OFFSET)).toBe("rằm tháng 9 âm");
    expect(lunarLabel(at(2027, 2, 6, 7), VN_OFFSET)).toBe("mùng 1 tháng giêng âm");
    expect(lunarLabel(at(2025, 7, 30, 7), VN_OFFSET)).toBe("mùng 6 tháng 6 nhuận âm");
  });
});

describe("weekly schedules", () => {
  const english: Rule = {
    kind: "weekly",
    slots: [
      { wds: [1], h: 20, mi: 0, dur: 30 },
      { wds: [3, 6], h: 20, mi: 30, dur: 90 },
    ],
  };

  it("comes round on each day at that day's time", () => {
    expect(series(english, at(2026, 10, 12, 21), 4)).toEqual(["2026-10-14 20:30", "2026-10-17 20:30", "2026-10-19 20:00", "2026-10-21 20:30"]);
  });

  it("knows how long each one lasts", () => {
    expect(durationAt(english, at(2026, 10, 12, 20, 0), VN_OFFSET)).toBe(30);
    expect(durationAt(english, at(2026, 10, 14, 20, 30), VN_OFFSET)).toBe(90);
    expect(durationAt({ kind: "day", h: 8, mi: 0 }, at(2026, 10, 14, 8), VN_OFFSET)).toBeNull();
  });

  it("reads as a week", () => {
    expect(ruleLabel(english)).toBe("T2 20:00–20:30 · T4, T7 20:30–22:00");
    expect(ruleLabel({ kind: "weekly", slots: [{ wds: [1, 3, 6], h: 20, mi: 0 }] })).toBe("T2, T4, T7 hằng tuần");
    expect(ruleLabel({ kind: "weekly", slots: [{ wds: [0, 6], h: 9, mi: 0 }] })).toBe("T7, CN hằng tuần");
    expect(whenLabel(at(2026, 10, 14, 20, 30), at(2026, 10, 12, 10, 30), VN_OFFSET, 90)).toBe("20:30–22:00 · ngày kia, T4 14/10");
  });

  it("checks what it is handed", () => {
    expect(readRule(english)).toEqual(english);
    for (const bad of [
      { kind: "weekly", slots: [] },
      { kind: "weekly", slots: [{ wds: [3, 1], h: 20, mi: 0 }] },
      { kind: "weekly", slots: [{ wds: [1, 1], h: 20, mi: 0 }] },
      { kind: "weekly", slots: [{ wds: [1], h: 20, mi: 0, dur: 0 }] },
      { kind: "weekly", slots: [{ wds: [7], h: 20, mi: 0 }] },
      { kind: "weekly", slots: [{ wds: [1], h: 20, mi: 0, extra: 1 }] },
      { kind: "weekly", slots: [{ wds: [1], h: 20, mi: 0 }], h: 8 },
    ]) {
      expect(readRule(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
