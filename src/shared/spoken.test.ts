import { describe, expect, it } from "vitest";
import { parse } from "./parse";
import { commaAtPauses, normalizeSpoken } from "./spoken";
import { fromWall, VN_OFFSET } from "./wall";

describe("spoken times in digits", () => {
  it("hours said in words", () => {
    expect(normalizeSpoken("tám giờ sáng mai gọi mẹ")).toBe("8 giờ sáng mai gọi mẹ");
    expect(normalizeSpoken("mười hai giờ trưa ăn cơm")).toBe("12 giờ trưa ăn cơm");
    expect(normalizeSpoken("năm giờ chiều đón con")).toBe("5 giờ chiều đón con");
  });

  it("minutes, halves and spans", () => {
    expect(normalizeSpoken("mười giờ rưỡi đón con")).toBe("10 giờ 30 đón con");
    expect(normalizeSpoken("tám giờ mười lăm họp")).toBe("8 giờ 15 họp");
    expect(normalizeSpoken("7 giờ bốn mươi lăm phút đi làm")).toBe("7 giờ 45 phút đi làm");
    expect(normalizeSpoken("hai mươi phút nữa tắt bếp")).toBe("20 phút nữa tắt bếp");
    expect(normalizeSpoken("một tiếng rưỡi nữa lấy đồ")).toBe("90 phút nữa lấy đồ");
  });

  it("dates said in words", () => {
    expect(normalizeSpoken("ngày hai mươi tháng mười một tặng hoa cô")).toBe("ngày 20 tháng 11 tặng hoa cô");
    expect(normalizeSpoken("mùng một tháng sau đi chùa")).toBe("mùng 1 tháng sau đi chùa");
    expect(normalizeSpoken("rằm tháng tám làm bánh")).toBe("rằm tháng 8 làm bánh");
    expect(normalizeSpoken("ngày ba mươi mốt đóng tiền")).toBe("ngày 31 đóng tiền");
  });

  it("half past, a quarter to, and days from now", () => {
    expect(normalizeSpoken("bảy rưỡi tối đi xem phim")).toBe("7 giờ 30 tối đi xem phim");
    expect(normalizeSpoken("7 rưỡi tối đi xem phim")).toBe("7 giờ 30 tối đi xem phim");
    expect(normalizeSpoken("9 giờ kém mười lăm họp")).toBe("9 giờ kém 15 họp");
    expect(normalizeSpoken("ba hôm nữa trả sách")).toBe("3 hôm nữa trả sách");
  });

  it("a count is not a date", () => {
    expect(normalizeSpoken("uống thuốc ngày hai lần")).toBe("uống thuốc ngày hai lần");
    expect(normalizeSpoken("ngày năm mới về quê")).toBe("ngày năm mới về quê");
    expect(normalizeSpoken("mua hai cân rưỡi thịt")).toBe("mua hai cân rưỡi thịt");
  });

  it("leaves the number words that are not a time", () => {
    expect(normalizeSpoken("thứ năm họp, năm nay đi Đà Lạt")).toBe("thứ năm họp, năm nay đi Đà Lạt");
    expect(normalizeSpoken("mua hai con cá")).toBe("mua hai con cá");
    expect(normalizeSpoken("8 giờ gọi mẹ")).toBe("8 giờ gọi mẹ");
  });

  it("what it hands over, the parser reads", () => {
    const now = fromWall(2026, 10, 13, 9, 0, VN_OFFSET);
    const p = parse(normalizeSpoken("mười giờ rưỡi sáng mai đón con"), now, VN_OFFSET);
    expect(p.title).toBe("Đón con");
    expect(p.due).toBe(fromWall(2026, 10, 14, 10, 30, VN_OFFSET));
  });
});

describe("a comma where the speaker paused", () => {
  it("between the things of a list said aloud", () => {
    // "đi chợ mua cá … đường … muối … bột ngọt"
    expect(commaAtPauses("đi chợ mua cá đường muối bột ngọt", [4, 5, 6])).toBe("đi chợ mua cá, đường, muối, bột ngọt");
  });

  it("only after the buying word: a pause before it, or in a plain note, is a hesitation", () => {
    // "mai 8 giờ … đi chợ mua cá … đường … muối"
    expect(commaAtPauses("mai 8 giờ đi chợ mua cá đường muối", [3, 7, 8])).toBe("mai 8 giờ đi chợ mua cá, đường, muối");
    expect(commaAtPauses("gọi mẹ nhé", [1])).toBe("gọi mẹ nhé");
  });

  it("not after the last word, or twice", () => {
    expect(commaAtPauses("mua cá đường", [4, 4, 3])).toBe("mua cá đường");
    expect(commaAtPauses("mua cá đường muối", [2, 2, 3])).toBe("mua cá, đường, muối");
  });

  it("the recognizer's own commas win", () => {
    expect(commaAtPauses("cá, đường muối", [2])).toBe("cá, đường muối");
  });
});

describe("what people say, read the way they mean it", () => {
  // Tuesday 13/10/2026, 09:00. Each line: said aloud, then what the note must be.
  const now = fromWall(2026, 10, 13, 9, 0, VN_OFFSET);
  const at = (mo: number, d: number, h: number, mi = 0, y = 2026) => fromWall(y, mo, d, h, mi, VN_OFFSET);
  it.each([
    ["tám giờ sáng mai gọi mẹ", "Gọi mẹ", at(10, 14, 8)],
    ["Mai 8 giờ gọi mẹ.", "Gọi mẹ", at(10, 14, 8)],
    ["nhớ nhắc tôi mai gọi điện cho bác sĩ", "Gọi điện cho bác sĩ", at(10, 14, 8)],
    ["gọi mẹ nhắc tôi lúc 8 giờ tối", "Gọi mẹ", at(10, 13, 20)],
    ["tối nay 8 giờ nhắc mình uống thuốc", "Uống thuốc", at(10, 13, 20)],
    ["chiều nay khoảng 4 giờ đón con", "Đón con", at(10, 13, 16)],
    ["đúng 6 giờ sáng mai dậy tập thể dục", "Dậy tập thể dục", at(10, 14, 6)],
    ["bảy rưỡi tối thứ sáu đi xem phim", "Đi xem phim", at(10, 16, 19, 30)],
    ["thứ bảy này 9 giờ đá bóng", "Đá bóng", at(10, 17, 9)],
    ["9 giờ kém mười lăm họp", "Họp", at(10, 14, 8, 45)],
    ["mười lăm phút nữa tắt bếp", "Tắt bếp", now + 15 * 60_000],
    ["một tiếng rưỡi nữa lấy đồ", "Lấy đồ", now + 90 * 60_000],
    ["ba hôm nữa trả sách thư viện", "Trả sách thư viện", at(10, 16, 9)],
    ["ngày hai mươi tháng mười một tặng hoa cô", "Tặng hoa cô", at(11, 20, 8)],
    ["mùng một tháng sau đi chùa", "Đi chùa", at(11, 9, 7)],
    ["rằm tháng tám làm bánh", "Làm bánh", at(9, 15, 7, 0, 2027)],
    ["cuối tháng này đóng tiền điện", "Đóng tiền điện", at(10, 31, 8)],
  ])("%s", (said, title, due) => {
    const p = parse(normalizeSpoken(said), now, VN_OFFSET);
    expect(p.title).toBe(title);
    expect(p.due).toBe(due);
  });

  it.each([
    ["mỗi năm ngày 12 tháng 5 sinh nhật Lan", "Sinh nhật Lan", "year"],
    ["sinh nhật mẹ ngày 12 tháng 5 âm lịch", "Sinh nhật mẹ", "lunarYear"],
    ["mỗi tối 9 giờ đọc sách", "Đọc sách", "day"],
    ["các ngày trong tuần 6 giờ sáng chạy bộ", "Chạy bộ", "weekly"],
  ])("repeats: %s", (said, title, kind) => {
    const p = parse(normalizeSpoken(said), now, VN_OFFSET);
    expect(p.title).toBe(title);
    expect(p.rule?.kind).toBe(kind);
  });

  it("how often is not when: no date in it", () => {
    for (const said of ["uống thuốc ngày hai lần", "uống thuốc ngày 2 lần", "ngày năm mới về quê"]) {
      expect(parse(normalizeSpoken(said), now, VN_OFFSET).due).toBeNull();
    }
  });

  it("lists said aloud", () => {
    expect(parse(normalizeSpoken("đi siêu thị mua sữa, bánh mì và trứng"), now, VN_OFFSET).items?.map((i) => i.t)).toEqual(["sữa", "bánh mì", "trứng"]);
    expect(parse(normalizeSpoken("nhớ mua thuốc, khẩu trang, nước rửa tay"), now, VN_OFFSET).items).toHaveLength(3);
  });
});
