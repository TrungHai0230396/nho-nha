import { describe, expect, it } from "vitest";
import { HELP } from "./examples";
import { solarToLunar } from "./lunar";
import { parse } from "./parse";
import { fromWall, toWall, VN_OFFSET } from "./wall";

const now = fromWall(2026, 10, 12, 14, 0, VN_OFFSET);
const group = (title: string) => HELP.find((g) => g.title === title)!.items.map((e) => parse(e.text, now, VN_OFFSET));
const lunarDay = (at: number) => {
  const w = toWall(at, VN_OFFSET);
  return solarToLunar(w.y, w.mo, w.d)!.day;
};

describe("the suggestions in the ? sheet", () => {
  it("one-offs: a time and no repeat, the time words gone from the title", () => {
    const got = group("Nhắc một lần");
    for (const p of got) {
      expect(p.due).not.toBeNull();
      expect(p.rule).toBeNull();
    }
    expect(got.map((p) => p.title)).toEqual(["Tắt bếp", "Uống thuốc", "Đi khám răng", "Đi siêu thị", "Nộp báo cáo", "Tặng hoa cô giáo"]);
  });

  it("repeats: each one a rule", () => {
    const got = group("Lặp lại");
    expect(got.map((p) => p.rule?.kind)).toEqual(["day", "weekly", "week", "weekly", "month", "year"]);
    expect(got.map((p) => p.title)).toEqual(["Uống thuốc", "Uống thuốc", "Học bơi", "Học tiếng Anh", "Đóng tiền nhà", "Sinh nhật Lan"]);
  });

  it("lunar: rằm every month, and the next mùng 1 and 23 tháng Chạp", () => {
    const [ram, mung1, tao] = group("Âm lịch");
    expect(ram!.rule).toMatchObject({ kind: "lunarMonth", ld: 15 });
    expect(lunarDay(mung1!.due!)).toBe(1);
    expect(lunarDay(tao!.due!)).toBe(23);
    expect([ram, mung1, tao].map((p) => p!.title)).toEqual(["Thắp hương", "Đi chùa", "Cúng ông Công ông Táo"]);
  });

  it("signs: a list, a nag, a tag, and a note with no time that stays a note", () => {
    const [list, nag, tag, plain] = group("Mẹo");
    expect(list!.items?.map((i) => i.t)).toEqual(["trứng", "sữa", "rau"]);
    expect(nag!.nag).toBe(true);
    expect(nag!.due).not.toBeNull();
    expect(tag!.tags).toEqual(["công-việc"]);
    expect(plain).toMatchObject({ due: null, rule: null, items: null, nag: false, title: "Ý tưởng quà sinh nhật cho mẹ" });
  });
});
