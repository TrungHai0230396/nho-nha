import { useEffect, useState, useSyncExternalStore } from "react";
import { api, SignedOut } from "../lib/api";
import * as idb from "../lib/idb";
import { NotesStore, type Snapshot } from "../lib/store";
import type { Me } from "../shared/protocol";
import { deviceOffset } from "../shared/wall";

/* ------------------------------------------------------------------ toasts */

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run(): void };
  /** Its action takes the focus: what was focused is gone ("Xoá"), and "Hoàn tác" must be in reach. */
  focus?: boolean;
}

let toasts: Toast[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((f) => f());

/** Toasts a pointer is over or the focus is in: they wait, or "Hoàn tác" goes as it is reached. */
const held = new Set<number>();
export const holdToast = (id: number, on: boolean) => void (on ? held.add(id) : held.delete(id));

/**
 * A short message above the composer, gone in two and a half seconds, or
 * ten with an action to take: six were too few to reach "Hoàn tác" by
 * keyboard or screen reader. Not while held.
 */
export function toast(text: string, action?: Toast["action"], opts: { focus?: boolean } = {}) {
  const t: Toast = { id: ++toastSeq, text, action, ...(action && opts.focus ? { focus: true } : {}) };
  toasts = [...toasts.slice(-2), t];
  emitToasts();
  const expire = () => (held.has(t.id) ? setTimeout(expire, 1500) : dismissToast(t.id));
  setTimeout(expire, action ? 10_000 : 2500);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

/** The toasts showing now, outside React (tests). */
export const toastsNow = (): readonly Toast[] => toasts;

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (f) => {
      toastListeners.add(f);
      return () => toastListeners.delete(f);
    },
    () => toasts,
  );
}

/* ------------------------------------------------------------------- notes */

export const store = new NotesStore({
  persist: { load: idb.loadAll, save: idb.save, wipe: idb.wipe, drop: idb.drop, settle: idb.settle },
  transport: { sync: api.sync },
  offset: deviceOffset,
  isSignedOut: (e) => e instanceof SignedOut,
  onRejected: (ids) => toast(ids.length === 1 ? "Có 1 ghi chú máy chủ không nhận (có thể đã đầy 5.000 ghi chú)." : `Có ${ids.length} ghi chú máy chủ không nhận.`),
});

export function useNotes(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

let pending: ReturnType<typeof setTimeout> | null = null;
/** Soon, not now: three quick changes go up together. */
export function syncSoon() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void store.sync();
  }, 600);
}

/** Keeps the copy fresh while the app is open: on return, on signal, and every minute. */
export function startAutoSync(): () => void {
  const now = () => void store.sync();
  const look = () => {
    if (document.visibilityState === "visible") now();
  };
  window.addEventListener("online", now);
  document.addEventListener("visibilitychange", look);
  const every = setInterval(() => {
    if (document.visibilityState === "visible") now();
  }, 60_000);
  now();
  return () => {
    window.removeEventListener("online", now);
    document.removeEventListener("visibilitychange", look);
    clearInterval(every);
  };
}

/** The clock, ticking every `ms`: "đến giờ" moves without a tap. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    const back = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", back);
    };
  }, [ms]);
  return now;
}

/* ------------------------------------------------------------------ config */

const CONFIG_KEY = "nhonha:google";

/**
 * Whether the server has Google sign-in on. Until Hải adds the OAuth
 * client it is off, and the app offers only "Dùng ngay" rather than a
 * button that leads to "Chưa mở đăng nhập". Remembered for opening offline.
 */
export function useGoogleOn(): boolean {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(CONFIG_KEY) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    api.config().then(
      (c) => {
        setOn(c.google);
        try {
          localStorage.setItem(CONFIG_KEY, c.google ? "1" : "0");
        } catch {
          // Asked again next time.
        }
      },
      () => {},
    );
  }, []);
  return on;
}

/* ---------------------------------------------------------------------- me */

const ME_KEY = "nhonha:me";

/** Who was signed in here last: the app opens with no signal on what this phone already has. */
export function cachedMe(): Me | null {
  try {
    const v = JSON.parse(localStorage.getItem(ME_KEY) ?? "null") as Me | null;
    return v && typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}

export function cacheMe(me: Me | null) {
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
    else localStorage.removeItem(ME_KEY);
  } catch {
    // Not kept: the next opening with no signal shows the sign-in page.
  }
}
