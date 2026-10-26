import { describe, expect, it } from "vitest";
import { fromWall, VN_OFFSET } from "../shared/wall";
import type { Note } from "../shared/protocol";
import { addItem, applyEdit, doneAt, dropReminder, editText, lastRound, markDone, matches, newNote, nextDue, plainNote, putOffLimit, remove, removeItem, reschedule, retime, retitle, ruleOf, schedulePhrase, sections, shownTime, slotsOf, snooze, snoozeOptions, tagsInUse, ticksFor, toggleItem, undone } from "./notes";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => fromWall(y, mo, d, h, mi, VN_OFFSET);
const NOW = at(2026, 10, 12, 10, 30);
let n = 0;
const note = (text: string, now = NOW) => newNote(`id-${String(++n).padStart(18, "0")}`, text, now, VN_OFFSET);

describe("actions", () => {
  it("'Xong' ticks a one-off and moves a repeating one on", () => {
    expect(markDone(note("mai 8h gọi mẹ"), NOW, VN_OFFSET).done).toBe(NOW);
    const daily = note("mỗi ngày 9h uống thuốc");
    const later = at(2026, 10, 15, 9, 5);
    const d = markDone(daily, later, VN_OFFSET);
    expect(d.done).toBeNull();
    expect(d.due).toBe(at(2026, 10, 16, 9, 0));
    // Ticked before its time: that one is skipped.
    const early = markDone(daily, at(2026, 10, 12, 20, 0), VN_OFFSET);
    expect(early.due).toBe(at(2026, 10, 14, 9, 0));
  });

  it("an edit always carries a later time than what it changed", () => {
    const fast = { ...note("ghi chú"), updated: NOW + 60_000 };
    expect(snooze(fast, NOW + 600_000, NOW).updated).toBe(NOW + 60_001);
  });

  it("editing the text reads it again and keeps the ticks of items still there", () => {
    const list = toggleItem(note("đi chợ: trứng, sữa, rau"), 1, NOW);
    const edited = editText(list, "mai 7h đi chợ: trứng, Sữa, cá", NOW, VN_OFFSET);
    expect(edited.items).toEqual([
      { t: "trứng", done: false },
      { t: "Sữa", done: true },
      { t: "cá", done: false },
    ]);
    expect(edited.due).toBe(at(2026, 10, 13, 7, 0));
  });

  it("an edit that leaves the time words alone leaves the time alone", () => {
    // Written on the 12th; the typo fixed early on the 13th. Read again from then, "mai"
    // was the 14th and "2 tiếng nữa" 9:00 the next morning.
    const next = at(2026, 10, 13, 7, 0);
    const call = note("mai 8h gọi mẹ");
    expect(editText(call, "mai 8h gọi mẹ nhé", next, VN_OFFSET).due).toBe(at(2026, 10, 13, 8, 0));
    const wash = note("2 tiếng nữa lấy đồ giặt");
    expect(editText(wash, "2 tiếng nữa lấy đồ giặt ở tiệm", next, VN_OFFSET).due).toBe(wash.due);
    // A time put off by hand, or a reminder dropped, stays so too.
    const moved = snooze(call, at(2026, 10, 13, 10, 0), NOW);
    expect(editText(moved, "mai 8h gọi điện cho mẹ", next, VN_OFFSET).due).toBe(at(2026, 10, 13, 10, 0));
    const dropped = dropReminder(call, NOW);
    expect(editText(dropped, "mai 8h gọi điện cho mẹ", next, VN_OFFSET)).toMatchObject({ due: null, rule: null });
  });

  it("changing the time words reads the time again, from now", () => {
    const next = at(2026, 10, 13, 7, 0);
    const call = note("mai 8h gọi mẹ");
    expect(editText(call, "mai 9h gọi mẹ", next, VN_OFFSET).due).toBe(at(2026, 10, 14, 9, 0));
    expect(editText(call, "gọi mẹ", next, VN_OFFSET)).toMatchObject({ due: null, rule: null });
    const weekly = editText(call, "mỗi thứ 2 8h gọi mẹ", next, VN_OFFSET);
    expect(weekly.rule).toEqual({ kind: "week", wd: 1, h: 8, mi: 0 });
  });

  it("a time picked by hand is written into the words, as a date that reads the same any day", () => {
    const moved = retime(note("mai 8h gọi mẹ"), at(2026, 10, 15, 9, 30), NOW, VN_OFFSET);
    expect(moved).toMatchObject({ text: "9h30 15/10 gọi mẹ", title: "Gọi mẹ", due: at(2026, 10, 15, 9, 30) });
    // So a typo fixed later keeps it, and the words agree with the reminder.
    expect(editText(moved, "9h30 15/10 gọi mẹ nhé", at(2026, 10, 14, 7, 0), VN_OFFSET).due).toBe(at(2026, 10, 15, 9, 30));
    expect(retime(note("thứ 6 tuần sau nộp báo cáo!"), at(2026, 10, 22, 8, 0), NOW, VN_OFFSET)).toMatchObject({ text: "8h 22/10 nộp báo cáo!", nag: true });
    expect(retime(note("đi chợ mai 9h: trứng, sữa, rau #nhà"), at(2026, 10, 13, 10, 0), NOW, VN_OFFSET).text).toBe("đi chợ 10h 13/10: trứng, sữa, rau #nhà");
  });

  it("a repeating note, or one with no time words, keeps its words when moved", () => {
    const daily = note("mỗi ngày 9h uống thuốc");
    expect(retime(daily, at(2026, 10, 12, 11, 0), NOW, VN_OFFSET)).toMatchObject({ text: "mỗi ngày 9h uống thuốc", due: at(2026, 10, 12, 11, 0) });
    expect(retime(note("ý tưởng quà cho mẹ"), at(2026, 10, 20, 9, 0), NOW, VN_OFFSET).text).toBe("ý tưởng quà cho mẹ");
  });

  it("a new name replaces the old one's words and leaves the time alone", () => {
    const call = note("mai 8h gọi mẹ");
    const renamed = retitle(call, "Gọi điện hỏi thăm mẹ", at(2026, 10, 13, 7, 0), VN_OFFSET)!;
    expect(renamed).toMatchObject({ text: "mai 8h gọi điện hỏi thăm mẹ", title: "Gọi điện hỏi thăm mẹ", due: call.due });
    expect(retitle(call, "  ", NOW, VN_OFFSET)).toBeNull();
  });

  it("things added to a list and taken off it, in the text too", () => {
    const list = toggleItem(note("đi chợ: trứng, sữa"), 0, NOW);
    const more = addItem(list, "muối", NOW, VN_OFFSET);
    expect(more).toMatchObject({ text: "đi chợ: trứng, sữa, muối", items: [{ t: "trứng", done: true }, { t: "sữa", done: false }, { t: "muối", done: false }] });
    // Said aloud, three things made it a list; with two left a colon keeps it one.
    const said = note("đi chợ mua cá, đường, muối");
    const fewer = removeItem(said, 2, NOW, VN_OFFSET);
    expect(fewer).toMatchObject({ text: "đi chợ mua: cá, đường", items: [{ t: "cá" }, { t: "đường" }] });
    expect(editText(fewer, `${fewer.text}, muối`, NOW, VN_OFFSET).items?.map((i) => i.t)).toEqual(["cá", "đường", "muối"]);
    expect(removeItem(removeItem(more, 2, NOW, VN_OFFSET), 1, NOW, VN_OFFSET)).toMatchObject({ text: "đi chợ: trứng", items: [{ t: "trứng", done: true }] });
  });

  it("a week of classes, edited slot by slot, and its words with it", () => {
    const english = note("học tiếng Anh thứ 2 20h-20h30, thứ 4 và 7 20h30-22h");
    const slots = slotsOf(english.rule)!;
    expect(slots).toEqual([
      { wds: [1], h: 20, mi: 0, dur: 30 },
      { wds: [3, 6], h: 20, mi: 30, dur: 90 },
    ]);
    // Wednesday moves to Friday, Monday starts at 19:30.
    const edited = reschedule(english, [{ ...slots[0]!, h: 19, mi: 30, dur: 60 }, { ...slots[1]!, wds: [5, 6] }], NOW, VN_OFFSET);
    expect(edited.rule).toEqual({ kind: "weekly", slots: [{ wds: [1], h: 19, mi: 30, dur: 60 }, { wds: [5, 6], h: 20, mi: 30, dur: 90 }] });
    expect(edited.text).toBe("học tiếng Anh thứ 2 19h30-20h30, thứ 6,7 20h30-22h");
    expect(edited.due).toBe(at(2026, 10, 12, 19, 30));
    // And a slot added.
    const more = reschedule(edited, [...slotsOf(edited.rule)!, { wds: [0], h: 9, mi: 0 }], NOW, VN_OFFSET);
    expect(more.text).toBe("học tiếng Anh thứ 2 19h30-20h30, thứ 6,7 20h30-22h, chủ nhật 9h");
  });

  it("slots back into the plainest rule, and words the parser reads back", () => {
    expect(ruleOf([{ wds: [0, 1, 2, 3, 4, 5, 6], h: 7, mi: 0 }])).toEqual({ kind: "day", h: 7, mi: 0 });
    expect(ruleOf([{ wds: [4], h: 19, mi: 0 }])).toEqual({ kind: "week", wd: 4, h: 19, mi: 0 });
    expect(ruleOf([{ wds: [6, 0, 6], h: 9, mi: 0 }, { wds: [], h: 8, mi: 0 }])).toEqual({ kind: "weekly", slots: [{ wds: [0, 6], h: 9, mi: 0 }] });
    expect(schedulePhrase({ kind: "weekly", slots: [{ wds: [0, 6], h: 9, mi: 0 }] })).toBe("mỗi thứ 7, chủ nhật 9h");
    // A daily one and a weekly one, edited, still say so.
    const pills = reschedule(note("mỗi sáng 7h uống thuốc"), [{ wds: [0, 1, 2, 3, 4, 5, 6], h: 6, mi: 30 }], NOW, VN_OFFSET);
    expect(pills).toMatchObject({ rule: { kind: "day", h: 6, mi: 30 }, text: "mỗi ngày 6h30 uống thuốc" });
    const swim = reschedule(note("thứ 2 hằng tuần 19h học bơi"), [{ wds: [2, 4], h: 19, mi: 0 }], NOW, VN_OFFSET);
    expect(swim).toMatchObject({ text: "mỗi thứ 3,5 19h học bơi", title: "Học bơi" });
  });

  it("several times a day, edited: the days said once, and read back the same", () => {
    const pills = note("9h, 18h hằng ngày uống thuốc");
    const every = [0, 1, 2, 3, 4, 5, 6];
    const edited = reschedule(pills, [{ wds: every, h: 8, mi: 0 }, { wds: every, h: 20, mi: 30 }], NOW, VN_OFFSET);
    expect(edited).toMatchObject({ text: "mỗi ngày 8h, 20h30 uống thuốc", title: "Uống thuốc" });
    expect(edited.rule).toEqual({ kind: "weekly", slots: [{ wds: every, h: 8, mi: 0 }, { wds: every, h: 20, mi: 30 }] });
    expect(schedulePhrase({ kind: "weekly", slots: [{ wds: [1, 3], h: 9, mi: 0 }, { wds: [1, 3], h: 18, mi: 0, dur: 60 }] })).toBe("mỗi thứ 2,4 9h, 18h-19h");
  });

  it("written over several lines, the words stay and the rule changes", () => {
    const lines = note("mỗi thứ 2,4,7 học tiếng anh\nthứ 2 học từ 20h đến 20h30\n4,7 học từ 20h30 đến 22h");
    const edited = reschedule(lines, [{ wds: [1, 3], h: 20, mi: 0, dur: 60 }], NOW, VN_OFFSET);
    expect(edited.text).toBe(lines.text);
    expect(edited.rule).toEqual({ kind: "weekly", slots: [{ wds: [1, 3], h: 20, mi: 0, dur: 60 }] });
  });

  it("the edit screen: a new name and a new time, both in the words", () => {
    const call = note("mai 8h gọi mẹ");
    const out = applyEdit(call, { title: "Gọi điện cho mẹ", when: { kind: "once", at: at(2026, 10, 15, 9, 30) }, nag: false }, NOW, VN_OFFSET);
    expect(out).toMatchObject({ title: "Gọi điện cho mẹ", text: "9h30 15/10 gọi điện cho mẹ", due: at(2026, 10, 15, 9, 30), rule: null });
    // Only the name: the time stays.
    expect(applyEdit(call, { title: "Gọi mẹ hỏi thăm", when: { kind: "keep" }, nag: false }, NOW, VN_OFFSET)).toMatchObject({ text: "mai 8h gọi mẹ hỏi thăm", due: call.due });
  });

  it("the edit screen: once, repeating, or not at all, whichever it was before", () => {
    const pills = note("mỗi ngày 7h uống thuốc");
    expect(applyEdit(pills, { title: "Uống thuốc", when: { kind: "once", at: at(2026, 10, 15, 9, 0) }, nag: false }, NOW, VN_OFFSET)).toMatchObject({ text: "9h 15/10 uống thuốc", rule: null, due: at(2026, 10, 15, 9, 0) });
    const call = note("mai 8h gọi mẹ");
    expect(applyEdit(call, { title: "Gọi mẹ", when: { kind: "repeat", slots: [{ wds: [1], h: 8, mi: 0 }] }, nag: false }, NOW, VN_OFFSET)).toMatchObject({ text: "mỗi thứ 2 8h gọi mẹ", rule: { kind: "week", wd: 1, h: 8, mi: 0 } });
    expect(applyEdit(call, { title: "Gọi mẹ", when: { kind: "none" }, nag: true }, NOW, VN_OFFSET)).toMatchObject({ text: "gọi mẹ", due: null, rule: null, nag: false });
  });

  it("the edit screen: nhắc dai on and off, as a '!' in the words", () => {
    const call = note("mai 8h gọi mẹ #nhà");
    const loud = applyEdit(call, { title: "Gọi mẹ", when: { kind: "keep" }, nag: true }, NOW, VN_OFFSET);
    expect(loud).toMatchObject({ text: "mai 8h gọi mẹ #nhà!", nag: true, tags: ["nhà"] });
    expect(applyEdit(loud, { title: "Gọi mẹ", when: { kind: "keep" }, nag: false }, NOW, VN_OFFSET)).toMatchObject({ text: "mai 8h gọi mẹ #nhà", nag: false });
  });

  it("a note saved with its reminder turned off keeps the whole line", () => {
    const p = plainNote("x".repeat(22), "mai 8h gọi mẹ!", NOW, VN_OFFSET);
    expect([p.title, p.due, p.nag]).toEqual(["mai 8h gọi mẹ", null, false]);
  });

  it("offers ways to put off that still lie ahead", () => {
    expect(snoozeOptions(at(2026, 10, 12, 10, 30), VN_OFFSET).map((o) => o.label)).toEqual(["10 phút", "1 giờ", "Tối nay 20:00", "Sáng mai 8:00"]);
    expect(snoozeOptions(at(2026, 10, 12, 19, 30), VN_OFFSET).map((o) => o.label)).toEqual(["10 phút", "1 giờ", "3 giờ", "Sáng mai 8:00"]);
    // Tapped at 0:30, "sáng mai" is the morning to come, not the one after.
    expect(snoozeOptions(at(2026, 10, 13, 0, 30), VN_OFFSET).at(-1)!.at).toBe(at(2026, 10, 13, 8, 0));
  });

  it("puts off one time of a repeating note no further than the next time", () => {
    const n = newNote("pills", "9h, 18h hằng ngày uống thuốc", at(2026, 10, 12, 7, 0), VN_OFFSET);
    expect(putOffLimit(n, at(2026, 10, 12, 9, 5), VN_OFFSET)).toBe(at(2026, 10, 12, 18, 0));
    expect(putOffLimit(newNote("once", "mai 8h gọi mẹ", at(2026, 10, 12, 7, 0), VN_OFFSET), at(2026, 10, 12, 9, 5), VN_OFFSET)).toBeNull();
    expect(snoozeOptions(at(2026, 10, 12, 19, 30), VN_OFFSET)[3]!.at).toBe(at(2026, 10, 13, 8, 0));
  });
});

describe("the list", () => {
  it("puts each note where it belongs", () => {
    const missed = note("8h sáng nay uống thuốc"); // 08:00 today, gone by 10:30
    const soon = note("14h gặp khách");
    const tomorrow = note("mai 8h gọi mẹ");
    const plain = note("Ý tưởng: app ghi chú");
    const pinned = { ...note("Mật khẩu wifi"), pinned: true, created: NOW - 99 };
    const finished = markDone(note("20h xem phim"), NOW, VN_OFFSET);
    const gone = remove(note("đã xoá"), NOW);
    const s = sections([missed, soon, tomorrow, plain, pinned, finished, gone], NOW, VN_OFFSET);
    expect(s.due.map((x) => x.title)).toEqual(["Uống thuốc"]);
    expect(s.today.map((x) => x.title)).toEqual(["Gặp khách"]);
    expect(s.tomorrow.map((x) => x.title)).toEqual(["Gọi mẹ"]);
    expect(s.later).toEqual([]);
    expect(s.plain.map((x) => x.title)).toEqual(["Mật khẩu wifi", "Ý tưởng: app ghi chú"]);
    expect(s.done.map((x) => x.title)).toEqual(["Xem phim"]);
  });

  it("groups what is ahead by tomorrow, the rest of this week, and after", () => {
    // NOW is Monday 12/10: this week runs to Sunday 18/10.
    const s = sections([note("thứ 6 nộp báo cáo"), note("chủ nhật đi lễ"), note("thứ 2 tuần sau họp"), note("mai 8h gọi mẹ")], NOW, VN_OFFSET);
    expect(s.tomorrow.map((x) => x.title)).toEqual(["Gọi mẹ"]);
    expect(s.week.map((x) => x.title)).toEqual(["Nộp báo cáo", "Đi lễ"]);
    expect(s.later.map((x) => x.title)).toEqual(["Họp"]);
    // On a Sunday, this week is over: tomorrow, then later.
    const sunday = at(2026, 10, 18, 10, 0);
    const t = sections([note("thứ 3 họp", sunday)], sunday, VN_OFFSET);
    expect([t.week.length, t.later.length]).toEqual([0, 1]);
  });

  it("shows a repeating one at the time it last came round", () => {
    const daily = note("mỗi ngày 9h uống thuốc"); // first: 13/10 09:00
    const thursday = at(2026, 10, 15, 10, 0);
    expect(shownTime(daily, thursday, VN_OFFSET)).toBe(at(2026, 10, 15, 9, 0));
    expect(sections([daily], thursday, VN_OFFSET).due).toHaveLength(1);
  });

  it("finds notes typed without accents, by every word", () => {
    const x = note("mai 8h nộp báo cáo quý #congviec");
    expect(matches(x, "bao cao")).toBe(true);
    expect(matches(x, "QUY bao")).toBe(true);
    expect(matches(x, "#congviec")).toBe(true);
    expect(matches(x, "hop")).toBe(false);
    expect(sections([x, note("đi chợ")], NOW, VN_OFFSET, "", "congviec").tomorrow).toHaveLength(1);
  });

  it("lists tags by use", () => {
    expect(tagsInUse([note("a #nha"), note("b #congviec #nha"), note("c #congviec #nha")])).toEqual(["nha", "congviec"]);
  });

  it("knows the next reminder for the open app's own timer", () => {
    const a = note("14h gặp khách");
    const b = note("11h gọi điện");
    expect(nextDue([a, b, note("ghi chú")], NOW, VN_OFFSET)?.note.id).toBe(b.id);
  });
});

describe("a group's note, edited", () => {
  const base = { ...note("mai 19h đi nhậu"), group: "g_AbCdEfGhIjKlMnOpQrStUv" };
  const keep = { title: base.title, when: { kind: "keep" } as const, nag: false };

  it("is changed to each ticking for themselves, and back", () => {
    const each = applyEdit(base, { ...keep, assignee: null, each: true }, NOW + 1, VN_OFFSET);
    expect(each.each).toBe(true);
    expect(each.updated).toBeGreaterThan(base.updated);
    expect(applyEdit(each, { ...keep, assignee: null, each: false }, NOW + 2, VN_OFFSET).each).toBe(false);
  });

  it("is ticked by each only when it is for everyone, once or repeating", () => {
    expect(applyEdit(base, { ...keep, assignee: "key-bo-00001", each: true }, NOW + 1, VN_OFFSET)).toMatchObject({ assignee: "key-bo-00001", each: false });
    const weekly = applyEdit(base, { ...keep, when: { kind: "repeat", slots: [{ wds: [1], h: 19, mi: 0 }] }, assignee: null, each: true }, NOW + 1, VN_OFFSET);
    expect(weekly.rule).not.toBeNull();
    expect(weekly.each).toBe(true);
  });

  it("leaves one's own note's group fields alone", () => {
    const own = note("mai 19h đi nhậu");
    expect(applyEdit(own, { title: own.title, when: { kind: "keep" }, nag: false }, NOW + 1, VN_OFFSET)).toBe(own);
  });
});

describe("a repeating note each ticks off for themselves", () => {
  // "9h, 18h hằng ngày uống thuốc" in the family, written on the 12th at 8:00: each person, each dose.
  const G = "g_AbCdEfGhIjKlMnOpQrStUv";
  const made = at(2026, 10, 12, 8);
  const meds: Note = { ...note("9h, 18h hằng ngày uống thuốc", made), group: G, each: true };
  const lan = (occ: number, t: number) => ({ key: "key-lan-0001", name: "Lan", at: t, me: false, occ });

  it("starts at its first time, and nobody's tap moves the note itself", () => {
    expect(meds.due).toBe(at(2026, 10, 12, 9));
    const mine = markDone(meds, at(2026, 10, 12, 9, 5), VN_OFFSET);
    expect(mine.mine).toEqual({ at: at(2026, 10, 12, 9, 5), t: at(2026, 10, 12, 9, 5), occ: at(2026, 10, 12, 9) });
    expect(mine.due).toBe(meds.due);
    expect(mine.done).toBeNull();
    // Never "done": the evening dose comes for this person too.
    expect(doneAt(mine)).toBeNull();
    expect(shownTime(mine, at(2026, 10, 12, 9, 6), VN_OFFSET)).toBe(at(2026, 10, 12, 18));
  });

  it("stands in the list where this person is: due until they tap, then at their next time", () => {
    const now = at(2026, 10, 12, 9, 30);
    expect(sections([meds], now, VN_OFFSET).due).toHaveLength(1);
    const mine = markDone(meds, now, VN_OFFSET);
    const s = sections([mine], now, VN_OFFSET);
    expect([s.due.length, s.today.length, s.done.length]).toEqual([0, 1, 0]);
    // The evening comes round: due again, for the one who took the morning dose too.
    expect(shownTime(mine, at(2026, 10, 12, 18, 5), VN_OFFSET)).toBe(at(2026, 10, 12, 18));
    expect(sections([mine], at(2026, 10, 12, 18, 5), VN_OFFSET).due).toHaveLength(1);
    // A day missed: it is the latest time that is due, not the first one missed.
    expect(shownTime(mine, at(2026, 10, 14, 10), VN_OFFSET)).toBe(at(2026, 10, 14, 9));
  });

  it("skips the next time when tapped ahead of it", () => {
    const morning = markDone(meds, at(2026, 10, 12, 9, 5), VN_OFFSET);
    const ahead = markDone(morning, at(2026, 10, 12, 12), VN_OFFSET);
    expect(ahead.mine?.occ).toBe(at(2026, 10, 12, 18));
    expect(shownTime(ahead, at(2026, 10, 12, 12), VN_OFFSET)).toBe(at(2026, 10, 13, 9));
  });

  it("keeps a tap when someone else puts the time off: it is the same dose, rung later", () => {
    const mine = markDone(meds, at(2026, 10, 12, 9, 5), VN_OFFSET);
    // Put off for everyone to 9:15 by someone who has not taken it.
    const later = snooze(mine, at(2026, 10, 12, 9, 15), at(2026, 10, 12, 9, 6));
    expect(shownTime(later, at(2026, 10, 12, 9, 20), VN_OFFSET)).toBe(at(2026, 10, 12, 18));
    // For one who never tapped, it is 9:15 now.
    expect(shownTime({ ...later, mine: null }, at(2026, 10, 12, 9, 20), VN_OFFSET)).toBe(at(2026, 10, 12, 9, 15));
  });

  it("counts the others' taps for the time they were for", () => {
    const n = { ...meds, ticks: [lan(at(2026, 10, 12, 9), at(2026, 10, 12, 9, 2))] };
    expect(ticksFor(n, at(2026, 10, 12, 9), VN_OFFSET).map((t) => t.name)).toEqual(["Lan"]);
    expect(ticksFor(n, at(2026, 10, 12, 18), VN_OFFSET)).toEqual([]);
    expect(lastRound(n, at(2026, 10, 12, 17), VN_OFFSET)).toBe(at(2026, 10, 12, 9));
    expect(lastRound(n, at(2026, 10, 12, 8, 30), VN_OFFSET)).toBeNull();
  });

  it("is quick about a note that started years ago", () => {
    const old = { ...meds, due: at(2016, 1, 1, 9) };
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) shownTime(old, at(2026, 10, 14, 10), VN_OFFSET);
    expect(shownTime(old, at(2026, 10, 14, 10), VN_OFFSET)).toBe(at(2026, 10, 14, 9));
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("knows this person's own next time for the open app's timer", () => {
    const mine = markDone(meds, at(2026, 10, 12, 9, 5), VN_OFFSET);
    expect(nextDue([mine], at(2026, 10, 12, 9, 6), VN_OFFSET)?.at).toBe(at(2026, 10, 12, 18));
  });

  it("is untapped again by Hoàn tác, later than the tap, so the server takes it", () => {
    const mine = markDone(meds, at(2026, 10, 12, 9, 5), VN_OFFSET);
    const back = undone(meds, mine, at(2026, 10, 12, 9, 5));
    expect(back.mine).toEqual({ at: null, t: at(2026, 10, 12, 9, 5) + 1 });
    expect(back.updated).toBeGreaterThan(mine.updated);
    expect(shownTime(back, at(2026, 10, 12, 9, 6), VN_OFFSET)).toBe(at(2026, 10, 12, 9));
    // Taken back to an earlier tap: that one, as it was.
    const second = markDone(markDone(meds, at(2026, 10, 12, 9, 5), VN_OFFSET), at(2026, 10, 12, 18, 1), VN_OFFSET);
    expect(undone(mine, second, at(2026, 10, 12, 18, 2)).mine).toMatchObject({ at: at(2026, 10, 12, 9, 5), occ: at(2026, 10, 12, 9) });
  });

  it("does not count a tap for a time once the note is a one-off, nor the other way round past its time", () => {
    const tapped = markDone(meds, at(2026, 10, 12, 9, 5), VN_OFFSET);
    // Made a one-off: the tap was for the 9:00 dose, not for this.
    expect(doneAt({ ...tapped, rule: null, due: at(2026, 10, 13, 20) })).toBeNull();
    // A one-off's tap at 9:05, the note made daily after: it covers the times up to it.
    const once = { ...meds, mine: { at: at(2026, 10, 12, 9, 5), t: at(2026, 10, 12, 9, 5) } };
    expect(shownTime(once, at(2026, 10, 12, 9, 6), VN_OFFSET)).toBe(at(2026, 10, 12, 18));
  });

  it("is still one tap for everyone when not each for themselves", () => {
    const shared = { ...meds, each: false };
    const d = markDone(shared, at(2026, 10, 12, 9, 5), VN_OFFSET);
    expect(d.due).toBe(at(2026, 10, 12, 18));
    expect(d.mine).toBeNull();
  });
});
