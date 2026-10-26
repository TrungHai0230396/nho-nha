import { describe, expect, it } from "vitest";
import { ruleLabel } from "./describe";
import { parse, partsOf } from "./parse";
import { fromWall, toWall, VN_OFFSET } from "./wall";

const at = (y: number, mo: number, d: number, h = 0, mi = 0, offset = VN_OFFSET) => fromWall(y, mo, d, h, mi, offset);
const show = (t: number | null, offset = VN_OFFSET) => {
  if (t === null) return null;
  const w = toWall(t, offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.mo)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`;
};

// Monday 12 October 2026, 10:30 in Vietnam: the day this was written.
const NOW = at(2026, 10, 12, 10, 30);
const p = (text: string, now = NOW) => parse(text, now, VN_OFFSET);
const understood = (text: string) =>
  p(text)
    .spans.filter((s) => s.kind === "time")
    .map((s) => text.slice(s.s, s.e));

describe("parse: once", () => {
  it.each([
    ["mai 8h gọi mẹ", "2026-10-13 08:00", "Gọi mẹ"],
    ["2 tiếng nữa lấy đồ giặt", "2026-10-12 12:30", "Lấy đồ giặt"],
    ["30p nữa tắt bếp", "2026-10-12 11:00", "Tắt bếp"],
    ["nửa tiếng nữa gọi lại", "2026-10-12 11:00", "Gọi lại"],
    ["1 tiếng rưỡi nữa họp", "2026-10-12 12:00", "Họp"],
    ["thứ 6 nộp báo cáo", "2026-10-16 08:00", "Nộp báo cáo"],
    ["thứ 6 tuần sau nộp báo cáo", "2026-10-23 08:00", "Nộp báo cáo"],
    ["t7 đi Đà Lạt", "2026-10-17 08:00", "Đi Đà Lạt"],
    ["chủ nhật 9h đá bóng", "2026-10-18 09:00", "Đá bóng"],
    ["chiều thứ 5 gặp khách", "2026-10-15 14:00", "Gặp khách"],
    ["8h tối nay xem bóng đá", "2026-10-12 20:00", "Xem bóng đá"],
    ["tối nay xem phim", "2026-10-12 20:00", "Xem phim"],
    ["7h sáng mai chạy bộ", "2026-10-13 07:00", "Chạy bộ"],
    ["2 giờ chiều mai nha sĩ", "2026-10-13 14:00", "Nha sĩ"],
    ["họp 14:30", "2026-10-12 14:30", "Họp"],
    ["3h đón con", "2026-10-12 15:00", "Đón con"],
    ["hôm nay 17h đóng tiền điện", "2026-10-12 17:00", "Đóng tiền điện"],
    ["mai lúc 7h30 đi khám", "2026-10-13 07:30", "Đi khám"],
    ["nhắc tôi uống nước lúc 3h chiều", "2026-10-12 15:00", "Uống nước"],
    ["ngày mốt về quê", "2026-10-14 08:00", "Về quê"],
    ["cuối tháng đóng tiền nhà", "2026-10-31 08:00", "Đóng tiền nhà"],
    ["cuối tuần dọn nhà", "2026-10-17 08:00", "Dọn nhà"],
    ["đầu tháng sau đóng học phí", "2026-11-01 08:00", "Đóng học phí"],
    ["tuần sau đi khám răng", "2026-10-19 08:00", "Đi khám răng"],
    ["ngày 5 đóng tiền điện", "2026-11-05 08:00", "Đóng tiền điện"],
    ["ngày 20 đóng tiền nước", "2026-10-20 08:00", "Đóng tiền nước"],
    ["20/12 họp lớp", "2026-12-20 08:00", "Họp lớp"],
    ["5/1 đi làm lại", "2027-01-05 08:00", "Đi làm lại"],
    ["8h kém 15 họp giao ban", "2026-10-13 07:45", "Họp giao ban"],
    ["12h đêm nay tắt máy", "2026-10-13 00:00", "Tắt máy"],
    ["rằm thắp hương", "2026-10-24 07:00", "Thắp hương"],
    ["mùng 1 đi chùa", "2026-11-09 07:00", "Đi chùa"],
    ["rằm tháng giêng đi lễ", "2027-02-20 07:00", "Đi lễ"],
    ["mùng 1 tết chúc tết ông bà", "2027-02-06 07:00", "Chúc tết ông bà"],
  ])("%s → %s", (text, due, title) => {
    const r = p(text);
    expect(show(r.due)).toBe(due);
    expect(r.title).toBe(title);
    expect(r.rule).toBeNull();
  });

  it("a bare hour already gone today means tomorrow", () => {
    expect(show(p("8h họp").due)).toBe("2026-10-13 08:00");
    expect(show(p("11h họp").due)).toBe("2026-10-12 11:00");
  });

  it("a weekday that is today, its hour gone, means next week", () => {
    expect(show(p("thứ 2 8h họp").due)).toBe("2026-10-19 08:00");
    expect(show(p("thứ 2 16h họp").due)).toBe("2026-10-12 16:00");
  });

  it("says when the time named has already gone", () => {
    const r = p("sáng nay uống thuốc");
    expect(show(r.due)).toBe("2026-10-12 08:00");
    expect(r.past).toBe(true);
    expect(p("tối nay xem phim").past).toBe(false);
  });

  it("rolls over the end of the year", () => {
    const eve = at(2026, 12, 31, 22, 0);
    expect(show(p("mai 8h gọi mẹ", eve).due)).toBe("2027-01-01 08:00");
    expect(show(p("15/1 đóng bảo hiểm", eve).due)).toBe("2027-01-15 08:00");
    expect(show(p("thứ 6 nộp bài", eve).due)).toBe("2027-01-01 08:00");
  });

  it("does not depend on the machine's timezone", () => {
    // The same wall-clock moment written for a UTC clock reads the same.
    const now = fromWall(2026, 10, 12, 10, 30, 0);
    expect(show(parse("mai 8h gọi mẹ", now, 0).due, 0)).toBe("2026-10-13 08:00");
  });
});

describe("parse: repeating", () => {
  it.each([
    ["mỗi ngày 9h uống thuốc", { kind: "day", h: 9, mi: 0 }, "2026-10-13 09:00", "Uống thuốc"],
    ["mỗi tối 21h tập thể dục", { kind: "day", h: 21, mi: 0 }, "2026-10-12 21:00", "Tập thể dục"],
    ["mỗi sáng thứ 2 họp team", { kind: "week", wd: 1, h: 8, mi: 0 }, "2026-10-19 08:00", "Họp team"],
    ["thứ 4 hằng tuần 19h học tiếng Anh", { kind: "week", wd: 3, h: 19, mi: 0 }, "2026-10-14 19:00", "Học tiếng Anh"],
    ["ngày 25 trả thẻ tín dụng hằng tháng", { kind: "month", d: 25, h: 8, mi: 0 }, "2026-10-25 08:00", "Trả thẻ tín dụng"],
    ["hằng năm 20/10 tặng hoa mẹ", { kind: "year", mo: 10, d: 20, h: 8, mi: 0 }, "2026-10-20 08:00", "Tặng hoa mẹ"],
    ["mỗi rằm cúng", { kind: "lunarMonth", ld: 15, h: 7, mi: 0 }, "2026-10-24 07:00", "Cúng"],
    ["mùng 1 hằng tháng đi chùa", { kind: "lunarMonth", ld: 1, h: 7, mi: 0 }, "2026-11-09 07:00", "Đi chùa"],
  ])("%s", (text, rule, due, title) => {
    const r = p(text);
    expect(r.rule).toEqual(rule);
    expect(show(r.due)).toBe(due);
    expect(r.title).toBe(title);
  });

  it("a birthday on a date comes back every year", () => {
    expect(p("15/11 sinh nhật Lan").rule).toEqual({ kind: "year", mo: 11, d: 15, h: 8, mi: 0 });
    const lunar = p("10/3 âm sinh nhật bà");
    expect(lunar.rule).toEqual({ kind: "lunarYear", lm: 3, ld: 10, h: 7, mi: 0 });
    expect(show(lunar.due)).toBe("2027-04-16 07:00");
    expect(lunar.title).toBe("Sinh nhật bà");
  });
});

describe("parse: words that only look like time", () => {
  it("leaves names and ordinary words alone", () => {
    for (const text of ["gọi chị Mai hỏi lịch", "sáng tạo nội dung mới", "mua 2 cái áo", "ngủ đủ 8 tiếng", "uống 2 lít nước"]) {
      expect(p(text).due, text).toBeNull();
    }
    expect(p("gọi chị Mai hỏi lịch").title).toBe("Gọi chị Mai hỏi lịch");
  });

  it("reads 'mai' as tomorrow only once", () => {
    const r = p("mai mua hoa cho Mai");
    expect(show(r.due)).toBe("2026-10-13 08:00");
    expect(r.title).toBe("Mua hoa cho Mai");
  });

  it("highlights exactly what it understood", () => {
    expect(understood("thứ 6 tuần sau nộp báo cáo!")).toEqual(["thứ 6 tuần sau"]);
    expect(understood("7h sáng mai chạy bộ")).toEqual(["7h", "sáng mai"]);
    expect(understood("chiều thứ 5 gặp khách")).toEqual(["chiều", "thứ 5"]);
  });
});

describe("parse: the rest of the line", () => {
  it("'!' at the end asks to be reminded until answered", () => {
    const r = p("thứ 6 tuần sau nộp báo cáo!");
    expect(r.nag).toBe(true);
    expect(r.title).toBe("Nộp báo cáo");
    expect(p("nộp báo cáo").nag).toBe(false);
  });

  it("'!' before the tags that end the line still asks, and leaves the title", () => {
    const r = p("uống thuốc 21h! #sức-khoẻ");
    expect(r).toMatchObject({ nag: true, title: "Uống thuốc", tags: ["sức-khoẻ"] });
    expect(p("uống thuốc 21h #sức-khoẻ!")).toMatchObject({ nag: true, title: "Uống thuốc", tags: ["sức-khoẻ"] });
    // Not at the end: a word after it means the "!" was only punctuation.
    expect(p("tuyệt! mai 8h đi bơi").nag).toBe(false);
  });

  it("turns 'list: a, b, c' into ticks", () => {
    const r = p("đi chợ: trứng, sữa, rau");
    expect(r.title).toBe("Đi chợ");
    expect(r.items).toEqual([
      { t: "trứng", done: false },
      { t: "sữa", done: false },
      { t: "rau", done: false },
    ]);
    expect(r.due).toBeNull();
    const timed = p("mai 7h đi chợ: trứng, sữa");
    expect(timed.items?.map((i) => i.t)).toEqual(["trứng", "sữa"]);
    expect(show(timed.due)).toBe("2026-10-13 07:00");
    expect(p("Ý tưởng: app nhắn cho chính mình").items).toBeNull();
  });

  it("a list said aloud: a buying or bringing word, then three things or more", () => {
    // How the microphone hands it over: no colon, and maybe a last "và".
    expect(p("đi chợ mua cá, đường, muối, bột ngọt")).toMatchObject({ title: "Đi chợ mua", items: [{ t: "cá" }, { t: "đường" }, { t: "muối" }, { t: "bột ngọt" }] });
    const timed = p("mai 8 giờ đi chợ mua cá, đường và muối");
    expect(timed.items?.map((i) => i.t)).toEqual(["cá", "đường", "muối"]);
    expect(show(timed.due)).toBe("2026-10-13 08:00");
    expect(p("mang theo áo mưa, ô, kem chống nắng")).toMatchObject({ title: "Mang theo", items: [{ t: "áo mưa" }, { t: "ô" }, { t: "kem chống nắng" }] });
    expect(p("đi chợ: trứng, sữa và rau").items?.map((i) => i.t)).toEqual(["trứng", "sữa", "rau"]);
  });

  it("an hour before a date keeps its own minutes", () => {
    expect(p("9h 22/10 họp")).toMatchObject({ title: "Họp" });
    expect(show(p("9h 22/10 họp").due)).toBe("2026-10-22 09:00");
    expect(show(p("9h30 22/10 họp").due)).toBe("2026-10-22 09:30");
    expect(show(p("9h 15 họp").due)).toBe("2026-10-13 09:15");
  });

  it("words in quotes are only words", () => {
    // A book, not a time: the reading undone by tapping the marked words.
    expect(p("đọc “Tám giờ tối” 8h")).toMatchObject({ title: "Đọc Tám giờ tối" });
    expect(show(p("đọc “Tám giờ tối” 8h").due)).toBe("2026-10-13 08:00");
    expect(p('họp phòng "mai 8h"')).toMatchObject({ title: "Họp phòng mai 8h", due: null });
    expect(p("“#1” bán chạy")).toMatchObject({ tags: [] });
  });

  it("two things after a buying word are often one: no list", () => {
    expect(p("mua quà cho mẹ và bố")).toMatchObject({ title: "Mua quà cho mẹ và bố", items: null });
    expect(p("mua quà cho mẹ, nhớ gói đẹp").items).toBeNull();
    expect(p("tìm mua cá").items).toBeNull();
  });

  it("collects #tags and keeps them out of the title", () => {
    const r = p("mai lúc 7h30 đi khám #SucKhoe #suckhoe #gia-dinh");
    expect(r.tags).toEqual(["suckhoe", "gia-dinh"]);
    expect(r.title).toBe("Đi khám");
  });

  it("keeps the whole line when nothing but time was typed", () => {
    expect(p("8h").title).toBe("8h");
  });

  it("plain notes stay plain", () => {
    const r = p("Mật khẩu wifi quán cà phê ở tầng 2");
    expect(r.due).toBeNull();
    expect(r.rule).toBeNull();
    expect(r.title).toBe("Mật khẩu wifi quán cà phê ở tầng 2");
  });
});

describe("parse: a week's schedule", () => {
  const ENGLISH = [
    { wds: [1], h: 20, mi: 0, dur: 30 },
    { wds: [3, 6], h: 20, mi: 30, dur: 90 },
  ];
  it.each([
    ["học tiếng Anh thứ 2 20h-20h30, thứ 4 và 7 20h30-22h", ENGLISH, "2026-10-12 20:00", "Học tiếng Anh"],
    ["học tiếng Anh: thứ 2 từ 20h đến 20h30; thứ 4, thứ 7 từ 20h30 đến 22h", ENGLISH, "2026-10-12 20:00", "Học tiếng Anh"],
    // The example the app shows (welcome page, empty list): Hải's own schedule, on one line.
    ["mỗi thứ 2,4,7 học tiếng Anh, thứ 2 từ 20h đến 20h30, thứ 4,7 từ 20h30 đến 22h", ENGLISH, "2026-10-12 20:00", "Học tiếng Anh"],
    // Written out the way Hải did, in lines (from the note's edit box).
    ["mỗi thứ 2,4,7 học tiếng anh\nthứ 2 học từ 20h đến 20h30\n4,7 học từ 20h30 đến 22h", ENGLISH, "2026-10-12 20:00", "Học tiếng anh"],
    ["mỗi thứ 2,4,7 20h học tiếng Anh", [{ wds: [1, 3, 6], h: 20, mi: 0 }], "2026-10-12 20:00", "Học tiếng Anh"],
    ["thứ 2 đến thứ 6 6h30 tập thể dục", [{ wds: [1, 2, 3, 4, 5], h: 6, mi: 30 }], "2026-10-13 06:30", "Tập thể dục"],
    ["các ngày trong tuần 7h đi làm", [{ wds: [1, 2, 3, 4, 5], h: 7, mi: 0 }], "2026-10-13 07:00", "Đi làm"],
    ["mỗi cuối tuần 9h đá bóng", [{ wds: [0, 6], h: 9, mi: 0 }], "2026-10-17 09:00", "Đá bóng"],
    ["t3 t5 19h học bơi", [{ wds: [2, 4], h: 19, mi: 0 }], "2026-10-13 19:00", "Học bơi"],
    ["mỗi thứ 2 20h-20h30 học", [{ wds: [1], h: 20, mi: 0, dur: 30 }], "2026-10-12 20:00", "Học"],
    ["thứ 7, chủ nhật 8h-10h tối đi dạy", [{ wds: [0, 6], h: 20, mi: 0, dur: 120 }], "2026-10-17 20:00", "Đi dạy"],
    ["mỗi thứ 2,4,6 tập gym", [{ wds: [1, 3, 5], h: 8, mi: 0 }], "2026-10-14 08:00", "Tập gym"],
  ])("%s", (text, slots, due, title) => {
    const r = p(text);
    expect(r.rule).toEqual({ kind: "weekly", slots });
    expect(show(r.due)).toBe(due);
    expect(r.title).toBe(title);
  });

  it("keeps every time a group of days is given, written after it or before it", () => {
    const both = (wds: number[]) => [
      { wds, h: 9, mi: 0 },
      { wds, h: 18, mi: 0 },
    ];
    expect(p("thứ 2,4 9h và 18h tập thể dục")).toMatchObject({ rule: { kind: "weekly", slots: both([1, 3]) }, title: "Tập thể dục" });
    expect(p("9h, 18h thứ 2,4 tập thể dục").rule).toEqual({ kind: "weekly", slots: both([1, 3]) });
    expect(p("mỗi thứ 2 9h và 18h họp").rule).toEqual({ kind: "weekly", slots: both([1]) });
    // A time right before a day of its own is that day's.
    expect(p("thứ 2 9h, 18h thứ 4 tập").rule).toEqual({
      kind: "weekly",
      slots: [
        { wds: [1], h: 9, mi: 0 },
        { wds: [3], h: 18, mi: 0 },
      ],
    });
    expect(p("thứ 2,4 9h và 18h, thứ 6 10h tập").rule).toEqual({ kind: "weekly", slots: [...both([1, 3]), { wds: [5], h: 10, mi: 0 }] });
    // One Monday, not every one: a reminder holds one time, so the first, as before; "và" stays out of the title.
    expect(p("thứ 2 9h và 18h họp")).toMatchObject({ rule: null, title: "Họp", due: at(2026, 10, 19, 9) });
  });

  it("still reads one day as before", () => {
    expect(p("mỗi sáng thứ 2 họp team").rule).toEqual({ kind: "week", wd: 1, h: 8, mi: 0 });
    expect(p("thứ 6 nộp báo cáo").rule).toBeNull();
  });
});

describe("parse: a range of hours, once", () => {
  it("rings at the start and keeps the range out of the title", () => {
    const r = p("mai 14h-16h họp");
    expect(show(r.due)).toBe("2026-10-13 14:00");
    expect([r.title, r.rule]).toEqual(["Họp", null]);
    const evening = p("8h-10h tối nay xem phim");
    expect(show(evening.due)).toBe("2026-10-12 20:00");
    expect(evening.title).toBe("Xem phim");
  });

  it("does not mistake a range for a date", () => {
    expect(p("20/10 8-10h tặng hoa").due).toBe(fromWall(2026, 10, 20, 8, 0, VN_OFFSET));
  });
});

describe("parse: several times a day", () => {
  const DAILY = (...hours: number[]) => ({ kind: "weekly", slots: hours.map((h) => ({ wds: [0, 1, 2, 3, 4, 5, 6], h, mi: 0 })) });

  // Hải, 14/10/2026: "9h,18h hằng ngày uống thuốc" rang at 9h only, the 18h marked as read and dropped.
  it.each([
    "9h,18h hằng ngày uống thuốc",
    "9h, 18h hằng ngày uống thuốc",
    "hằng ngày 9h, 18h uống thuốc",
    "mỗi ngày 9h và 18h uống thuốc",
    "uống thuốc 9h 18h mỗi ngày",
    "uống thuốc lúc 9h và 18h hằng ngày",
    "mỗi ngày 9h sáng và 6h chiều uống thuốc",
  ])("%s", (text) => {
    const r = p(text);
    expect(r.rule).toEqual(DAILY(9, 18));
    expect(r.title).toBe("Uống thuốc");
    expect(show(r.due)).toBe("2026-10-12 18:00");
  });

  it("as many times as are written together, the period words going with each", () => {
    expect(p("mỗi ngày 7h, 11h, 15h, 19h uống thuốc").rule).toEqual(DAILY(7, 11, 15, 19));
    expect(p("mỗi sáng 7h, 9h uống nước").rule).toEqual(DAILY(7, 9));
  });

  it("one time a day stays the plain daily rule", () => {
    expect(p("mỗi ngày 9h uống thuốc").rule).toEqual({ kind: "day", h: 9, mi: 0 });
  });

  it("is said with the days once", () => {
    expect(ruleLabel(p("9h, 18h hằng ngày uống thuốc").rule!)).toBe("mỗi ngày 09:00, 18:00");
    expect(ruleLabel(p("thứ 2,4 9h và 18h tập").rule!)).toBe("T2, T4 09:00, 18:00");
  });
});

describe("parse: several times, once", () => {
  // Hải, 14/10/2026: "mai 9h và 15h họp" rang at 9h only. Now a reminder for each time.
  const parts = (text: string) => partsOf(p(text), NOW, VN_OFFSET)?.map((x) => [x.text, show(x.parsed.due), x.parsed.title]) ?? null;

  it("makes a line for each time, each saying only its own", () => {
    expect(parts("mai 9h và 15h họp")).toEqual([
      ["mai 9h họp", "2026-10-13 09:00", "Họp"],
      ["mai 15h họp", "2026-10-13 15:00", "Họp"],
    ]);
    expect(parts("hôm nay 14h, 16h gọi khách!")).toEqual([
      ["hôm nay 14h gọi khách!", "2026-10-12 14:00", "Gọi khách"],
      ["hôm nay 16h gọi khách!", "2026-10-12 16:00", "Gọi khách"],
    ]);
    // Typed on a Monday after nine: both next Monday, the second saying the date it would otherwise miss.
    expect(parts("thứ 2 9h và 18h họp")).toEqual([
      ["thứ 2 9h họp", "2026-10-19 09:00", "Họp"],
      ["thứ 2 18h 19/10 họp", "2026-10-19 18:00", "Họp"],
    ]);
    expect(parts("mai 9h-10h và 14h-15h họp")?.map((x) => x[0])).toEqual(["mai 9h-10h họp", "mai 14h-15h họp"]);
  });

  it("reads each time as it was meant among the others", () => {
    // The evening word goes back to the earlier time when the two still run in order…
    expect(parts("mai 8h và 9h tối đi ăn")?.map((x) => x[1])).toEqual(["2026-10-13 20:00", "2026-10-13 21:00"]);
    // …and not when it would put the first after the second.
    expect(parts("mai 9h và 3h chiều họp")?.map((x) => x[1])).toEqual(["2026-10-13 09:00", "2026-10-13 15:00"]);
    expect(parts("tối mai 8h và 10h xem phim")?.map((x) => x[1])).toEqual(["2026-10-13 20:00", "2026-10-13 22:00"]);
    // 1–5 o'clock is the afternoon unless the next time says it is before dawn.
    expect(parts("mai 4h và 6h dậy")?.map((x) => x[1])).toEqual(["2026-10-13 04:00", "2026-10-13 06:00"]);
    expect(parts("mai 9h và 3h họp")?.map((x) => x[1])).toEqual(["2026-10-13 09:00", "2026-10-13 15:00"]);
  });

  it("leaves alone a line that is one reminder", () => {
    for (const text of ["mai 9h họp", "9h, 18h hằng ngày uống thuốc", "mỗi thứ 2 9h và 18h họp", "2 tiếng nữa và 15h gọi", "đi chợ: trứng, sữa"]) expect(parts(text), text).toBeNull();
  });
});

// Readings that rang at the wrong time or dropped part of the line (review, 23/10/2026).
describe("parse: days and times a line names together", () => {
  const FRIDAY = at(2026, 10, 16, 10, 0);
  const parts = (text: string, now = NOW) => partsOf(p(text, now), now, VN_OFFSET)!.map((x) => [show(x.parsed.due), x.parsed.title, x.parsed.rule]);

  it("makes a reminder of each day of the month named", () => {
    expect(parts("mùng 1 và rằm hằng tháng thắp hương")).toEqual([
      ["2026-11-09 07:00", "Thắp hương", { kind: "lunarMonth", ld: 1, h: 7, mi: 0 }],
      ["2026-10-24 07:00", "Thắp hương", { kind: "lunarMonth", ld: 15, h: 7, mi: 0 }],
    ]);
    expect(parts("mỗi mùng 1 và rằm thắp hương").map((x) => (x[2] as { ld: number }).ld)).toEqual([1, 15]);
    expect(parts("ngày 1 và 15 hằng tháng đóng tiền").map((x) => (x[2] as { d: number }).d)).toEqual([1, 15]);
    expect(parts("mùng 1, rằm thắp hương").map((x) => x[2])).toEqual([null, null]);
    expect(p("mùng 1 và rằm hằng tháng thắp hương").title).toBe("Thắp hương");
  });

  it("adds the hours and the minutes of a time from now", () => {
    expect([show(p("1 tiếng 30 phút nữa gọi lại").due), p("1 tiếng 30 phút nữa gọi lại").title]).toEqual(["2026-10-12 12:00", "Gọi lại"]);
    expect(show(p("1h30 nữa gọi lại").due)).toBe("2026-10-12 12:00");
    expect(show(p("2h15 nữa").due)).toBe("2026-10-12 12:45");
  });

  it("takes the day from 'N ngày nữa' and the time from its hour", () => {
    expect(show(p("3 ngày nữa 9h họp").due)).toBe("2026-10-15 09:00");
    expect(show(p("1 tuần nữa 8h khám lại").due)).toBe("2026-10-19 08:00");
    expect(show(p("3 ngày nữa gọi lại").due)).toBe("2026-10-15 10:30");
  });

  it("reads the night words: khuya, 12h tối, the small hours after midnight", () => {
    expect([show(p("11h khuya đi ngủ").due), p("11h khuya đi ngủ").title]).toEqual(["2026-10-12 23:00", "Đi ngủ"]);
    expect(show(p("1h khuya").due)).toBe("2026-10-13 01:00");
    expect(show(p("12h tối").due)).toBe("2026-10-13 00:00");
    expect(show(p("đêm nay 2h xem bóng đá").due)).toBe("2026-10-13 02:00");
    expect(p("mỗi thứ 7 12h đêm").rule).toEqual({ kind: "week", wd: 0, h: 0, mi: 0 });
    expect(show(p("mỗi thứ 7 12h đêm").due)).toBe(show(p("thứ 7 12h đêm").due));
  });

  it("makes days of one week once each, not every week", () => {
    expect(parts("thứ 4, thứ 6 tuần sau 9h họp")).toEqual([
      ["2026-10-21 09:00", "Họp", null],
      ["2026-10-23 09:00", "Họp", null],
    ]);
    expect(parts("thứ 3 và thứ 5 này đi khám").map((x) => x[0])).toEqual(["2026-10-13 08:00", "2026-10-15 08:00"]);
    expect(p("mỗi thứ 2,4,7 học tiếng Anh").rule?.kind).toBe("weekly");
  });

  it("keeps each day with its own time", () => {
    expect(parts("mai 8h và thứ 2 9h họp").map((x) => x[0])).toEqual(["2026-10-13 08:00", "2026-10-19 09:00"]);
    expect(parts("mai 9h và 15h họp").map((x) => x[0])).toEqual(["2026-10-13 09:00", "2026-10-13 15:00"]);
  });

  it("rings today, not at a past 8:00 or next week, when today is named with no time", () => {
    expect(show(p("thứ 6 tuần này nộp", FRIDAY).due)).toBe("2026-10-16 11:00");
    expect(show(p("hôm nay nộp báo cáo").due)).toBe("2026-10-12 11:00");
    expect(show(p("12/10 họp").due)).toBe("2026-10-12 11:00");
  });

  it("reads 'mai' typed in the small hours as the morning to come", () => {
    const night = at(2026, 10, 13, 0, 30);
    expect(show(p("mai 8h gọi mẹ", night).due)).toBe("2026-10-13 08:00");
    expect(show(p("2h đêm", at(2026, 10, 13, 1, 0)).due)).toBe("2026-10-13 02:00");
    expect(show(p("mai 8h gọi mẹ", at(2026, 10, 13, 9, 0)).due)).toBe("2026-10-14 08:00");
  });
});
