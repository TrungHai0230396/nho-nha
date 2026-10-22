import { BellOff, BellRing, CalendarDays, ChevronDown, ChevronUp, CircleHelp, CloudOff, Download, Search, Settings as Gear, ShieldCheck, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { upgradeToGoogle } from "../app/account";
import { startAutoSync, store, syncSoon, toast, useGoogleOn, useNotes, useNow } from "../app/state";
import { clearNotifications, usePush } from "../app/usePush";
import { tellDevice } from "../lib/count";
import { leftAfterTap, pendingInvite } from "../lib/groups";
import { useNicknames } from "../lib/nicknames";
import { doneAt, markDone, nextDue, reopen, sections, shownTime, toggleItem, undone } from "../lib/notes";
import { inAppBrowser, installWay, isIOS, isIPad, isStandalone, promptInstall, useInstallState } from "../lib/pwa";
import { daysLabel, whenLabel } from "../shared/describe";
import { parse } from "../shared/parse";
import type { Me, Note } from "../shared/protocol";
import { deviceOffset } from "../shared/wall";
import { Marked } from "./Chips";
import { CalendarView } from "./CalendarView";
import { Composer } from "./Composer";
import { EscapeInApp } from "./EscapeInApp";
import { HelpSheet } from "./HelpSheet";
import { InstallSheet } from "./InstallSheet";
import { JoinSheet } from "./JoinSheet";
import { NoteRow } from "./NoteRow";
import { NoteSheet } from "./NoteSheet";
import { Settings, type SettingsPage } from "./Settings";
import { Wall } from "./Wall";

const TRIES = ["mai 8h gọi mẹ", "2 tiếng nữa lấy đồ giặt", "mỗi sáng thứ 2 họp team", "mỗi thứ 2,4,7 học tiếng Anh, thứ 2 từ 20h đến 20h30, thứ 4,7 từ 20h30 đến 22h", "đi chợ: trứng, sữa, rau", "rằm thắp hương"];
const DISMISSED = "nhonha:dismissed";

function dismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function Main({ me, onSignedOut, onLeave, onMe, onEnter }: { me: Me; onSignedOut(): void; onLeave(): void; onMe(me: Me): void; onEnter(me: Me): void }) {
  const snap = useNotes();
  const now = useNow();
  const offset = deviceOffset();
  const push = usePush();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Settings, open at its first page or at one ("notify": how to unblock notifications).
  const [settings, setSettings] = useState<false | SettingsPage>(false);
  const [calendar, setCalendar] = useState(false);
  const [help, setHelp] = useState(false);
  const [install, setInstall] = useState(() => /^\/cai\/[^/]+\/?$/.test(location.pathname) && !isStandalone());
  const [showDone, setShowDone] = useState(false);
  const [ringing, setRinging] = useState<string | null>(null);
  // "Xong" tapped on a notification: the note to tick off once this phone has it.
  const [xong, setXong] = useState<string | null>(null);
  const [hidden, setHidden] = useState(dismissed);
  // An invite opened (`/?moi=`), kept through signing in (lib/groups): asked about once in.
  const [invite, setInvite] = useState(pendingInvite);
  const searchBox = useRef<HTMLInputElement>(null);
  const google = useGoogleOn();
  const groupOf = useMemo(() => new Map(snap.groups.map((g) => [g.id, { name: g.name, members: g.members }])), [snap.groups]);

  useEffect(() => startAutoSync(), []);
  useEffect(() => {
    if (snap.status === "signedOut") onSignedOut();
  }, [snap.status, onSignedOut]);

  // From a notification: ?n=<id> on opening, or a message while open; with &xong=1 (its
  // "Xong" button, src/sw.js), ticked off rather than opened.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("n");
    if (id) {
      if (params.get("xong")) setXong(id);
      else setOpen(id);
      history.replaceState(null, "", location.pathname);
    }
    const msg = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string | null; xong?: boolean };
      if (d?.type === "open" && d.id) (d.xong ? setXong : setOpen)(d.id);
      if (d?.type === "push") void store.sync();
    };
    navigator.serviceWorker?.addEventListener("message", msg);
    return () => navigator.serviceWorker?.removeEventListener("message", msg);
  }, []);

  // In front, the app says it itself: clear what the notifications said.
  useEffect(() => {
    const look = () => document.visibilityState === "visible" && void clearNotifications();
    look();
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, []);

  // Counted, once a day at most: installed or in a tab, and what kind of device (lib/count).
  // On coming to the front too, since an installed app can stay open for days.
  useEffect(() => {
    const look = () => document.visibilityState === "visible" && void tellDevice();
    look();
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, []);

  // The app's own ring while it is open (the push comes too, quietly).
  useEffect(() => {
    const next = nextDue(snap.notes.values(), Date.now(), offset);
    if (!next) return;
    const wait = next.at - Date.now();
    if (wait > 86_400_000) return;
    const t = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      setRinging(next.note.id);
      navigator.vibrate?.([200, 100, 200]);
    }, wait + 300);
    return () => clearTimeout(t);
  }, [snap.notes, offset]);

  const s = useMemo(() => sections(snap.notes.values(), now, offset, query, tag, (g) => groupOf.get(g)?.members), [snap.notes, now, offset, query, tag, groupOf]);
  const total = s.due.length + s.waiting.length + s.today.length + s.tomorrow.length + s.week.length + s.later.length + s.plain.length;
  const nicks = useNicknames();
  const kept = useMemo(() => [...snap.notes.values()].filter((n) => !n.deleted).length, [snap.notes]);

  const tick = useCallback(
    async (id: string) => {
      const n = store.get(id);
      if (!n) return;
      const at = Date.now();
      const next = doneAt(n) !== null ? reopen(n, at) : markDone(n, at, offset);
      await store.put(next);
      syncSoon();
      if (doneAt(n) !== null) return;
      const undo = () => void store.put(undone(n, store.get(id), Date.now())).then(syncSoon);
      const then = next.rule ? shownTime(next, at, offset) : null;
      // Each ticking for themselves: what the tap leaves, who is still to (lib/groups leftAfterTap).
      const members = next.group ? groupOf.get(next.group)?.members : undefined;
      const left = members ? leftAfterTap(next, members, offset, nicks) : null;
      toast(left ? `Xong. ${left}.` : then !== null ? `Xong. Lần tới: ${whenLabel(then, at, offset)}` : "Xong", { label: "Hoàn tác", run: undo });
    },
    [offset, groupOf, nicks],
  );
  // The note may arrive with the first sync after opening: ticked off then, or forgotten if it never does.
  useEffect(() => {
    if (!xong) return;
    const n = snap.notes.get(xong);
    if (!n) {
      const t = setTimeout(() => setXong(null), 30_000);
      return () => clearTimeout(t);
    }
    setXong(null);
    if (doneAt(n) !== null) toast("Đã xong rồi");
    else void tick(n.id);
  }, [xong, snap.notes, tick]);

  const item = useCallback(async (id: string, i: number) => {
    const n = store.get(id);
    if (!n) return;
    await store.put(toggleItem(n, i, Date.now()));
    syncSoon();
  }, []);

  const hide = (key: string) => {
    const next = new Set(hidden).add(key);
    setHidden(next);
    try {
      localStorage.setItem(DISMISSED, JSON.stringify([...next]));
    } catch {
      // Shown again next time.
    }
  };

  const ringNote = ringing ? store.get(ringing) : undefined;
  const openNote = open ? store.get(open) : undefined;
  const inApp = inAppBrowser();
  const installing = useInstallState();
  // On every device that can take it: one tap where the browser offers it, its menu's steps where it does not.
  const installBy = installWay(installing, navigator.userAgent, isIPad(), inApp !== null);
  // One nudge at a time, the one that matters most, in one line: two or three stacked, three lines
  // each, had pushed the list itself below the fold (Hải, 14/10/2026: "review lại màn hình chính").
  const nudge = inApp
    ? "inapp"
    : push.state === "blocked"
      ? "blocked"
      : // One tap where the browser offers it (a computer, Android), so it comes before "Bật thông
        // báo", which follows it; asked for after, it never showed on a computer whose notifications
        // were off, where Hải looked for it. Hidden with its ×, the notifications come next.
        installBy === "prompt" && !hidden.has("install")
        ? "install"
        : push.state === "off"
          ? "off"
          : installBy && !hidden.has("install")
            ? "install"
            : me.guest && google && kept >= 5 && !hidden.has("guest")
              ? "guest"
              : null;

  const list = (title: string, notes: Note[], cls = "") =>
    notes.length > 0 && (
      <section className={`section ${cls}`} aria-label={title}>
        <h2>{title}</h2>
        <ul className="list">
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} now={now} offset={offset} group={n.group ? groupOf.get(n.group) : undefined} onOpen={setOpen} onTick={tick} onItem={item} />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="app">
      <Wall />
      <header className="top">
        {searching ? (
          <div className="search">
            <label htmlFor="q" className="sr-only">
              Tìm ghi chú
            </label>
            <input id="q" ref={searchBox} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm, gõ không dấu cũng được" autoFocus />
            <button
              className="icon-btn"
              aria-label="Đóng tìm kiếm"
              onClick={() => {
                setQuery("");
                setSearching(false);
              }}
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <div className="brand">
              <img src="/icons/icon-192.png" alt="" width={30} height={30} />
              <span>Nhớ Nha</span>
            </div>
            {snap.status === "offline" && (
              <span className="status-pill" role="status">
                <CloudOff size={16} aria-hidden="true" />
                {snap.pending ? `Chờ mạng · ${snap.pending}` : "Ngoại tuyến"}
              </span>
            )}
            <button className="icon-btn" aria-label="Tìm ghi chú" onClick={() => setSearching(true)}>
              <Search size={22} aria-hidden="true" />
            </button>
            <button className="icon-btn" aria-label="Lịch âm dương" onClick={() => setCalendar(true)}>
              <CalendarDays size={22} aria-hidden="true" />
            </button>
            <button className="icon-btn" aria-label="Gợi ý cách gõ" onClick={() => setHelp(true)}>
              <CircleHelp size={22} aria-hidden="true" />
            </button>
            <button className="icon-btn" aria-label="Cài đặt" onClick={() => setSettings("main")}>
              <Gear size={22} aria-hidden="true" />
            </button>
          </>
        )}
      </header>

      <div className="banners">
        {nudge === "inapp" && inApp && <EscapeInApp app={inApp} auto={false} signedIn />}
        {nudge === "blocked" && <Nudge icon={<BellOff size={20} />} tone="warn" text="Thông báo đang bị chặn" action="Cách mở" onAction={() => setSettings("notify")} />}
        {nudge === "off" && <Nudge icon={<BellRing size={20} />} text={push.problem ?? "Bật thông báo để được nhắc đúng giờ"} action="Bật" primary busy={push.busy} onAction={push.turnOn} />}
        {nudge === "install" && (
          <Nudge
            icon={isIOS() ? <Smartphone size={20} /> : <Download size={20} />}
            text={isIOS() ? "Cài app để được nhắc đúng giờ" : "Cài app vào máy để mở nhanh như app"}
            action="Cài app"
            onAction={() => (installBy === "prompt" ? void promptInstall() : setInstall(true))}
            onHide={() => hide("install")}
          />
        )}
        {nudge === "guest" && <Nudge icon={<ShieldCheck size={20} />} text="Ghi chú mới chỉ có trên máy này" action="Đăng nhập" onAction={() => void upgradeToGoogle()} onHide={() => hide("guest")} />}
        {tag && (
          <div className="banner">
            <div className="text">
              Đang lọc theo <strong style={{ display: "inline" }}>#{tag}</strong>
            </div>
            <button className="btn ghost" onClick={() => setTag(null)}>
              Bỏ lọc
            </button>
          </div>
        )}
      </div>

      <main className="feed">
        {list(s.due.some((n) => n.rule) ? "Đến giờ" : "Đã qua giờ", s.due, "due")}
        {list("Chờ người khác", s.waiting)}
        {list("Hôm nay", s.today)}
        {list("Ngày mai", s.tomorrow)}
        {list("Tuần này", s.week)}
        {list("Sau này", s.later)}
        {list("Ghi chú", s.plain)}
        {s.done.length > 0 && (
          <div className="done-toggle">
            <button className="btn ghost" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
              {showDone ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
              Đã xong · {s.done.length}
            </button>
          </div>
        )}
        {showDone && list("Đã xong", s.done.slice(0, 100))}
        {total === 0 && !query && !tag && snap.ready && <Empty now={now} offset={offset} onMore={() => setHelp(true)} />}
        {total === 0 && (query || tag) && <p className="empty">Không thấy ghi chú nào khớp.</p>}
        {!snap.ready && snap.notes.size === 0 && (
          <div className="center" style={{ minHeight: 200 }} role="status">
            <div className="spinner" aria-hidden="true" />
          </div>
        )}
      </main>

      <Composer now={now} offset={offset} groups={snap.groups} />

      {ringNote && ringing && (
        <div className="ringing" role="alert">
          <div>
            <BellRing size={24} aria-hidden="true" style={{ color: "var(--accent)", flex: "none" }} />
            <div className="text">
              <strong style={{ display: "block", overflowWrap: "anywhere" }}>{ringNote.title}</strong>
              <span className="small">Đến giờ rồi</span>
            </div>
            <button className="btn primary" onClick={() => (setOpen(ringing), setRinging(null))}>
              Mở
            </button>
            <button className="icon-btn" aria-label="Ẩn" onClick={() => setRinging(null)}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {openNote && <NoteSheet key={openNote.id} note={openNote} now={now} offset={offset} onClose={() => setOpen(null)} onTag={(t) => setTag(t)} />}
      {settings && (
        <Settings
          start={settings}
          me={me}
          push={push}
          onClose={() => setSettings(false)}
          onInstall={() => (setSettings(false), setInstall(true))}
          onLeave={onLeave}
          onMe={onMe}
          onEnter={onEnter}
          google={google}
          groups={snap.groups}
          onInvite={(code) => (setSettings(false), setInvite(code))}
        />
      )}
      {invite && <JoinSheet code={invite} myName={me.name} onClose={() => setInvite(null)} />}
      {install && <InstallSheet signedIn onClose={() => setInstall(false)} />}
      {calendar && <CalendarView notes={snap.notes} now={now} offset={offset} onClose={() => setCalendar(false)} onOpen={setOpen} onAdd={fillComposer} />}
      {help && (
        <HelpSheet
          now={now}
          offset={offset}
          onClose={() => setHelp(false)}
          onPick={(t) => {
            setHelp(false);
            fillComposer(t);
          }}
        />
      )}
    </div>
  );
}

/** Puts a line in the composer, as if typed, and leaves the cursor at its end. */
function fillComposer(t: string) {
  const box = document.getElementById("compose") as HTMLTextAreaElement | null;
  if (!box) return;
  // React keeps its own copy of the value: set it the way typing does, then say so.
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  set?.call(box, t);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  box.setSelectionRange(t.length, t.length);
}

/** Nothing yet: what to type, as lines that can be tried with a tap. */
function Empty({ now, offset, onMore }: { now: number; offset: number; onMore(): void }) {
  const fill = fillComposer;
  return (
    <div className="empty">
      <h2>Gõ như nhắn tin cho chính mình</h2>
      <p>App tự hiểu giờ trong câu và nhắc đúng lúc. Bấm thử một câu:</p>
      <div className="tries">
        {TRIES.map((t) => {
          const p = parse(t, now, offset);
          return (
            <button key={t} className="try" onClick={() => fill(t)}>
              <span>
                <Marked text={t} spans={p.spans} />
              </span>
              {/* A week of several times reads by its days: the next time alone would say 20:00 of 20:00 and 20:30. */}
              <span className="hint">{p.rule?.kind === "weekly" ? daysLabel([...new Set(p.rule.slots.flatMap((s) => s.wds))]) : p.due ? whenLabel(p.due, now, offset).split(" · ")[0] : p.items ? `${p.items.length} mục` : ""}</span>
            </button>
          );
        })}
      </div>
      <button className="btn ghost wide" onClick={onMore}>
        <CircleHelp size={18} aria-hidden="true" />
        Xem thêm câu mẫu
      </button>
    </div>
  );
}

/**
 * A nudge above the list, in one line: what to do, the button that does it,
 * and (unless it cannot wait) a × that puts it away for good.
 */
function Nudge({ icon, text, action, onAction, onHide, tone, primary, busy }: { icon: ReactNode; text: string; action: string; onAction(): void; onHide?(): void; tone?: "warn"; primary?: boolean; busy?: boolean }) {
  return (
    <div className={`banner nudge${tone ? ` ${tone}` : ""}`} role={tone ? "alert" : "note"}>
      <span className="ico" aria-hidden="true">
        {icon}
      </span>
      <span className="text">{text}</span>
      <button className={`btn ${primary ? "primary" : "teal"}`} onClick={onAction} disabled={busy}>
        {action}
      </button>
      {onHide && (
        <button className="icon-btn" aria-label={`Ẩn: ${text}`} onClick={onHide}>
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
