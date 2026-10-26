// What phones and the Worker say to each other. Shared so both sides
// check the same shapes.
import type { Item } from "./parse";
import { readRule, type Rule } from "./recur";

export interface Note {
  /** Made on the phone (random), so a note written with no signal already has its id. */
  id: string;
  /** Exactly what was typed: the title, list and time are read from it. */
  text: string;
  title: string;
  items: Item[] | null;
  tags: string[];
  /** The reminder waiting to ring (put off by "+10 phút" etc.), or null. */
  due: number | null;
  rule: Rule | null;
  /** Ring again every few minutes until answered. */
  nag: boolean;
  /** When a one-off was ticked off; null while open. */
  done: number | null;
  pinned: boolean;
  deleted: boolean;
  created: number;
  /** The phone's clock at the last edit: of two edits, the later one wins. */
  updated: number;
  /** "Nhắc chung": the group whose members all see it and are reminded (GROUP_ID); null: this person's own. */
  group: string | null;
  /**
   * Who last ticked it off (or ticked off its latest time, for a repeating
   * one), and when. A phone sends only `at`; the server writes the name, as
   * the group knows the sender, so nobody can tick in someone else's name;
   * `key` is that member's, for the nickname a phone keeps for them.
   */
  by: { name: string; at: number; key?: string } | null;
  /**
   * "Mỗi người tự bấm Xong", a group's note for everyone: each member ticks
   * it off for themselves (7h đi nhậu: whoever is there taps Xong), `done`
   * stays null, and only those who have not ticked are still reminded. A
   * repeating one is ticked time by time ("9h, 18h hằng ngày uống thuốc":
   * each person, each dose), its `due` left where it was (src/shared/ticks.ts).
   */
  each: boolean;
  /** Who has ticked an `each` note off: the server's record, read-only on a phone. */
  ticks: Tick[];
  /**
   * This person's own tick of an `each` note, and when they last changed
   * it: the later change wins, per person, so ticks made at once on five
   * phones (or on two phones of one person) never undo each other. null:
   * never touched. The only part of the ticks a phone sends. `occ`, on a
   * repeating note: the time it was tapped for.
   */
  mine: { at: number | null; t: number; occ?: number } | null;
  /**
   * A group's note for one member (their key): only they are rung ("21h bố
   * uống thuốc" rings on Bố's phone, not the whole family's). null: everyone.
   * A key no longer in the group counts as null, so nothing goes unrung.
   */
  assignee: string | null;
  /**
   * This person's own "Báo cho tôi nếu chưa xong", and when they last changed
   * it: kept per person like `mine`, so nobody can sign someone else up to
   * be told. Only on a note for one member, or one each ticks off.
   */
  watch: { on: boolean; t: number } | null;
  /** Who is told if it is not done in time: the server's record, read-only on a phone. */
  watchers: Watcher[];
}

/** One member's tick of an `each` note. */
export interface Tick {
  key: string;
  name: string;
  at: number;
  me: boolean;
  /** On a repeating note, the time it was tapped for. */
  occ?: number;
}

export interface Watcher {
  key: string;
  name: string;
  me: boolean;
}

/** A group's id: never the length of a user id, since its notes sit where a user's would (migrations/0003). */
export const GROUP_ID = /^g_[A-Za-z0-9_-]{22}$/;
/** A member's key in a group (worker/groups.ts: 9 random bytes, base64url). */
export const MEMBER_KEY = /^[A-Za-z0-9_-]{12}$/;

/** A group as its members see it, every sync. */
export interface GroupInfo {
  id: string;
  name: string;
  /** This person made it, or was handed it: may rename it, remove people, renew the invite. */
  owner: boolean;
  /** The invite (`/?moi=<code>`): any member may pass it on. */
  code: string;
  /** This person turned the group's notifications off ("Tắt tiếng nhóm này"). */
  muted: boolean;
  /** `push`: has notifications on somewhere, so a reminder for them can reach them. */
  members: { key: string; name: string; me: boolean; owner: boolean; push: boolean }[];
  /** The group's clock, minutes east of UTC: its repeating times are on it, whoever ticks them. */
  offset?: number;
}

/** A group's part of a sync answer: its members, and its notes changed since the phone's cursor. */
export interface GroupSync extends GroupInfo {
  rev: number;
  notes: Note[];
  more: boolean;
}

export const NOTE_ID = /^[A-Za-z0-9_-]{16,32}$/;
export const LIMITS = {
  text: 2_000,
  title: 500,
  items: 50,
  item: 200,
  tags: 10,
  tag: 30,
  /** Changes in one sync request; a phone with more sends them in turns. */
  changesPerSync: 200,
  /** Notes changed in one answer; `more` says when to ask again. */
  notesPerPull: 500,
  groupName: 40,
  memberName: 30,
  /** A family, a class: past this, a reminder's pushes would crowd out everyone else's in a cron run. */
  membersPerGroup: 20,
  groupsPerPerson: 10,
} as const;

export interface SyncRequest {
  /** The server's rev this phone has everything up to (0 the first time). */
  since: number;
  changes: Note[];
  /** Minutes east of UTC on this phone: the clock the Worker reckons repeats and the morning list by. */
  offset: number;
  /** Each group's rev this phone has everything up to; a group not named starts from 0. */
  groups?: Record<string, number>;
}

export interface SyncResponse {
  rev: number;
  notes: Note[];
  /** More changed than fit: ask again from `rev`. */
  more: boolean;
  /** Every group this person is in, now: one gone from the list is one they are no longer in. */
  groups: GroupSync[];
}

export interface Me {
  /** The account's own id: a phone keeps its notes apart per account by it. */
  id: string;
  name: string;
  email: string;
  /** Hour of the morning list (0–23), or null when turned off. */
  digestHour: number | null;
  /** "Dùng ngay": no Google behind the account, only this device. */
  guest: boolean;
  /** Hours of sleep, from–to on their clock: news about others waits for the morning. null: none. */
  quiet: { from: number; to: number } | null;
}

export interface PushKeyResponse {
  key: string | null;
}

export interface PushSubscribeRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  device: string;
}

/** What a notification carries (encrypted for the one phone). */
export interface PushMessage {
  title: string;
  body: string;
  /** The note to open; absent for the morning list. */
  id?: string;
  /** Replaces an earlier notification for the same note. */
  tag: string;
  /** A reminder to answer: a "Xong" button on it where the phone shows buttons (not iPhone). */
  act?: boolean;
}

/** A shortcut's token, as listed (the token itself is shown once, when made). */
export interface TokenInfo {
  id: string;
  label: string;
  created: number;
  lastUsed: number | null;
}

/** The kinds of device installs are counted by (src/lib/pwa.ts platformOf, worker/devices.ts). */
export const PLATFORMS = ["iphone", "ipad", "android", "mac", "windows", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * All a device ever tells /api/device, at most once a day (src/lib/count.ts):
 * an id kept for counting alone, whether it runs as the installed app, and
 * what kind of device it is.
 */
export interface DeviceReport {
  device: string;
  standalone: boolean;
  platform: Platform;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const time = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 946_684_800_000 && v <= 4_102_444_800_000;

/** A note as it came off the wire, checked field by field; null when anything is off. */
export function readNote(v: unknown): Note | null {
  if (!isObject(v)) return null;
  const { id, text, title, items, tags, due, rule, nag, done, pinned, deleted, created, updated, group, by, each, mine, assignee, watch } = v;
  if (typeof id !== "string" || !NOTE_ID.test(id)) return null;
  if (!str(text, LIMITS.text) || !str(title, LIMITS.title)) return null;
  let its: Item[] | null = null;
  if (items !== null) {
    if (!Array.isArray(items) || items.length > LIMITS.items) return null;
    its = [];
    for (const it of items) {
      if (!isObject(it) || !str(it.t, LIMITS.item) || typeof it.done !== "boolean") return null;
      its.push({ t: it.t, done: it.done });
    }
  }
  if (!Array.isArray(tags) || tags.length > LIMITS.tags || !tags.every((t) => str(t, LIMITS.tag) && t.length > 0)) return null;
  if (due !== null && !time(due)) return null;
  const r = rule === null ? null : readRule(rule);
  if (rule !== null && !r) return null;
  if (typeof nag !== "boolean" || typeof pinned !== "boolean" || typeof deleted !== "boolean") return null;
  if (done !== null && !time(done)) return null;
  if (!time(created) || !time(updated)) return null;
  // Absent from a phone still on the version before groups: its own note, ticked by nobody named.
  if (!(group === undefined || group === null || (typeof group === "string" && GROUP_ID.test(group)))) return null;
  if (!(by === undefined || by === null || (isObject(by) && time(by.at)))) return null;
  const tick = isObject(by) && time(by.at) ? { name: str(by.name, LIMITS.memberName) ? by.name : "", at: by.at } : null;
  if (!(each === undefined || typeof each === "boolean")) return null;
  if (!(mine === undefined || mine === null || (isObject(mine) && (mine.at === null || time(mine.at)) && time(mine.t) && (mine.occ === undefined || mine.occ === null || time(mine.occ))))) return null;
  const own = isObject(mine) && time(mine.t) ? { at: (mine.at as number | null) ?? null, t: mine.t, ...(time(mine.occ) ? { occ: mine.occ } : {}) } : null;
  if (!(assignee === undefined || assignee === null || (typeof assignee === "string" && MEMBER_KEY.test(assignee)))) return null;
  if (!(watch === undefined || watch === null || (isObject(watch) && typeof watch.on === "boolean" && time(watch.t)))) return null;
  const watching = isObject(watch) && typeof watch.on === "boolean" && time(watch.t) ? { on: watch.on, t: watch.t } : null;
  return {
    id,
    text,
    title,
    items: its,
    tags: tags as string[],
    due,
    rule: r,
    nag,
    done,
    pinned,
    deleted,
    created,
    updated,
    group: (group as string | null | undefined) ?? null,
    by: tick,
    each: each === true,
    // Never taken from a phone: the server keeps them, per person (worker/notes.ts).
    ticks: [],
    mine: own,
    // Absent from a phone on an older version: for everyone, as before.
    assignee: (assignee as string | null | undefined) ?? null,
    watch: watching,
    watchers: [],
  };
}

/** A deleted note keeps only what sync needs: no words of it stay on the server. */
export function tombstone(n: Note): Note {
  return { ...n, text: "", title: "", items: null, tags: [], due: null, rule: null, nag: false, pinned: false, deleted: true, by: null, ticks: [], mine: null, assignee: null, watch: null, watchers: [] };
}
