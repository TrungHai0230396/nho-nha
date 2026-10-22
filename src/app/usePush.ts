import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { deviceId } from "../lib/ids";
import { keyBytes, needsRenewal, pushState, readSaved, sameKey, type PushState, type Saved } from "../lib/push";
import { isIOS, isStandalone } from "../lib/pwa";

const KEY_CACHE = "nhonha:pushKey";
const SAVED = "nhonha:push";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not kept: asked again next time.
  }
}

const pushHere = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const permission = () => ("Notification" in window ? Notification.permission : null);

/** A worker that never registered (an error, a dev build) leaves `ready` waiting for ever. */
function ready(): Promise<ServiceWorkerRegistration> {
  return Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, no) => setTimeout(() => no(new Error("no service worker")), 10_000))]);
}

/** This browser's subscription against the server's key: the one it has, or a new one (asks nothing once allowed). */
async function subscription(key: string): Promise<PushSubscription> {
  const reg = await ready();
  const bytes = keyBytes(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, bytes)) {
    await sub.unsubscribe();
    sub = null;
  }
  return sub ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }));
}

/** The endpoint this phone gave the server, for signing out: the next person here must not get these. */
export const savedEndpoint = () => readSaved(get(SAVED))?.endpoint ?? null;
export const forgetPush = () => put(SAVED, null);

export interface Push {
  state: PushState;
  busy: boolean;
  problem: string | null;
  /** From a tap: iPhone asks for the permission only inside one. */
  turnOn(): void;
  turnOff(): void;
}

/**
 * Notifications with the app closed. Once on, the subscription is renewed
 * each day the app is opened, and made again if the browser dropped it:
 * iPhone does that now and then, and a reminders app that silently stops
 * reminding is worse than none.
 */
export function usePush(): Push {
  const [key, setKey] = useState<string | null>(() => get(KEY_CACHE));
  const [saved, setSaved] = useState<Saved | null>(() => readSaved(get(SAVED)));
  const [perm, setPerm] = useState(permission);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Fresh each opening; kept for one opened with no signal.
  useEffect(() => {
    let live = true;
    api.pushKey().then(
      (k) => {
        if (!live) return;
        setKey(k.key);
        put(KEY_CACHE, k.key);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  // Allowed or not can change in the phone's settings while the app is away.
  useEffect(() => {
    const look = () => {
      if (document.visibilityState === "visible") setPerm(permission());
    };
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, []);

  const register = useCallback(async (sub: PushSubscription) => {
    const { keys } = sub.toJSON();
    await api.subscribe({ endpoint: sub.endpoint, keys: { p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" }, device: deviceId() });
    const s = { endpoint: sub.endpoint, at: Date.now() };
    put(SAVED, JSON.stringify(s));
    setSaved(s);
  }, []);

  // On: kept up each opening.
  const endpoint = saved?.endpoint;
  useEffect(() => {
    if (!key || !endpoint || !pushHere() || Notification.permission !== "granted") return;
    let live = true;
    void (async () => {
      const sub = await subscription(key);
      const was = readSaved(get(SAVED));
      if (live && was && needsRenewal(was, sub.endpoint, Date.now())) await register(sub);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [key, endpoint, register]);

  const turnOn = () => {
    if (!key || busy || !pushHere()) return;
    setBusy(true);
    setProblem(null);
    // Asked before anything is awaited: later, iPhone no longer counts it as the tap's.
    let asked: Promise<NotificationPermission>;
    try {
      asked = Promise.resolve(Notification.requestPermission());
    } catch {
      asked = Promise.resolve(Notification.permission);
    }
    void (async () => {
      try {
        const answer = await asked;
        setPerm(answer);
        if (answer !== "granted") return;
        await register(await subscription(key));
      } catch {
        setProblem("Chưa bật được. Cần có mạng, bấm lại sau.");
      } finally {
        setBusy(false);
      }
    })();
  };

  const turnOff = () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    void (async () => {
      try {
        if (endpoint) await api.unsubscribe(endpoint);
        put(SAVED, null);
        setSaved(null);
      } catch {
        setProblem("Chưa tắt được. Cần có mạng, bấm lại sau.");
      } finally {
        setBusy(false);
      }
    })();
  };

  const state = pushState({ push: pushHere(), ios: isIOS(), standalone: isStandalone(), permission: perm, saved: saved !== null, key: key !== null });
  return { state, busy, problem, turnOn, turnOff };
}

/** The app is in front: what the notifications said, it shows itself. */
export async function clearNotifications(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    for (const n of (await reg?.getNotifications()) ?? []) n.close();
  } catch {
    // Nothing to clear.
  }
}
