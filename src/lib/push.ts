/**
 * Where this phone stands with notifications, for what the app offers:
 * - "install": an iPhone in Safari, where only the home-screen app may
 *   have them (iOS 16.4 and later);
 * - "unsupported": no push here (an old phone, Zalo's own browser), or the
 *   server has them off;
 * - "blocked": the phone was told no, and only its settings undo that;
 * - "off" / "on": turned on from this phone, or not.
 */
export type PushState = "install" | "unsupported" | "blocked" | "off" | "on";

export interface PushEnv {
  /** Service worker, PushManager and Notification all there. */
  push: boolean;
  ios: boolean;
  standalone: boolean;
  permission: "default" | "granted" | "denied" | null;
  /** Turned on from this phone and not turned off since. */
  saved: boolean;
  /** The server gave a key to subscribe with. */
  key: boolean;
}

export function pushState(env: PushEnv): PushState {
  if (env.ios && !env.standalone) return "install";
  if (!env.push || !env.key) return "unsupported";
  if (env.permission === "denied") return "blocked";
  return env.permission === "granted" && env.saved ? "on" : "off";
}

/** What this phone last told the server. */
export interface Saved {
  endpoint: string;
  at: number;
}

/** Told again at least this often while the app is in use: the server lets go of phones quiet for months. */
export const RENEW_MS = 24 * 3_600_000;

/** The browser made a new subscription (iOS drops them now and then), a day went by, or the clock went back. */
export function needsRenewal(saved: Saved, endpoint: string, now: number): boolean {
  return saved.endpoint !== endpoint || now - saved.at >= RENEW_MS || now < saved.at;
}

export function readSaved(raw: string | null): Saved | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Saved> | null;
    return v && typeof v.endpoint === "string" && v.endpoint && typeof v.at === "number" ? { endpoint: v.endpoint, at: v.at } : null;
  } catch {
    return null;
  }
}

/** The server's key (base64url) as the bytes pushManager.subscribe takes. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** A subscription made against another key can never be sent to again. */
export function sameKey(had: ArrayBuffer | null | undefined, key: Uint8Array): boolean {
  if (!had) return false;
  const a = new Uint8Array(had);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}
