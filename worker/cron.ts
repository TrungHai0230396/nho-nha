// Every minute (wrangler.jsonc "triggers"): ring the reminders whose time
// has come, tell those who asked when one was left undone, and send each
// person's morning list at their hour.
import { andList, clock, clockRange } from "../src/shared/describe";
import type { PushMessage } from "../src/shared/protocol";
import { durationAt, readRule, type Rule } from "../src/shared/recur";
import { ticksOff, type OwnTick } from "../src/shared/ticks";
import { DAY, dayDiff, fromWall, HOUR, MINUTE, startOfDay, toWall } from "../src/shared/wall";
import { sweepDevices } from "./devices";
import { GROUP_RINGS_PER_HOUR, ringWindow } from "./groups";
import { sweepGuests } from "./guest";
import { afterPush, NAGS } from "./notes";
import { sendAll, subsOf, type SendDeps, type Sub } from "./push";
import { asleep, quietOf, wakeAt, type Quiet } from "./quiet";
import type { Row, Sql } from "./sql";
import type { Vapid } from "./webpush";

/**
 * Pushes per run. The free plan allows a run 50 requests out and little
 * CPU (each push is a key exchange, encryption and a request); whatever
 * does not fit waits for the next minute. PUSH_CAP raises it on a paid plan.
 */
export const PUSH_CAP = 40;
/** Rows looked at per run, a little more than PUSH_CAP can use. */
const ROWS = 60;
/** The morning list counts what went by unanswered in the last week. */
const MISSED_WINDOW = 7 * DAY;
/**
 * "Báo cho tôi nếu chưa xong": this long after its time, the one it is for
 * has still not tapped Xong. Long enough to have been rung a few times, short
 * enough to still call them about it.
 */
export const ALERT_AFTER_MS = 30 * MINUTE;

export interface CronDeps {
  sql: Sql;
  now: number;
  vapid: Vapid | null;
  subject: string;
  fetch: typeof fetch;
  /** Pushes this run may send (PUSH_CAP unless the Worker's env says otherwise). */
  cap?: number;
}

// A note is a person's or a group's (migrations/0003): whichever its owner is, by its clock.
const DUE_SQL = `SELECT n.user_id, n.id, n.text, n.title, n.items, n.rule, n.nag, n.occ, n.nags_left, n.fire_at, n.each, n.ticks,
    n.assignee, n.watch, COALESCE(u.tz_offset, g.tz_offset, 420) AS tz_offset, g.name AS group_name, g.ring_win, g.ring_n
  FROM notes n LEFT JOIN users u ON u.id = n.user_id LEFT JOIN groups g ON g.id = n.user_id
  WHERE n.fire_at IS NOT NULL AND n.fire_at <= ?1 ORDER BY n.fire_at LIMIT ?2`;
const MEMBERS_SQL = `SELECT m.group_id, m.user_id, m.key, m.name, m.muted, u.tz_offset, u.quiet_from, u.quiet_to
  FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id IN (SELECT value FROM json_each(?1))`;
// Only if nobody changed the note meanwhile (tapped "Xong" while it rang): their change already planned what comes next.
// A row that carries `alert_at` starts the look at whether this occurrence gets done; the others keep theirs.
const REPLAN_SQL = `UPDATE notes SET fire_at = json_extract(j.value, '$.fire_at'), occ = json_extract(j.value, '$.occ'),
    nags_left = json_extract(j.value, '$.nags_left'),
    alert_at = CASE WHEN json_type(j.value, '$.alert_at') IS NULL THEN notes.alert_at ELSE json_extract(j.value, '$.alert_at') END,
    alert_occ = CASE WHEN json_type(j.value, '$.alert_at') IS NULL THEN notes.alert_occ ELSE json_extract(j.value, '$.alert_occ') END,
    alert_wait = CASE WHEN json_type(j.value, '$.alert_at') IS NULL THEN notes.alert_wait ELSE NULL END
  FROM json_each(?1) AS j
  WHERE notes.user_id = json_extract(j.value, '$.user') AND notes.id = json_extract(j.value, '$.id')
    AND notes.fire_at = json_extract(j.value, '$.was')`;
// Added to, not set: someone joining meanwhile counts too (worker/groups.ts notifyJoined).
const RINGS_SQL = `UPDATE groups SET ring_n = CASE WHEN ring_win = json_extract(j.value, '$.win') THEN ring_n + json_extract(j.value, '$.n') ELSE json_extract(j.value, '$.n') END,
    ring_win = json_extract(j.value, '$.win')
  FROM json_each(?1) AS j WHERE groups.id = json_extract(j.value, '$.g')`;
const GONE_SQL = "DELETE FROM push_subs WHERE endpoint IN (SELECT value FROM json_each(?1))";

export async function runCron(d: CronDeps): Promise<{ notes: number; digests: number; sent: number; alerts: number }> {
  const send: SendDeps | null = d.vapid ? { vapid: d.vapid, subject: d.subject, now: d.now, fetch: d.fetch } : null;
  const budget = { left: d.cap ?? PUSH_CAP };
  const reminders = await ringDue(d, send, budget);
  const alerts = await runAlerts(d, send, budget);
  const digests = await sendDigests(d, send, budget);
  // Once a day, at 03:00 in Vietnam: guests nobody can reach any more, and devices no longer counted.
  const t = new Date(d.now);
  if (t.getUTCHours() === 20 && t.getUTCMinutes() === 0) {
    await sweepGuests(d.sql, d.now);
    await sweepDevices(d.sql, d.now);
  }
  return { notes: reminders.notes, digests: digests.users, sent: reminders.sent + alerts.sent + digests.sent, alerts: alerts.notes };
}

/** Cut to n characters, an ellipsis where words were left off. */
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const TAGS = /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_-]{1,30}/gu;

/** A group's member as the cron needs them. */
export interface Member {
  user: string;
  key: string;
  name: string;
  muted: boolean;
  quiet: Quiet | null;
  offset: number;
}

function membersByGroup(rows: Row[]): Map<string, Member[]> {
  const out = new Map<string, Member[]>();
  for (const m of rows) {
    const g = String(m.group_id);
    const member = { user: String(m.user_id), key: String(m.key), name: String(m.name), muted: Number(m.muted) === 1, quiet: quietOf(m), offset: Number(m.tz_offset ?? 420) };
    out.set(g, [...(out.get(g) ?? []), member]);
  }
  return out;
}

/** The member a group's note is for, when it names one still in the group: a key gone counts as nobody's, so everyone is rung. */
const assigned = (r: Row, members: Member[]) => (typeof r.assignee === "string" ? members.find((m) => m.key === r.assignee) : undefined);

/** Each member's entry in a per-person JSON column (ticks, watch), by user id. */
const entries = <T>(json: unknown): [string, T][] => (typeof json === "string" ? Object.entries(JSON.parse(json) as Record<string, T>) : []);
const ruleOf = (r: Row): Rule | null => (typeof r.rule === "string" ? readRule(JSON.parse(r.rule)) : null);
/** The time an occurrence rang for (a nag of it keeps it): `occ`, or for an old row its `fire_at`. */
const occOf = (r: Row) => (r.occ === null || r.occ === undefined ? Number(r.fire_at) : Number(r.occ));

/** Who ticked an `each` note off for the time at `occ` (src/shared/ticks.ts: a repeating one, time by time). */
function tickedBy(r: Row, occ: number): Set<string> {
  if (Number(r.each) !== 1) return new Set();
  const rule = ruleOf(r);
  const offset = Number(r.tz_offset ?? 420);
  return new Set(
    entries<OwnTick>(r.ticks)
      .filter(([, v]) => ticksOff(v, rule, occ, offset))
      .map(([u]) => u),
  );
}
/** Who asked to be told when it is left undone, and would be: not muted, not the one it is for. */
const watchersOf = (r: Row, members: Member[], one?: Member) => {
  const on = new Set(
    entries<{ on?: number }>(r.watch)
      .filter(([, v]) => Number(v?.on) === 1)
      .map(([u]) => u),
  );
  return members.filter((m) => on.has(m.user) && !m.muted && m !== one);
};

export interface RingContext {
  /** Rung on one member's phones only, the note being theirs: theirs is the tap that stops it. */
  solo?: boolean;
  /** Who is told if it is not done (Note.watch): named, so the tap is for someone. */
  watchers?: string[];
}

/**
 * What a reminder says: the note, and under it one thing that helps with
 * it, or nothing. The phone already shows the app and when it came, and a
 * tap opens the note on every phone, so none of that is said again:
 * "19:00–21:00 · Chạm để xong hoặc dời giờ · lặp lại" was three things,
 * none of them the point, and the eye had nowhere to land (Hải, 13/10/2026).
 */
export function reminderMessage(r: Row, ring: number, occ?: number, rule?: Rule | null, offset?: number, ctx: RingContext = {}): PushMessage {
  const id = String(r.id);
  return { title: cut(String(r.title), 120) || "Nhớ Nha", body: reminderBody(r, ring, occ, rule, offset, ctx), id, tag: id, act: true };
}

/**
 * The first that applies: why it rings again, what is left on the list, the
 * hours it takes, the line written under it; for a note someone waits on,
 * who ("Bấm Xong để Lan yên tâm": true, since then Lan is not told); for a
 * group's note with none of those, whose it is ("Nhóm Gia đình"), since it
 * was not this person who wrote it.
 */
function reminderBody(r: Row, ring: number, occ: number | undefined, rule: Rule | null | undefined, offset: number | undefined, ctx: RingContext): string {
  const group = typeof r.group_name === "string" && r.group_name ? r.group_name : null;
  // The why is also how to make it stop: in a group, everyone's one tap, or (each ticking for
  // themselves, or a note for one person) this person's own, the only one still rung.
  if (ring > 0) return group ? (Number(r.each) === 1 || ctx.solo ? "Nhắc lại vì bạn chưa bấm Xong" : "Nhắc lại vì chưa ai bấm Xong") : "Nhắc lại vì chưa bấm Xong";
  const items = typeof r.items === "string" ? (JSON.parse(r.items) as { t: string; done: boolean }[]) : null;
  const open = items?.filter((i) => !i.done).map((i) => i.t) ?? [];
  if (open.length) return cut(open.join(", "), 120);
  if (occ !== undefined && offset !== undefined) {
    const dur = durationAt(rule ?? null, occ, offset);
    if (dur) return clockRange(occ, dur, offset);
  }
  const text = typeof r.text === "string" ? r.text : "";
  const under = text
    .split("\n")
    .slice(1)
    .map((l) => l.replace(TAGS, " ").replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (under) return cut(under, 120);
  if (ctx.watchers?.length) return cut(`Bấm Xong để ${andList(ctx.watchers)} yên tâm`, 120);
  return group ? cut(`Nhóm ${group}`, 120) : "";
}

/**
 * Past the group's rings for the hour (GROUP_RINGS_PER_HOUR): one
 * notification in place of the rest, saying until when. The notes are in
 * the app, "đã qua giờ" there as anywhere.
 */
export function floodMessage(r: Row, now: number): PushMessage {
  const until = (ringWindow(now) + 1) * HOUR;
  return {
    title: cut(`Nhóm ${String(r.group_name)} có nhiều lời nhắc`, 120),
    body: `Gộp lại tới ${clock(until, Number(r.tz_offset ?? 420))} cho đỡ phiền. Mở app để xem.`,
    tag: `flood:${String(r.user_id)}`,
  };
}

async function ringDue(d: CronDeps, send: SendDeps | null, budget: { left: number }): Promise<{ notes: number; sent: number }> {
  const [due = []] = await d.sql.batch([{ sql: DUE_SQL, params: [d.now, ROWS] }]);
  if (!due.length) return { notes: 0, sent: 0 };
  // A group's note rings on its members' phones.
  const groupIds = [...new Set(due.filter((r) => r.group_name !== null).map((r) => String(r.user_id)))];
  const [rows = []] = groupIds.length ? await d.sql.batch([{ sql: MEMBERS_SQL, params: [JSON.stringify(groupIds)] }]) : [[]];
  const inGroup = membersByGroup(rows);
  const membersOf = (r: Row) => inGroup.get(String(r.user_id)) ?? [];
  // Who: the owner; in a group the one it is for, or everyone who has not ticked it off. Never
  // the ones who muted the group (theirs is the choice), so "Tắt tiếng" stops it at once.
  const whose = (r: Row): string[] => {
    if (r.group_name === null) return [String(r.user_id)];
    const one = assigned(r, membersOf(r));
    if (one) return one.muted ? [] : [one.user];
    const done = tickedBy(r, occOf(r));
    return membersOf(r)
      .filter((m) => !m.muted && !done.has(m.user))
      .map((m) => m.user);
  };
  const listening = (r: Row) => membersOf(r).filter((m) => !m.muted);
  const subs = await subsOf(d.sql, [...new Set([...due.flatMap(whose), ...due.flatMap((r) => listening(r).map((m) => m.user))])]);

  // Each group's rings this hour, as it stood (`was`) and as this run leaves it.
  const win = ringWindow(d.now);
  const rings = new Map<string, { was: number; n: number }>();
  const countOf = (r: Row) => {
    const g = String(r.user_id);
    let c = rings.get(g);
    if (!c) {
      const n = Number(r.ring_win) === win ? Number(r.ring_n) : 0;
      rings.set(g, (c = { was: n, n }));
    }
    return c;
  };

  const jobs: { sub: Sub; message: PushMessage }[] = [];
  const replans = [];
  for (const r of due) {
    const group = r.group_name !== null;
    const nag = Number(r.nag) === 1;
    const nagsLeft = Number(r.nags_left);
    const occ = occOf(r);
    // Which ring of this occurrence: 0 the first time, then 1, 2… for "nhắc dai".
    const ring = nag ? NAGS - nagsLeft : 0;
    const rule = r.rule === null ? null : readRule(JSON.parse(String(r.rule)));
    const offset = Number(r.tz_offset);
    // Past the group's hour, it is held, "nhắc dai" and all; the first one held says so to everyone listening.
    const count = group ? countOf(r) : null;
    const held = count !== null && count.n >= GROUP_RINGS_PER_HOUR;
    const one = group ? assigned(r, membersOf(r)) : undefined;
    let message: PushMessage | null;
    let to: string[];
    if (!held) {
      const watchers = one ? watchersOf(r, membersOf(r), one).map((m) => m.name) : [];
      message = reminderMessage(r, ring, occ, rule, offset, { solo: one !== undefined, watchers });
      to = whose(r);
    } else if (count.n === GROUP_RINGS_PER_HOUR) {
      message = floodMessage(r, d.now);
      to = listening(r).map((m) => m.user);
    } else {
      message = null;
      to = [];
    }
    const phones = to.flatMap((u) => subs.get(u) ?? []);
    // Oldest first; one that does not fit waits, unplanned, for the next minute.
    if (phones.length > budget.left && replans.length) break;
    budget.left -= phones.length;
    // A ring is someone rung: everyone who ticked it off rings nobody, and does not use up the hour.
    if (count && to.length) count.n++;
    if (message) for (const sub of phones) jobs.push({ sub, message });
    // Nobody left to ring this time (all ticked it off, or muted): on to the next, "nhắc dai" and all.
    // Held (the group's hour is full): this time's nags go, the next time keeps its own.
    const next = afterPush({ rule, nag }, occ, held || !to.length ? 0 : nagsLeft, d.now, offset);
    // Its first ring, for one person or for each to tick: half an hour on, look whether it was done.
    const watch = group && ring === 0 && (one !== undefined || Number(r.each) === 1) ? { alert_at: occ + ALERT_AFTER_MS, alert_occ: occ } : {};
    replans.push({ user: String(r.user_id), id: String(r.id), was: Number(r.fire_at), ...next, ...watch });
  }
  // Planned forward before sending, so every run moves on: were it after,
  // a run cut short (out of CPU midway) would leave the same rows due, and
  // the next run would be cut short on them again, for ever. The price is a
  // push lost now and then, which the morning list and the app's "đã qua giờ" show.
  const counted = [...rings].map(([g, c]) => ({ g, win, n: c.n - c.was })).filter((c) => c.n > 0);
  await d.sql.batch([
    { sql: REPLAN_SQL, params: [JSON.stringify(replans)] },
    ...(counted.length ? [{ sql: RINGS_SQL, params: [JSON.stringify(counted)] }] : []),
  ]);
  if (!send) return { notes: replans.length, sent: 0 };
  const { sent, gone } = await sendAll(jobs, send);
  if (gone.length) await d.sql.batch([{ sql: GONE_SQL, params: [JSON.stringify(gone)] }]);
  return { notes: replans.length, sent };
}

const ALERTS_SQL = `SELECT n.user_id, n.id, n.title, n.due, n.rule, n.done, n.deleted, n.each, n.ticks, n.assignee, n.watch,
    n.alert_at, n.alert_occ, n.alert_wait, g.name AS group_name, COALESCE(g.tz_offset, 420) AS tz_offset
  FROM notes n LEFT JOIN groups g ON g.id = n.user_id
  WHERE n.alert_at IS NOT NULL AND n.alert_at <= ?1 ORDER BY n.alert_at LIMIT ?2`;
// Unless a newer occurrence has started a look of its own meanwhile.
const ALERTED_SQL = `UPDATE notes SET alert_at = json_extract(j.value, '$.at'), alert_wait = json_extract(j.value, '$.wait')
  FROM json_each(?1) AS j
  WHERE notes.user_id = json_extract(j.value, '$.user') AND notes.id = json_extract(j.value, '$.id')
    AND notes.alert_at = json_extract(j.value, '$.was')`;

/** "21:00", "21:00 hôm qua", "21:00 12/10": when, by the clock of the one told. */
function saidAt(occ: number, offset: number, now: number): string {
  const days = dayDiff(occ, now, offset);
  if (days === 0) return clock(occ, offset);
  const w = toWall(occ, offset);
  return `${clock(occ, offset)} ${days === 1 ? "hôm qua" : `${w.d}/${w.mo}`}`;
}

/**
 * What a watcher is told: who has not tapped Xong, and on what, in the
 * app's own words. Never "chưa uống thuốc": all the app knows is the tap.
 */
export function watchMessage(r: Row, missing: string[], occ: number, offset: number, now: number): PushMessage {
  const id = String(r.id);
  const what = `${cut(String(r.title), 60)} ${saidAt(occ, offset, now)}`;
  if (missing.length === 1) return { title: cut(`${missing[0]} chưa bấm Xong`, 120), body: what, id, tag: `watch:${id}` };
  return { title: `Còn ${missing.length} người chưa bấm Xong`, body: cut(`${what} · ${andList(missing)}`, 120), id, tag: `watch:${id}` };
}

export interface AlertPlan {
  user: string;
  id: string;
  was: number;
  /** When to look again (someone asleep now), or null: this occurrence is settled. */
  at: number | null;
  wait: Record<string, number> | null;
  tell: { who: Member; message: PushMessage }[];
}

/**
 * Half an hour after an occurrence of a note for one person, or for each
 * to tick: if it is still not done, everyone who asked is told, once. Not
 * at all if it was done, put off, or deleted meanwhile; those asleep then
 * (worker/quiet.ts) are told when they wake, if it is still not done.
 */
export function alertPlan(r: Row, members: Member[], now: number): AlertPlan {
  const base = { user: String(r.user_id), id: String(r.id), was: Number(r.alert_at) };
  const settled: AlertPlan = { ...base, at: null, wait: null, tell: [] };
  // No longer a group's: its last member took it back as their own.
  if (r.group_name === null) return settled;
  const occ = Number(r.alert_occ);
  // Done, or put off past that time ("+10 phút": they saw it), or gone.
  const open = Number(r.deleted) === 0 && r.done === null && r.due !== null && Number(r.due) <= occ;
  const one = assigned(r, members);
  if (!open || (!one && Number(r.each) !== 1)) return settled;
  const ticked = tickedBy(r, occ);
  const missing = one ? [one] : members.filter((m) => !ticked.has(m.user));
  const first = r.alert_wait === null;
  const waiting = first ? {} : (JSON.parse(String(r.alert_wait)) as Record<string, number>);
  const later: Record<string, number> = {};
  const tell: AlertPlan["tell"] = [];
  for (const w of watchersOf(r, members, one)) {
    const others = missing.filter((m) => m.user !== w.user).map((m) => m.name);
    if (!others.length) continue;
    const due = first ? (asleep(w.quiet, now) ? wakeAt(w.quiet!, now) : now) : waiting[w.user];
    if (due === undefined) continue;
    if (due > now) later[w.user] = due;
    else tell.push({ who: w, message: watchMessage(r, others, occ, w.offset, now) });
  }
  const times = Object.values(later);
  return { ...base, at: times.length ? Math.min(...times) : null, wait: times.length ? later : null, tell };
}

async function runAlerts(d: CronDeps, send: SendDeps | null, budget: { left: number }): Promise<{ notes: number; sent: number }> {
  if (budget.left <= 0) return { notes: 0, sent: 0 };
  const [rows = []] = await d.sql.batch([{ sql: ALERTS_SQL, params: [d.now, ROWS] }]);
  if (!rows.length) return { notes: 0, sent: 0 };
  const groupIds = [...new Set(rows.filter((r) => r.group_name !== null).map((r) => String(r.user_id)))];
  const [people = []] = groupIds.length ? await d.sql.batch([{ sql: MEMBERS_SQL, params: [JSON.stringify(groupIds)] }]) : [[]];
  const inGroup = membersByGroup(people);
  const plans = rows.map((r) => alertPlan(r, inGroup.get(String(r.user_id)) ?? [], d.now));
  const subs = await subsOf(d.sql, [...new Set(plans.flatMap((p) => p.tell.map((t) => t.who.user)))]);
  const jobs: { sub: Sub; message: PushMessage }[] = [];
  const looked = [];
  for (const p of plans) {
    const phones = p.tell.flatMap((t) => (subs.get(t.who.user) ?? []).map((sub) => ({ sub, message: t.message })));
    if (phones.length > budget.left && looked.length) break;
    budget.left -= phones.length;
    jobs.push(...phones);
    looked.push({ user: p.user, id: p.id, was: p.was, at: p.at, wait: p.wait });
  }
  await d.sql.batch([{ sql: ALERTED_SQL, params: [JSON.stringify(looked)] }]);
  if (!send || !jobs.length) return { notes: looked.length, sent: 0 };
  const { sent, gone } = await sendAll(jobs, send);
  if (gone.length) await d.sql.batch([{ sql: GONE_SQL, params: [JSON.stringify(gone)] }]);
  return { notes: looked.length, sent };
}

/** The next time a person's morning list is due after `after`, on their clock. */
export function nextDigest(hour: number, after: number, offset: number): number {
  const w = toWall(after, offset);
  const today = fromWall(w.y, w.mo, w.d, hour, 0, offset);
  return today > after ? today : today + DAY;
}

const DIGEST_USERS_SQL = "SELECT id, tz_offset, digest_hour FROM users WHERE digest_next IS NOT NULL AND digest_next <= ?1 LIMIT ?2";
// Their open reminders from a week back to a day ahead, their own and their groups', each
// row with whom it is for; sorted out per person below. Not a group's they muted, not one
// given to someone else in it; with their own tick, for digestMessage to leave out what they ticked off.
const OPEN = "n.deleted = 0 AND n.done IS NULL AND n.due IS NOT NULL AND ((n.due >= ?2 AND n.due < ?3) OR (n.fire_at >= ?2 AND n.fire_at < ?3))";
const DIGEST_NOTES_SQL = `SELECT n.user_id AS recipient, n.title, n.due, n.rule, n.fire_at, 0 AS each, NULL AS tick FROM notes n
    WHERE n.user_id IN (SELECT value FROM json_each(?1)) AND ${OPEN}
  UNION ALL
  SELECT m.user_id AS recipient, n.title, n.due, n.rule, n.fire_at, n.each, json_extract(n.ticks, '$."' || m.user_id || '"') AS tick
    FROM notes n JOIN group_members m ON m.group_id = n.user_id
    WHERE m.user_id IN (SELECT value FROM json_each(?1)) AND ${OPEN} AND m.muted = 0
      AND (n.assignee IS NULL OR n.assignee = m.key
           OR NOT EXISTS (SELECT 1 FROM group_members a WHERE a.group_id = n.user_id AND a.key = n.assignee))`;
const DIGEST_NEXT_SQL = `UPDATE users SET digest_next = json_extract(j.value, '$.next')
  FROM json_each(?1) AS j WHERE users.id = json_extract(j.value, '$.id')`;

/** Lines of a list before the rest is counted: about what a phone shows of a notification unopened. */
const DIGEST_LINES = 4;
const listed = (all: string[]) => (all.length > DIGEST_LINES + 1 ? [...all.slice(0, DIGEST_LINES), `Và ${all.length - DIGEST_LINES} việc nữa`] : all);

/**
 * The morning list: one reminder a line, hour first, so the day reads down
 * the screen; "08:00 Gọi bác sĩ · 09:00 Đi chợ · 19:00…" ran the hours and
 * names together across the line breaks. What went by unanswered comes
 * last, in the app's own words ("đã qua giờ"), or alone on a day with
 * nothing set. null when there is nothing to say (no empty notifications).
 */
export function digestMessage(notes: Row[], now: number, offset: number): PushMessage | null {
  const dayEnd = startOfDay(now, offset) + DAY;
  const today: { at: number; title: string }[] = [];
  const missed: { at: number; title: string }[] = [];
  for (const n of notes) {
    const due = Number(n.due);
    const fire = n.fire_at === null ? null : Number(n.fire_at);
    // A repeating one rings at fire_at; a one-off at due (fire_at gone once it rang).
    const at = n.rule !== null ? fire : due;
    // Ticked off by this person already, of those each ticks off: a repeating one, for the time it rings next.
    const tick = typeof n.tick === "string" ? (JSON.parse(n.tick) as OwnTick) : null;
    if (Number(n.each) === 1 && ticksOff(tick, ruleOf(n), at ?? due, offset)) continue;
    const title = cut(String(n.title), 40);
    if (at !== null && at >= now && at < dayEnd) today.push({ at, title });
    else if (n.rule === null && due < now && due >= now - MISSED_WINDOW) missed.push({ at: due, title });
  }
  if (!today.length && !missed.length) return null;
  today.sort((a, b) => a.at - b.at);
  missed.sort((a, b) => a.at - b.at);
  const late = `Còn ${missed.length} việc đã qua giờ chưa xong`;
  if (!today.length) return { title: late, body: listed(missed.map((m) => m.title)).join("\n"), tag: "digest" };
  const lines = listed(today.map((t) => `${clock(t.at, offset)} ${t.title}`));
  if (missed.length) lines.push(late);
  return { title: `Hôm nay có ${today.length} việc`, body: lines.join("\n"), tag: "digest" };
}

async function sendDigests(d: CronDeps, send: SendDeps | null, budget: { left: number }): Promise<{ users: number; sent: number }> {
  if (budget.left <= 0) return { users: 0, sent: 0 };
  const [found = []] = await d.sql.batch([{ sql: DIGEST_USERS_SQL, params: [d.now, ROWS] }]);
  if (!found.length) return { users: 0, sent: 0 };
  const subs = await subsOf(d.sql, found.map((u) => String(u.id)));
  const users: Row[] = [];
  for (const u of found) {
    const phones = subs.get(String(u.id))?.length ?? 0;
    if (phones > budget.left && users.length) break;
    budget.left -= phones;
    users.push(u);
  }
  const ids = users.map((u) => String(u.id));
  const [notes = []] = await d.sql.batch([{ sql: DIGEST_NOTES_SQL, params: [JSON.stringify(ids), d.now - MISSED_WINDOW, d.now + DAY] }]);
  const jobs: { sub: Sub; message: PushMessage }[] = [];
  const next = [];
  for (const u of users) {
    const id = String(u.id);
    const offset = Number(u.tz_offset);
    const message = digestMessage(
      notes.filter((n) => n.recipient === id),
      d.now,
      offset,
    );
    if (message) for (const sub of subs.get(id) ?? []) jobs.push({ sub, message });
    next.push({ id, next: u.digest_hour === null ? null : nextDigest(Number(u.digest_hour), d.now, offset) });
  }
  await d.sql.batch([{ sql: DIGEST_NEXT_SQL, params: [JSON.stringify(next)] }]);
  if (!send || !jobs.length) return { users: users.length, sent: 0 };
  const { sent, gone } = await sendAll(jobs, send);
  if (gone.length) await d.sql.batch([{ sql: GONE_SQL, params: [JSON.stringify(gone)] }]);
  return { users: users.length, sent };
}
