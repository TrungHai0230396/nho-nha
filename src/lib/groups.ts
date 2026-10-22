// "Nhắc chung" on the phone: the invite a link carries, and passing one on.
import type { GroupInfo, Note } from "../shared/protocol";
import { roundOf, shownTime, tapsFor } from "./notes";
import { copyText } from "./clipboard";
import { called } from "./nicknames";
import { inAppBrowser } from "./pwa";

/** What someone with the app already does with an invite: said in the message, and where it lands. */
export const HAVE_APP = "Đã cài app thì chép link này, mở app → Cài đặt → Nhắc chung → Dán link mời.";

/** `<group id>.<32 hex>`, as worker/groups.ts makes it. */
export const INVITE = /^g_[A-Za-z0-9_-]{22}\.[0-9a-f]{32}$/;
const KEY = "nhonha:invite";

/**
 * The invite in a link, or the bare code, as someone might paste either:
 * also inside a whole message copied from Zalo, its words around the link.
 */
export function inviteIn(text: string): string | null {
  const s = text.trim();
  if (INVITE.test(s)) return s;
  const m = /[?&]moi=([^&#\s]+)/.exec(s);
  if (!m) return null;
  let v = m[1]!;
  try {
    v = decodeURIComponent(v);
  } catch {
    // Read as it is.
  }
  // The code alone: a link copied out of a sentence may carry its full stop or bracket along.
  return /g_[A-Za-z0-9_-]{22}\.[0-9a-f]{32}/.exec(v)?.[0] ?? null;
}

/**
 * An invite opened (`/?moi=<code>`) is kept on the phone and taken out of
 * the address: it must outlast signing in (Google's round trip, "Dùng
 * ngay"), and must not be shared on by whoever copies the address next.
 *
 * Except inside Zalo's or Facebook's own browser, where nothing can be
 * done with it but leave for Safari or Chrome: their "open in browser"
 * takes the address as it stands, and taken out, the invite never reached
 * Safari (Hải, 14/10/2026: the link sent over Zalo "đâu có tác dụng").
 */
export function takeInviteFromUrl(): void {
  const code = inviteIn(location.search);
  if (!code) return;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Storage shut: the invite is lost with this page, and the link still works opened again.
  }
  if (inAppBrowser()) return;
  const url = new URL(location.href);
  url.searchParams.delete("moi");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

/** The link that lets someone into `g`, at this address. */
export function inviteLink(g: Pick<GroupInfo, "code">): string {
  return `${location.origin}/?moi=${encodeURIComponent(g.code)}`;
}

/**
 * What was copied last, read when the person taps for it (iPhone first shows
 * its own "Dán" bubble): "" when nothing was, null when it cannot be read
 * (refused, or no clipboard to read in this browser). With nothing copied,
 * an iPhone may not answer at all: never wait on this to show anything.
 */
export async function readClipboard(): Promise<string | null> {
  try {
    const text = await navigator.clipboard?.readText?.();
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

/** The link of the invite this phone was opened with and has not used yet, or null. */
export function pendingInviteLink(): string | null {
  const code = pendingInvite();
  return code ? inviteLink({ code }) : null;
}

/**
 * The invite into the share sheet (Zalo, Messenger…), or onto the
 * clipboard where there is none. "shared" and "copied" are done; "cancelled"
 * is the person changing their mind, not an error.
 */
export async function shareInvite(g: GroupInfo): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = inviteLink(g);
  // Whoever has the app already must bring the link into it: on iPhone a link opens Safari, a
  // place apart from the app on the home screen, where joining makes another account the app
  // never hears of (Hải, 14/10/2026: "nó sẽ tạo 1 session khác nên app hiện tại ko biết").
  const text = `Vào nhóm "${g.name}" trên Nhớ Nha để cùng được nhắc việc chung. ${HAVE_APP}`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Nhớ Nha", text, url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // Refused for another reason (no gesture, an in-app browser): copy instead.
    }
  }
  return (await copyText(`${text} ${url}`)) ? "copied" : "failed";
}

/** "Hải, Lan và 3 người nữa": who is in a group, short, by this phone's nicknames (lib/nicknames). */
/** Some of a group's people, by key, as this phone calls them: "Lan và Bố", or past three "5 người". */
export function whoLine(keys: readonly string[], members: GroupInfo["members"], nicks: Record<string, string> = {}): string {
  if (keys.length > 3) return `${keys.length} người`;
  const names = keys.flatMap((k) => members.filter((m) => m.key === k).map((m) => called(m, nicks)));
  return names.join(", ").replace(/, ([^,]*)$/, " và $1");
}

/**
 * Where a note each ticks off stands for the group, in the list: "1/3 xong"
 * while this person has not tapped; after, who is left ("còn Lan và Bố")
 * or "cả nhóm xong", for a repeating one about its last time ("lần trước
 * còn Bố"), the row showing the next. Before, a tap left the row saying
 * nothing of the others (Hải, 14/10/2026: "tôi bấm xong cái ko biết mấy
 * người kia bấm hay chưa").
 */
export function eachLine(n: Note, members: GroupInfo["members"], now: number, offset: number, nicks: Record<string, string> = {}): string | null {
  const round = roundOf(n, now, offset);
  if (round === null) return null;
  const { missing } = tapsFor(n, members, round, offset);
  const me = members.find((m) => m.me);
  if (me && missing.includes(me.key)) return `${members.length - missing.length}/${members.length} xong`;
  const at = shownTime(n, now, offset);
  const last = n.rule && (at === null || at > now) ? "lần trước " : "";
  return missing.length ? `${last}còn ${whoLine(missing, members, nicks)}` : `${last}cả nhóm xong`;
}

/** Just after this person's tap: who is still to, for the time they tapped for. */
export function leftAfterTap(n: Note, members: GroupInfo["members"], offset: number, nicks: Record<string, string> = {}): string | null {
  if (!n.each || n.mine?.at == null) return null;
  const { missing } = tapsFor(n, members, n.rule ? (n.mine.occ ?? n.mine.at) : 0, offset);
  return missing.length ? `Còn ${whoLine(missing, members, nicks)} chưa bấm` : "Cả nhóm đã xong";
}

export function membersLine(g: GroupInfo, nicks: Record<string, string> = {}, shown = 3): string {
  if (g.members.length === 1 && g.members[0]!.me) return "Mới có bạn";
  const names = g.members.map((m) => called(m, nicks));
  if (names.length <= shown) return names.join(", ").replace(/, ([^,]*)$/, " và $1");
  return `${names.slice(0, shown).join(", ")} và ${names.length - shown} người nữa`;
}
