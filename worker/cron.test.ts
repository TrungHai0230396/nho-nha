import { describe, expect, it } from "vitest";
import { parse } from "../src/shared/parse";
import { fromWall, VN_OFFSET } from "../src/shared/wall";
import { alertPlan, digestMessage, floodMessage, reminderMessage, watchMessage, type Member } from "./cron";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => fromWall(y, mo, d, h, mi, VN_OFFSET);
const NOW = at(2026, 10, 13, 7, 0);

/** A note's row as the cron reads it, from what was typed. */
function rowOf(text: string, extra: Record<string, unknown> = {}) {
  const p = parse(text, NOW, VN_OFFSET);
  return {
    row: { id: "n1", text, title: p.title, items: p.items ? JSON.stringify(p.items) : null, rule: p.rule ? JSON.stringify(p.rule) : null, ...extra },
    due: p.due!,
    rule: p.rule,
  };
}

const ring = (text: string, n = 0, extra: Record<string, unknown> = {}) => {
  const { row, due, rule } = rowOf(text, extra);
  return reminderMessage(row, n, due, rule, VN_OFFSET);
};

describe("a reminder on the phone", () => {
  it("is the note alone when there is nothing more to say", () => {
    expect(ring("mai 8h gọi bác sĩ")).toEqual({ title: "Gọi bác sĩ", body: "", id: "n1", tag: "n1", act: true });
    // Repeating changes nothing on the phone: "lặp lại" was a word nobody acts on.
    expect(ring("mỗi ngày 21h uống thuốc").body).toBe("");
  });

  it("says what is left on a list", () => {
    expect(ring("8h đi chợ mua trứng, rau, muối")).toMatchObject({ title: "Đi chợ mua", body: "trứng, rau, muối" });
    const { row, due, rule } = rowOf("8h đi chợ mua trứng, rau, muối");
    row.items = JSON.stringify([
      { t: "trứng", done: true },
      { t: "rau", done: false },
      { t: "muối", done: false },
    ]);
    expect(reminderMessage(row, 0, due, rule, VN_OFFSET).body).toBe("rau, muối");
  });

  it("says the hours of a session, and nothing else", () => {
    expect(ring("T2, T4 19h-21h học tiếng Anh")).toMatchObject({ title: "Học tiếng Anh", body: "19:00–21:00" });
  });

  it("gives the line written under the note, without its tags", () => {
    expect(ring("8h họp phụ huynh\n\nmang sổ liên lạc #lớp", 0).body).toBe("mang sổ liên lạc");
    expect(ring("8h họp phụ huynh\n#lớp").body).toBe("");
  });

  it("says why it rings again, which is how to stop it", () => {
    expect(ring("30p nữa uống thuốc!", 2)).toMatchObject({ title: "Uống thuốc", body: "Nhắc lại vì chưa bấm Xong" });
    expect(ring("8h đi chợ mua trứng, rau, muối!", 1).body).toBe("Nhắc lại vì chưa bấm Xong");
  });

  it("cuts what is too long where the phone would, but says so", () => {
    const m = ring(`8h ${"rất ".repeat(40)}dài`);
    expect(m.title).toHaveLength(120);
    expect(m.title.endsWith("…")).toBe(true);
  });
});

describe("the morning list", () => {
  const note = (title: string, due: number, extra: Record<string, unknown> = {}) => ({ title, due, rule: null, fire_at: due, ...extra });

  it("is one reminder a line, hour first, in the order of the day", () => {
    const m = digestMessage([note("Học tiếng Anh", at(2026, 10, 13, 19)), note("Gọi bác sĩ", at(2026, 10, 13, 8))], NOW, VN_OFFSET);
    expect(m).toEqual({ title: "Hôm nay có 2 việc", body: "08:00 Gọi bác sĩ\n19:00 Học tiếng Anh", tag: "digest" });
  });

  it("counts the rest rather than letting the phone cut it, but never just one", () => {
    const day = (n: number) => Array.from({ length: n }, (_, i) => note(`Việc ${i + 1}`, at(2026, 10, 13, 8 + i)));
    expect(digestMessage(day(6), NOW, VN_OFFSET)?.body.split("\n")).toEqual(["08:00 Việc 1", "09:00 Việc 2", "10:00 Việc 3", "11:00 Việc 4", "Và 2 việc nữa"]);
    expect(digestMessage(day(5), NOW, VN_OFFSET)?.body.split("\n")).toHaveLength(5);
  });

  it("says last what went by unanswered, in the app's words", () => {
    const m = digestMessage([note("Học tiếng Anh", at(2026, 10, 13, 19)), note("Gặp khách", at(2026, 10, 12, 14))], NOW, VN_OFFSET);
    expect(m).toMatchObject({ title: "Hôm nay có 1 việc", body: "19:00 Học tiếng Anh\nCòn 1 việc đã qua giờ chưa xong" });
  });

  it("names them on a day with nothing set", () => {
    const m = digestMessage([note("Gặp khách", at(2026, 10, 12, 14)), note("Gọi bác sĩ", at(2026, 10, 11, 8))], NOW, VN_OFFSET);
    expect(m).toMatchObject({ title: "Còn 2 việc đã qua giờ chưa xong", body: "Gọi bác sĩ\nGặp khách" });
  });

  it("says nothing when there is nothing to say", () => {
    // A week gone is not this morning's business; neither is a repeating one that went by.
    const old = note("Gặp khách", at(2026, 10, 5, 14));
    const daily = note("Uống thuốc", at(2026, 10, 12, 21), { rule: "{}", fire_at: at(2026, 10, 14, 21) });
    expect(digestMessage([old, daily], NOW, VN_OFFSET)).toBeNull();
  });
});

describe("a reminder for one person in a group", () => {
  const group = { group_name: "Gia đình" };
  const solo = (text: string, n: number, watchers: string[]) => {
    const { row, due, rule } = rowOf(text, group);
    return reminderMessage(row, n, due, rule, VN_OFFSET, { solo: true, watchers });
  };

  it("says who waits on the tap, which is true: then they are not told", () => {
    expect(solo("21h uống thuốc", 0, ["Lan"]).body).toBe("Bấm Xong để Lan yên tâm");
    expect(solo("21h uống thuốc", 0, ["Lan", "Hải"]).body).toBe("Bấm Xong để Lan và Hải yên tâm");
    expect(solo("21h uống thuốc", 0, ["Lan", "Hải", "Minh"]).body).toBe("Bấm Xong để Lan, Hải và Minh yên tâm");
    // Nobody waiting: whose it is, as for any group's note.
    expect(solo("21h uống thuốc", 0, []).body).toBe("Nhóm Gia đình");
    // What helps with the note itself still comes first.
    expect(solo("21h uống thuốc\nuống 2 viên sau ăn", 0, ["Lan"]).body).toBe("uống 2 viên sau ăn");
  });

  it("rings again for that person's tap, not everyone's", () => {
    expect(solo("21h uống thuốc!", 1, ["Lan"]).body).toBe("Nhắc lại vì bạn chưa bấm Xong");
    expect(ring("21h uống thuốc!", 1, group).body).toBe("Nhắc lại vì chưa ai bấm Xong");
  });
});

describe("telling a watcher", () => {
  const row = (title: string) => ({ id: "n1", title });
  const occ = at(2026, 10, 13, 21, 0);

  it("names who has not tapped Xong, and on what: never what they did or did not do", () => {
    expect(watchMessage(row("Uống thuốc"), ["Bố"], occ, VN_OFFSET, occ + 30 * 60_000)).toEqual({ title: "Bố chưa bấm Xong", body: "Uống thuốc 21:00", id: "n1", tag: "watch:n1" });
  });

  it("says the day when it waited for the morning", () => {
    expect(watchMessage(row("Uống thuốc"), ["Bố"], occ, VN_OFFSET, at(2026, 10, 14, 6, 0)).body).toBe("Uống thuốc 21:00 hôm qua");
    expect(watchMessage(row("Uống thuốc"), ["Bố"], occ, VN_OFFSET, at(2026, 10, 16, 6, 0)).body).toBe("Uống thuốc 21:00 13/10");
  });

  it("counts several in one notification, not one each", () => {
    const m = watchMessage(row("Đi nhậu"), ["Tú", "Lan", "Minh"], at(2026, 10, 13, 19, 0), VN_OFFSET, at(2026, 10, 13, 19, 30));
    expect(m).toMatchObject({ title: "Còn 3 người chưa bấm Xong", body: "Đi nhậu 19:00 · Tú, Lan và Minh" });
  });
});

describe("a group past its rings for the hour", () => {
  it("says so once, and until when", () => {
    const m = floodMessage({ user_id: "g_x", group_name: "Lớp 12A", tz_offset: VN_OFFSET }, at(2026, 10, 13, 9, 41));
    expect(m).toEqual({ title: "Nhóm Lớp 12A có nhiều lời nhắc", body: "Gộp lại tới 10:00 cho đỡ phiền. Mở app để xem.", tag: "flood:g_x" });
  });
});

describe("the look half an hour after", () => {
  const OCC = at(2026, 10, 13, 21, 0);
  const LOOK = OCC + 30 * 60_000;
  const quiet = { from: 22, to: 6, offset: VN_OFFSET };
  const person = (user: string, key: string, name: string, extra: Partial<Member> = {}): Member => ({ user, key, name, muted: false, quiet: null, offset: VN_OFFSET, ...extra });
  const bo = person("u-bo", "key-bo-00001", "Bố");
  const lan = person("u-lan", "key-lan-0001", "Lan");
  const hai = person("u-hai", "key-hai-0001", "Hải", { quiet });
  const note = (extra: Record<string, unknown> = {}) => ({
    user_id: "g_family",
    id: "n1",
    title: "Uống thuốc",
    due: OCC,
    done: null,
    deleted: 0,
    each: 0,
    ticks: null,
    assignee: bo.key,
    watch: JSON.stringify({ "u-lan": { on: 1, t: 1 }, "u-hai": { on: 1, t: 1 } }),
    alert_at: LOOK,
    alert_occ: OCC,
    alert_wait: null,
    group_name: "Gia đình",
    ...extra,
  });

  it("tells each watcher awake now, once, and keeps the sleepy one for the morning", () => {
    const p = alertPlan(note(), [bo, lan, hai], at(2026, 10, 13, 22, 30));
    expect(p.tell.map((t) => [t.who.name, t.message.title])).toEqual([["Lan", "Bố chưa bấm Xong"]]);
    expect(p.wait).toEqual({ "u-hai": at(2026, 10, 14, 6, 0) });
    expect(p.at).toBe(at(2026, 10, 14, 6, 0));
    // The morning: Hải, if it is still not done; nobody twice.
    const morning = alertPlan(note({ alert_at: p.at, alert_wait: JSON.stringify(p.wait) }), [bo, lan, hai], at(2026, 10, 14, 6, 0));
    expect(morning.tell.map((t) => [t.who.name, t.message.body])).toEqual([["Hải", "Uống thuốc 21:00 hôm qua"]]);
    expect(morning.at).toBeNull();
  });

  it("tells nobody when it was done, put off, or deleted meanwhile", () => {
    for (const settled of [{ done: OCC + 60_000 }, { due: OCC + 10 * 60_000 }, { deleted: 1 }]) {
      const p = alertPlan(note(settled), [bo, lan, hai], LOOK);
      expect(p.tell, JSON.stringify(settled)).toEqual([]);
      expect(p.at).toBeNull();
    }
    // Done during the night: the morning's message goes nowhere.
    const p = alertPlan(note({ alert_wait: JSON.stringify({ "u-hai": at(2026, 10, 14, 6, 0) }), done: OCC + 3 * 3_600_000 }), [bo, lan, hai], at(2026, 10, 14, 6, 0));
    expect(p.tell).toEqual([]);
  });

  it("tells only those who asked, are listening, and are not the one it is for", () => {
    const muted = { ...lan, muted: true };
    expect(alertPlan(note(), [bo, muted], LOOK).tell).toEqual([]);
    expect(alertPlan(note({ watch: JSON.stringify({ "u-lan": { on: 0, t: 2 } }) }), [bo, lan], LOOK).tell).toEqual([]);
    expect(alertPlan(note({ watch: JSON.stringify({ "u-bo": { on: 1, t: 2 } }) }), [bo, lan], LOOK).tell).toEqual([]);
    // Its person gone from the group: nobody's alone, and nothing to tell.
    expect(alertPlan(note(), [lan], LOOK).tell).toEqual([]);
    // No longer a group's at all.
    expect(alertPlan(note({ group_name: null }), [bo, lan], LOOK)).toMatchObject({ at: null, tell: [] });
  });

  it("names, for a note each ticks off, everyone else still missing", () => {
    const tu = person("u-tu", "key-tu-00001", "Tú");
    const each = note({ assignee: null, each: 1, ticks: JSON.stringify({ "u-bo": { at: OCC, t: OCC } }), watch: JSON.stringify({ "u-lan": { on: 1, t: 1 } }) });
    const p = alertPlan(each, [bo, lan, tu], LOOK);
    // Lan herself is not on her own list.
    expect(p.tell.map((t) => [t.who.name, t.message.title, t.message.body])).toEqual([["Lan", "Tú chưa bấm Xong", "Uống thuốc 21:00"]]);
    // Only Lan herself left: nothing to tell her.
    const allBut = note({ assignee: null, each: 1, ticks: JSON.stringify({ "u-bo": { at: OCC, t: OCC }, "u-tu": { at: OCC, t: OCC } }) });
    expect(alertPlan(allBut, [bo, lan, tu], LOOK).tell).toEqual([]);
  });
});
