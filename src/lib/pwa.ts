import { useSyncExternalStore } from "react";
import type { Platform } from "../shared/protocol";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const INSTALLED_KEY = "nhonha:installed";

function remember(installed: boolean) {
  try {
    if (installed) localStorage.setItem(INSTALLED_KEY, "1");
    else localStorage.removeItem(INSTALLED_KEY);
  } catch {
    // Not remembered: the next visit just offers to install again.
  }
}

function notify() {
  for (const f of listeners) f();
}

/**
 * Chrome offers installing by firing beforeinstallprompt, once, and only
 * while the app is not installed. Kept for the "Cài app" button; and the
 * install remembered, because once it is installed Chrome stops offering,
 * and a page that then showed install-it-by-hand steps sent people looking
 * for a menu item that was not there.
 */
export function captureInstallPrompt() {
  // Opened from the home screen: installed, whatever was remembered.
  if (isStandalone()) remember(true);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    // Offered again, so it is not installed (any more): removed since.
    remember(false);
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    remember(true);
    notify();
  });
}

export function canPromptInstall(): boolean {
  return installEvent !== null;
}

export async function promptInstall(): Promise<boolean> {
  const e = installEvent;
  if (!e) return false;
  // Spent: Chrome offers it once a page. The buttons go now, while its own box is open, not when it closes.
  installEvent = null;
  notify();
  await e.prompt();
  const accepted = (await e.userChoice).outcome === "accepted";
  if (accepted) remember(true);
  notify();
  return accepted;
}

/**
 * Where this phone stands: "app" opened from its icon, "installed" but
 * open in the browser, "ready" for one-tap install, "manual" when only the
 * browser's own menu can do it (iPhone, or Chrome not offering yet).
 */
export type InstallState = "app" | "installed" | "ready" | "manual";

export function installState(): InstallState {
  if (isStandalone()) return "app";
  if (installEvent) return "ready";
  try {
    if (localStorage.getItem(INSTALLED_KEY) === "1") return "installed";
  } catch {
    // Unknown: offer the steps.
  }
  return "manual";
}

/** Changes when Chrome offers to install, late, or when the app gets installed. */
export function subscribeInstall(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** installState, kept current: Chrome offers it a moment after the page opens, and it may get installed meanwhile. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribeInstall, installState);
}

/**
 * How this device puts the app on itself, if it can: "prompt", our own
 * button opening the browser's install box (Chrome and Edge, on a computer
 * or Android); "steps", only through the browser's menu, shown as steps
 * (iPhone, a Mac's Safari); null when it is installed, inside Zalo's or
 * Facebook's browser, or in a browser that cannot (Firefox).
 *
 * Every button was the iPhone's alone, and on Android the page even hid
 * Chrome's own install bar (captureInstallPrompt) while offering nothing in
 * its place: a computer or an Android phone had no way in but the menu
 * (Hải, 14/10/2026: "làm nút tải luôn đi giống điện thoại").
 */
export type InstallWay = "prompt" | "steps" | null;

export function installWay(state: InstallState, ua: string, ipad: boolean, inApp: boolean): InstallWay {
  if (state === "app" || state === "installed" || inApp) return null;
  if (state === "ready") return "prompt";
  return /iPhone|iPod/.test(ua) || ipad || macSafari(ua, ipad) ? "steps" : null;
}

/** A Mac's Safari 17 or later: it installs a web app from its own menu (Tệp → Thêm vào Dock), never by asking. */
export function macSafari(ua: string, ipad: boolean): boolean {
  if (ipad || !/Macintosh/.test(ua) || /Chrome|Chromium|Edg\/|Firefox|OPR\//.test(ua)) return false;
  return Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0) >= 17;
}

/** A computer rather than a phone or tablet: the browser's install icon is in its address bar. */
export function onComputer(ua: string, ipad: boolean): boolean {
  return !ipad && !/Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

/**
 * What kind of device this is, for counting installs (lib/count): only this
 * word leaves the phone, never the user agent it is read from. `ipad` as
 * isIPad() says, since an iPad's user agent claims a Mac. An iPod counts as
 * an iPhone; Linux, ChromeOS and the rest are "other".
 */
export function platformOf(ua: string, ipad: boolean): Platform {
  if (ipad) return "ipad";
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (/Android/i.test(ua)) return "android";
  if (!onComputer(ua, ipad)) return "other";
  if (/Macintosh/.test(ua)) return "mac";
  return /Windows/.test(ua) ? "windows" : "other";
}

export function isStandalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent) || isIPad();
}

export function isIPad(): boolean {
  const ua = navigator.userAgent;
  // An iPad says it is a Mac; a Mac has no touch points. An Android phone is never one.
  return /iPad/.test(ua) || (!/Android/i.test(ua) && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Where installing starts on an iPhone or iPad: the Share button ("more":
 * inside ⋯ on the bottom bar, "bar": on it, "top": top right, "menu": the
 * browser's own menu), and whether "Thêm vào MH chính" sits behind "Xem
 * thêm" or further down the list. Safari 26 folded Share into ⋯ and the
 * action behind "Xem thêm", which the steps written for Safari 18 did not
 * know (Hải, on his iPhone, 12/10/2026). Safari's Version/ follows iOS;
 * another browser's says nothing of iOS, so its sheet may be either.
 */
export interface ShareWay {
  button: "more" | "bar" | "top" | "menu";
  sheet: "more" | "scroll" | "either";
}

export function shareWay(ua: string, ipad: boolean): ShareWay {
  if (/CriOS\//.test(ua)) return { button: "top", sheet: "either" };
  if (/FxiOS\/|EdgiOS\/|OPiOS\/|OPT\//.test(ua)) return { button: "menu", sheet: "either" };
  const v = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
  const sheet = v >= 26 ? "more" : v > 0 ? "scroll" : "either";
  if (ipad) return { button: "top", sheet };
  return { button: v > 0 && v < 26 ? "bar" : "more", sheet };
}

/**
 * The same page in the phone's real browser, from inside Zalo's or
 * Facebook's: iOS 17 opens Safari for an x-safari-https:// address, and
 * Android opens Chrome for an intent:// one. Whether the app around the
 * page lets either through is that app's choice, so this is tried, never
 * relied on: the link to copy and the menu steps stay on screen.
 */
export function escapeUrl(href: string, ua: string): string | null {
  const u = new URL(href);
  if (u.protocol !== "https:") return null;
  if (/Android/i.test(ua)) return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  if (/iPhone|iPad|iPod/.test(ua)) return `x-safari-${href}`;
  return null;
}

/**
 * The apps that open links in their own browser, where the app can neither
 * be installed nor notified, named so the way out can say where the reader
 * is. Vendor tokens only (FBAN, FB_IAB, Zalo…), never a word a real Safari
 * or Chrome could carry. Messenger first: its user agent carries Facebook's
 * tokens too, and Orca-Android is Messenger for Android without the word.
 * The same list as the trade journal's src/lib/in-app-browser.ts.
 */
const IN_APP: { name: string; re: RegExp }[] = [
  { name: "Messenger", re: /FBAN\/Messenger|MessengerForiOS|Messenger[Ll]ite|Orca-Android/ },
  { name: "Facebook", re: /FBAN|FBAV|FB_IAB|FB4A|FBIOS/ },
  { name: "Zalo", re: /\bZalo\b/i },
  { name: "Instagram", re: /\bInstagram\b/ },
  { name: "TikTok", re: /BytedanceWebview|musical_ly|\bTikTok\b/i },
  { name: "LINE", re: /\bLine\/\d/ },
];

export function inAppName(ua: string): string | null {
  return IN_APP.find((a) => a.re.test(ua))?.name ?? null;
}

export function inAppBrowser(): string | null {
  return inAppName(navigator.userAgent);
}

/**
 * The new version waits instead of taking over mid-session: the old page
 * may still lazy-load a chunk that only the old cache has, and a note may
 * be half typed. Right after launch there is nothing to
 * lose, so it is applied at once; later, `onUpdate` offers a button.
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void) {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  const launchedAt = performance.now();
  const hadController = navigator.serviceWorker.controller !== null;

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  const offer = (worker: ServiceWorker) => {
    const apply = () => worker.postMessage("skip-waiting");
    if (performance.now() - launchedAt < 4000) apply();
    else onUpdate(apply);
  };

  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      if (reg.waiting && hadController) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
        });
      });
    })
    .catch((e: unknown) => console.warn("service worker not registered", e));
}

/** The pairing code in an install address (/cai/<code>/), as worker/pair.ts makes it. */
export const INSTALL_CODE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The install code this tab last asked for. An install address is a way
 * into the account that made it, and a link can come from anyone: only one
 * this tab made is put on the home screen as this account's (app/App.tsx).
 */
const OWN_CODE = "nhonha:install-code";

/** Remembers `code` as this tab's own; false when the browser keeps nothing, so none can be told apart. */
export function keepOwnCode(code: string): boolean {
  try {
    sessionStorage.setItem(OWN_CODE, code);
    return sessionStorage.getItem(OWN_CODE) === code;
  } catch {
    return false;
  }
}

export function isOwnCode(code: string): boolean {
  try {
    return sessionStorage.getItem(OWN_CODE) === code;
  } catch {
    return false;
  }
}

/** Where "allow notifications" lives, which is not the same place on every phone. */
export function blockedHow(): string {
  if (isIOS()) return "Mở Cài đặt của iPhone → Thông báo → Nhớ Nha → bật Cho phép thông báo.";
  if (isStandalone()) return "Giữ biểu tượng Nhớ Nha → Thông tin ứng dụng → Thông báo → bật.";
  return "Bấm biểu tượng bên trái thanh địa chỉ → Quyền / Thông báo → Cho phép, rồi tải lại trang.";
}
