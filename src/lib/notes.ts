// What a person can do to a note, and how the list is arranged. Pure: the
// clock and the offset come in as arguments, so all of it is tested.
import { fold } from "../shared/fold";
import { parse, type Item, type Parsed } from "../shared/parse";
import type { Note, Tick } from "../shared/protocol";
import { latestOccurrence, nextOccurrence, type Rule, type Slot } from "../shared/recur";
import { ticksOff } from "../shared/ticks";
import { DAY, fromWall, HOUR, MINUTE, startOfDay, toWall } from "../shared/wall";

/**
 * The time an edit carries: now, but always after the version it was made
 * from. A note last written by a phone whose clock runs fast would
 * otherwise win against every later edit made here.
 */
export const stamp = (n: Note, now: number) => Math.max(now, n.updated + 1);

export function newNote(id: string, text: string, now: number, offset: number): Note {
  const p = parse(text, now, offset);
  return { id, text, title: p.title, items: p.items, tags: p.tags, due: p.due, rule: p.rule, nag: p.nag, done: null, pinned: false, deleted: false, created: now, updated: now, group: null, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [] };
}

/** A plain note from the whole line, when the person turned the reminder off before saving. */
export function plainNote(id: string, text: string, now: number, offset: number): Note {
  const n = newNote(id, text, now, offset);
  return { ...n, title: text.replace(/\s*!+\s*$/, "").trim(), due: null, rule: null, nag: false, items: n.items ? n.items : null };
}

/** The words a text gives its time with, as they read: what decides whether an edit touched the time. */
function timeWords(text: string, now: number, offset: number): string {
  const p = parse(text, now, offset);
  return p.spans
    .filter((s) => s.kind === "time")
    .map((s) => text.slice(s.s, s.e).toLowerCase().replace(/\s+/g, " ").trim())
    .join("|");
}

/**
 * The text changed: read again. Ticks survive for items still there.
 *
 * The time is read again only when its words changed. Read again from now,
 * "mai 8h" written yesterday became the day after tomorrow, "2 tiếng nữa"
 * two hours from the edit, so fixing a typo in the title moved the reminder
 * (Hải, 13/10/2026). Same words, same time: also a time put off by hand, or
 * a reminder dropped, stays as it was.
 */
export function editText(n: Note, text: string, now: number, offset: number): Note {
  const p = parse(text, now, offset);
  const ticked = new Map((n.items ?? []).map((i) => [fold(i.t), i.done]));
  const items: Item[] | null = p.items?.map((i) => ({ t: i.t, done: ticked.get(fold(i.t)) ?? false })) ?? null;
  const sameTime = timeWords(text, now, offset) === timeWords(n.text, now, offset);
  const when = sameTime ? { due: n.due, rule: n.rule } : { due: p.due, rule: p.rule };
  return { ...n, text, title: p.title, items, tags: p.tags, ...when, nag: p.nag, done: null, updated: stamp(n, now) };
}

/**
 * The text with its time words said anew. Time words that stand together
 * (only commas, "và", "từ", "đến" between them: "thứ 2 20h-20h30, thứ 4 và 7
 * 20h30-22h") become the new words as one; scattered, the first becomes
 * them and the rest go. No separator is left dangling.
 */
function sayTimeAnew(text: string, spans: Parsed["spans"], phrase: string): string {
  const junk = /^[\s,;&]*(?:(?:và|từ|đến|tới|lúc|vào)[\s,;&]*)*$/iu;
  const together = spans.every((s, i) => i === 0 || junk.test(text.slice(spans[i - 1]!.e, s.s)));
  let out = "";
  if (together) out = text.slice(0, spans[0]!.s) + phrase + text.slice(spans.at(-1)!.e);
  else {
    let pos = 0;
    spans.forEach((s, i) => {
      out += text.slice(pos, s.s) + (i === 0 ? phrase : "");
      pos = s.e;
    });
    out += text.slice(pos);
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.:;])/g, "$1")
    .replace(/(?:\s*[,;&])+\s*$/u, "")
    .trim();
}

/** "9h30 15/10", with the year when it is not this one: a time that reads the same on any day. */
export function timePhrase(at: number, now: number, offset: number): string {
  const w = toWall(at, offset);
  const mi = w.mi ? String(w.mi).padStart(2, "0") : "";
  return `${w.h}h${mi} ${w.d}/${w.mo}${w.y !== toWall(now, offset).y ? `/${w.y}` : ""}`;
}

/**
 * A new time picked by hand for a one-off note: its words say the new time
 * too, as a date that reads the same any day ("mai 8h gọi mẹ" moved to the
 * 15th at 9:30 reads "9h30 15/10 gọi mẹ"), so the text and the reminder
 * agree. Checked by reading it back: when that would read otherwise, the
 * words stay as they were (and editText still keeps the time). Repeating
 * notes keep their words; the move is this time only.
 */
export function retime(n: Note, at: number, now: number, offset: number): Note {
  const moved = snooze(n, at, now);
  if (n.rule) return moved;
  const spans = parse(n.text, now, offset).spans.filter((s) => s.kind === "time");
  if (!spans.length) return moved;
  const text = sayTimeAnew(n.text, spans, timePhrase(at, now, offset));
  const back = parse(text, now, offset);
  return back.due === at && back.rule === null && back.title === n.title ? { ...moved, text } : moved;
}

/**
 * A new name typed over the old: the old name's words in the text become
 * the new ones, the time words around them untouched, so the time stays.
 * Null when the name is not in the text as written: then the whole text is
 * the thing to edit.
 */
export function retitle(n: Note, title: string, now: number, offset: number): Note | null {
  const t = title.trim();
  const i = n.text.toLowerCase().indexOf(n.title.toLowerCase());
  if (!t || i < 0) return null;
  // The title is capitalized; the words in the text keep their own first letter.
  const lower = n.text[i] === n.text[i]!.toLowerCase();
  const words = lower ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  return editText(n, n.text.slice(0, i) + words + n.text.slice(i + n.title.length), now, offset);
}

/** A daily, weekly or several-times-a-week rule as the slots of its week, for the schedule editor; null for the others. */
export function slotsOf(rule: Rule | null): Slot[] | null {
  if (rule?.kind === "weekly") return rule.slots.map((s) => ({ ...s, wds: [...s.wds] }));
  if (rule?.kind === "week") return [{ wds: [rule.wd], h: rule.h, mi: rule.mi }];
  if (rule?.kind === "day") return [{ wds: [0, 1, 2, 3, 4, 5, 6], h: rule.h, mi: rule.mi }];
  return null;
}

/** Slots back into the plainest rule that says them: every day is "mỗi ngày", one day at one time a weekly rule. */
export function ruleOf(slots: Slot[]): Rule {
  const clean = slots
    .map((s) => ({ ...s, wds: [...new Set(s.wds)].sort((a, b) => a - b) }))
    .filter((s) => s.wds.length)
    .map(({ wds, h, mi, dur }) => (dur ? { wds, h, mi, dur } : { wds, h, mi }));
  const one = clean.length === 1 ? clean[0]! : null;
  if (one && !("dur" in one)) {
    if (one.wds.length === 7) return { kind: "day", h: one.h, mi: one.mi };
    if (one.wds.length === 1) return { kind: "week", wd: one.wds[0]!, h: one.h, mi: one.mi };
  }
  return { kind: "weekly", slots: clean };
}

const hm = (h: number, mi: number) => `${h}h${mi ? String(mi).padStart(2, "0") : ""}`;
/** Monday first, as said: "thứ 2,4,7", "thứ 7, chủ nhật". */
function daysPhrase(wds: number[]): string {
  const days = [...wds].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const nums = days.filter((d) => d !== 0).map((d) => String(d + 1));
  return [nums.length ? `thứ ${nums.join(",")}` : "", days.includes(0) ? "chủ nhật" : ""].filter(Boolean).join(", ");
}
const slotPhrase = (s: Slot) => `${daysPhrase(s.wds)} ${clockPhrase(s)}`;
/** "9h", "20h-20h30": a slot's time as typed. */
function clockPhrase(s: Slot): string {
  if (!s.dur) return hm(s.h, s.mi);
  const end = (s.h * 60 + s.mi + s.dur) % 1440;
  return `${hm(s.h, s.mi)}-${hm(Math.floor(end / 60), end % 60)}`;
}

/**
 * The words for a repeating rule, as the parser reads them back: "thứ 2
 * 20h-20h30, thứ 4,7 20h30-22h"; the same days at several times say the
 * days once: "mỗi ngày 9h, 18h", "mỗi thứ 2,4 9h, 18h".
 */
export function schedulePhrase(rule: Rule): string | null {
  if (rule.kind === "day") return `mỗi ngày ${hm(rule.h, rule.mi)}`;
  if (rule.kind === "week") return `mỗi ${daysPhrase([rule.wd])} ${hm(rule.h, rule.mi)}`;
  if (rule.kind === "weekly") {
    const days = rule.slots[0]!.wds;
    if (rule.slots.length > 1 && rule.slots.every((s) => s.wds.join() === days.join())) {
      return `mỗi ${days.length === 7 ? "ngày" : daysPhrase(days)} ${rule.slots.map(clockPhrase).join(", ")}`;
    }
    return rule.slots.length === 1 ? `mỗi ${slotPhrase(rule.slots[0]!)}` : rule.slots.map(slotPhrase).join(", ");
  }
  return null;
}

const ruleKey = (r: Rule | null) => JSON.stringify(r, (_, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));

/**
 * A new week for a repeating note, from the schedule editor: the rule
 * changes and the next time with it, and on one line the words follow
 * ("thứ 2 20h-20h30, thứ 4,7 20h30-22h"), checked by reading them back.
 * Written over several lines, the words stay: their time words are spread
 * between lines that would read as half a sentence each.
 */
export function reschedule(n: Note, slots: Slot[], now: number, offset: number): Note {
  const rule = ruleOf(slots);
  const next: Note = { ...n, rule, due: nextOccurrence(rule, now, offset), done: null, updated: stamp(n, now) };
  const phrase = schedulePhrase(rule);
  const spans = parse(n.text, now, offset).spans.filter((s) => s.kind === "time");
  if (!phrase || !spans.length || n.text.includes("\n")) return next;
  const text = sayTimeAnew(n.text, spans, phrase);
  const back = parse(text, now, offset);
  return ruleKey(back.rule) === ruleKey(rule) && back.title === n.title ? { ...next, text } : next;
}

/** The reminder dropped, and its time words with it: the text should not say a time nothing rings at. */
function dropTimeWords(n: Note, now: number, offset: number): Note {
  const dropped = dropReminder(n, now);
  const spans = parse(n.text, now, offset).spans.filter((s) => s.kind === "time");
  if (!spans.length) return dropped;
  const text = sayTimeAnew(n.text, spans, "");
  const back = parse(text, now, offset);
  return text && back.due === null && back.title === n.title ? { ...dropped, text } : dropped;
}

/** The edit screen's time: left alone, none, once at a time, or a week of sessions. */
export type WhenEdit = { kind: "keep" } | { kind: "none" } | { kind: "once"; at: number } | { kind: "repeat"; slots: Slot[] };
export interface NoteEdit {
  title: string;
  when: WhenEdit;
  nag: boolean;
  /** A group's note: whom it is for (a member's key, null everyone); left out for one's own. */
  assignee?: string | null;
  /** A group's note: each member ticks it off for themselves (a note for everyone only). */
  each?: boolean;
}

/** The "!" that asks for nhắc dai, where parse.ts looks for it: at the end, or before the tags that end the line. */
const BANG = /\s*!+(?=(?:\s*#[\p{L}\p{N}_-]{1,30})*\s*$)/u;

/**
 * The edit screen's answers, in order: the name (its words in the text),
 * then the time (written into the words: retime, reschedule, or taken out),
 * then nhắc dai (the "!" at the end, as typed). Each step keeps what the
 * others made, so the text still says what the note does, and editing the
 * sentence later reads the same.
 */
export function applyEdit(n: Note, e: NoteEdit, now: number, offset: number): Note {
  let out = n;
  const title = e.title.trim();
  // A name not in the words as written is still the name: the text follows on its next edit.
  if (title && title !== n.title) out = retitle(out, title, now, offset) ?? { ...out, title, updated: stamp(out, now) };
  if (e.when.kind === "none") out = dropTimeWords(out, now, offset);
  if (e.when.kind === "once") out = retime({ ...out, rule: null }, e.when.at, now, offset);
  if (e.when.kind === "repeat") out = reschedule(out, e.when.slots, now, offset);
  const nag = e.when.kind === "none" ? false : e.nag;
  if (nag !== out.nag) out = { ...out, text: nag ? `${out.text.trimEnd()}!` : out.text.replace(BANG, ""), nag, updated: stamp(out, now) };
  // Then whom it is for, and how it is ticked off: each for themselves only when it is for everyone.
  if (e.assignee !== undefined && e.assignee !== out.assignee) out = { ...out, assignee: e.assignee, updated: stamp(out, now) };
  if (e.each !== undefined) {
    const each = e.each && out.assignee === null;
    if (each !== out.each) out = { ...out, each, updated: stamp(out, now) };
  }
  return out;
}

const sameItems = (a: Item[] | null, b: Item[]) => (a ?? []).length === b.length && (a ?? []).every((x, i) => fold(x.t) === fold(b[i]!.t));

/**
 * The list changed in place: the text lists the new things too, from where
 * the first one stood to where the last did. Fewer than three left of a
 * list said aloud no longer reads as a list, so a colon keeps it one.
 */
function withItems(n: Note, items: Item[], now: number, offset: number): Note {
  const next = { ...n, items: items.length ? items : null, updated: stamp(n, now) };
  const old = n.items ?? [];
  const low = n.text.toLowerCase();
  const s = old.length ? low.indexOf(old[0]!.t.toLowerCase()) : -1;
  const last = old.length ? low.lastIndexOf(old.at(-1)!.t.toLowerCase()) : -1;
  if (s < 0 || last < s) return next;
  const head = n.text.slice(0, s);
  const tail = n.text.slice(last + old.at(-1)!.t.length);
  const joined = items.map((i) => i.t).join(", ");
  const plain = `${head}${joined}${tail}`;
  if (items.length && sameItems(parse(plain, now, offset).items, items)) return { ...next, text: plain };
  return { ...next, text: `${head.replace(/[\s:]+$/u, "")}${items.length ? `: ${joined}` : ""}${tail}` };
}

export function addItem(n: Note, t: string, now: number, offset: number): Note {
  const thing = t.trim();
  if (!thing) return n;
  return withItems(n, [...(n.items ?? []), { t: thing, done: false }], now, offset);
}

export function removeItem(n: Note, index: number, now: number, offset: number): Note {
  return withItems(n, (n.items ?? []).filter((_, i) => i !== index), now, offset);
}

/** A group's note each member ticks off for themselves (protocol Note.each). */
const eachTicks = (n: Note) => n.group !== null && n.each;

/**
 * When this person ticked it off: a group's "mỗi người tự bấm" note by
 * their own tick, any other by its `done`. A repeating one never is: each
 * time comes round for everyone again.
 */
export function doneAt(n: Note): number | null {
  if (!eachTicks(n)) return n.done;
  // Not a tap left from when it repeated: that one was for a time, not for this.
  return !n.rule && n.mine?.at != null && n.mine.occ === undefined ? n.mine.at : null;
}

/**
 * The note's time as it stands for this person: its `due`, except on a
 * repeating note each ticks off, whose `due` stays where it started (one
 * tap must not move it for the rest): there, the first time after the one
 * they last tapped Xong for.
 */
export function ownDue(n: Note, offset: number): number | null {
  if (n.due === null || !n.rule || !eachTicks(n) || !n.mine || n.mine.at === null) return n.due;
  return Math.max(n.due, nextOccurrence(n.rule, n.mine.occ ?? n.mine.at, offset));
}

/**
 * The latest time a repeating note came round, for everyone: the one whose
 * ticks the group is shown, when this person is already past it. null
 * before its first time.
 */
export function lastRound(n: Note, now: number, offset: number): number | null {
  if (!n.rule || n.due === null || n.due > now) return null;
  return latestOccurrence(n.rule, n.due, now, offset) ?? n.due;
}

/** Who has tapped Xong for the time at `occ`: on a one-off, everyone who did. */
export const ticksFor = (n: Note, occ: number, offset: number): Tick[] => n.ticks.filter((t) => ticksOff(t, n.rule, occ, offset));

/**
 * The time a note each ticks off shows the group's taps for: a one-off's
 * only one; a repeating one's, the time this person is at once it has come,
 * else the last that came round (null before its first).
 */
export function roundOf(n: Note, now: number, offset: number): number | null {
  if (!n.rule) return n.due ?? 0;
  const at = shownTime(n, now, offset);
  return at !== null && at <= now ? at : lastRound(n, now, offset);
}

/**
 * Who has tapped Xong for the time at `occ` (with when) and who not yet, of
 * a group's members: this person by their own tap as it stands here, sent
 * or not, the others as the server last said. Read from the server's list
 * alone, the tap just made showed as "chưa xong: bạn" until the next sync.
 */
export function tapsFor(n: Note, members: readonly { key: string; me: boolean }[], occ: number, offset: number): { done: Map<string, number>; missing: string[] } {
  const theirs = new Map(
    ticksFor(n, occ, offset)
      .filter((t) => !t.me)
      .map((t) => [t.key, t.at]),
  );
  const done = new Map<string, number>();
  const missing: string[] = [];
  for (const m of members) {
    const at = m.me ? (ticksOff(n.mine, n.rule, occ, offset) ? n.mine!.at! : undefined) : theirs.get(m.key);
    if (at === undefined) missing.push(m.key);
    else done.set(m.key, at);
  }
  return { done, missing };
}

/**
 * "Xong": a one-off is ticked off; a repeating one moves to its next time
 * after this one. Done ahead of time ("họp thứ 2" ticked on Sunday), this
 * one is skipped, not rung anyway.
 */
export function markDone(n: Note, now: number, offset: number): Note {
  // Each one ticks for themselves: only this person's tick changes, the note stays open for the rest.
  // On a repeating one, for the time they are at: the one come round, or ahead of it the next.
  if (eachTicks(n)) {
    const occ = n.rule ? shownTime(n, now, offset) : null;
    return { ...n, mine: occ === null ? { at: now, t: now } : { at: now, t: now, occ }, updated: stamp(n, now) };
  }
  // In a group the others see who did it: the time goes from here, the name from the server (protocol Note.by).
  const by = n.group ? { name: "", at: now } : n.by;
  if (n.rule) return { ...n, due: nextOccurrence(n.rule, Math.max(now, n.due ?? now), offset), updated: stamp(n, now), by };
  return { ...n, done: now, updated: stamp(n, now), by };
}

/**
 * One's own note put in a group ("Nhắc chung"): a copy there under a new id,
 * since the group's notes are the group's and an id is unique per owner;
 * the own one goes. Both go up in the same sync.
 */
export function intoGroup(n: Note, group: string, id: string, now: number): [moved: Note, gone: Note] {
  return [
    { ...n, id, group, by: null, each: false, ticks: [], mine: null, assignee: null, watch: null, watchers: [], created: now, updated: now },
    { ...n, deleted: true, updated: stamp(n, now) },
  ];
}

export const reopen = (n: Note, now: number): Note => (eachTicks(n) ? { ...n, mine: { at: null, t: now }, updated: stamp(n, now) } : { ...n, done: null, updated: stamp(n, now) });

/**
 * A change taken back ("Hoàn tác"): the note as it was, as an edit of its
 * own, later than the one it undoes, or the server would keep that one. The
 * person's own tick and "báo cho tôi" too, which the server keeps by their
 * own times: put back as they were, they would lose to the change they undo.
 */
export function undone(was: Note, cur: Note | undefined, now: number): Note {
  const out = { ...was, updated: Math.max(now, (cur?.updated ?? 0) + 1) };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (cur && !same(was.mine, cur.mine)) out.mine = { ...(was.mine ?? { at: null }), t: Math.max(now, (cur.mine?.t ?? 0) + 1) };
  if (cur && !same(was.watch, cur.watch)) out.watch = { on: was.watch?.on ?? false, t: Math.max(now, (cur.watch?.t ?? 0) + 1) };
  return out;
}

/**
 * How far one time of a repeating note may be put off: up to its next
 * time, not past it, or that time is lost ("9h, 18h uống thuốc" put off at
 * 9:05 to 20:00 skipped 18:00, since the next ring follows the one put off).
 * Null for a one-off: any time.
 */
export function putOffLimit(n: Note, now: number, offset: number): number | null {
  const shown = n.rule ? shownTime(n, now, offset) : null;
  return n.rule && shown !== null ? nextOccurrence(n.rule, Math.max(shown, now), offset) : null;
}

export const snooze = (n: Note, at: number, now: number): Note => ({ ...n, due: at, done: null, updated: stamp(n, now) });
export const dropReminder = (n: Note, now: number): Note => ({ ...n, due: null, rule: null, nag: false, updated: stamp(n, now) });
export const togglePin = (n: Note, now: number): Note => ({ ...n, pinned: !n.pinned, updated: stamp(n, now) });
export const remove = (n: Note, now: number): Note => ({ ...n, deleted: true, updated: stamp(n, now) });
export const restore = (n: Note, now: number): Note => ({ ...n, deleted: false, updated: stamp(n, now) });

export function toggleItem(n: Note, i: number, now: number): Note {
  if (!n.items?.[i]) return n;
  const items = n.items.map((it, k) => (k === i ? { ...it, done: !it.done } : it));
  return { ...n, items, updated: stamp(n, now) };
}

export interface SnoozeOption {
  label: string;
  at: number;
}

/** The quick choices for putting a reminder off, as of now. */
export function snoozeOptions(now: number, offset: number): SnoozeOption[] {
  const w = toWall(now, offset);
  const round = (t: number) => Math.ceil(t / MINUTE) * MINUTE;
  const tonight = fromWall(w.y, w.mo, w.d, 20, 0, offset);
  // Tapped before 4:00, the night is not over: "sáng mai" is the morning to come (shared/parse LATE_HOUR).
  const morning = fromWall(w.y, w.mo, w.d + (w.h < 4 ? 0 : 1), 8, 0, offset);
  return [
    // Under "Nhắc lại sau": "10 phút" reads as "in ten minutes"; "+10 phút" read as arithmetic.
    { label: "10 phút", at: round(now + 10 * MINUTE) },
    { label: "1 giờ", at: round(now + HOUR) },
    tonight - now > HOUR ? { label: "Tối nay 20:00", at: tonight } : { label: "3 giờ", at: round(now + 3 * HOUR) },
    { label: "Sáng mai 8:00", at: morning },
  ];
}

/**
 * The time to show for a note: its reminder, or for a repeating one nobody
 * answered, the latest time it came round (the one "đến giờ" now).
 */
export function shownTime(n: Note, now: number, offset: number): number | null {
  const due = ownDue(n, offset);
  if (due === null) return null;
  if (n.rule && due <= now) return latestOccurrence(n.rule, due, now, offset) ?? due;
  return due;
}

export interface Sections {
  /** Its time came and nobody answered: on top. */
  due: Note[];
  /**
   * Ticked off here, the rest of the group not yet (a one-off each ticks
   * off): kept in sight for a day after the tap, not folded away with the
   * done, which hid whether the others had (Hải, 14/10/2026).
   */
  waiting: Note[];
  today: Note[];
  tomorrow: Note[];
  /** After tomorrow, to the end of this week (Sunday). */
  week: Note[];
  /** After this week. */
  later: Note[];
  /** No reminder: pinned first, then newest. */
  plain: Note[];
  done: Note[];
}

export function matches(n: Note, q: string): boolean {
  if (!q) return true;
  const hay = fold([n.title, n.text, ...(n.items ?? []).map((i) => i.t), ...n.tags.map((t) => `#${t}`)].join(" "));
  return fold(q)
    .split(" ")
    .every((w) => hay.includes(w));
}

/** A group's members by its id, for whether the others have ticked a note off too. */
export type MembersOf = (group: string) => readonly { key: string; me: boolean }[] | undefined;

export function sections(all: Iterable<Note>, now: number, offset: number, query = "", tag: string | null = null, membersOf?: MembersOf): Sections {
  const out: Sections = { due: [], waiting: [], today: [], tomorrow: [], week: [], later: [], plain: [], done: [] };
  // Days from today to Sunday: the rest of this week, as a Vietnamese week runs Monday to Sunday.
  const toSunday = (7 - toWall(now, offset).wd) % 7;
  const at = new Map<string, number>();
  for (const n of all) {
    if (n.deleted || !matches(n, query) || (tag && !n.tags.includes(tag))) continue;
    const doneHere = doneAt(n);
    if (doneHere !== null) {
      const members = n.group !== null && n.each ? membersOf?.(n.group) : undefined;
      const others = members && now - doneHere < DAY ? tapsFor(n, members, 0, offset).missing.length : 0;
      (others > 0 ? out.waiting : out.done).push(n);
      continue;
    }
    const t = shownTime(n, now, offset);
    if (t === null) {
      out.plain.push(n);
      continue;
    }
    at.set(n.id, t);
    const d = Math.round((startOfDay(t, offset) - startOfDay(now, offset)) / DAY);
    (t <= now ? out.due : d === 0 ? out.today : d === 1 ? out.tomorrow : d <= toSunday ? out.week : out.later).push(n);
  }
  const byTime = (a: Note, b: Note) => at.get(a.id)! - at.get(b.id)!;
  for (const list of [out.due, out.today, out.tomorrow, out.week, out.later]) list.sort(byTime);
  out.plain.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created - a.created);
  for (const list of [out.waiting, out.done]) list.sort((a, b) => (doneAt(b) ?? 0) - (doneAt(a) ?? 0));
  return out;
}

/** Every tag in use, most used first. */
export function tagsInUse(all: Iterable<Note>): string[] {
  const count = new Map<string, number>();
  for (const n of all) if (!n.deleted) for (const t of n.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** The next reminder still to come, and when, for the app's own timer while it is open. */
export function nextDue(all: Iterable<Note>, now: number, offset: number): { note: Note; at: number } | null {
  let best: { note: Note; at: number } | null = null;
  for (const n of all) {
    const at = n.deleted || doneAt(n) !== null ? null : ownDue(n, offset);
    if (at === null || at <= now) continue;
    if (!best || at < best.at) best = { note: n, at };
  }
  return best;
}
