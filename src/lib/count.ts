// Counting installs (worker/devices.ts, scripts/dem-may.sh): at most once a
// day, this device says what kind it is and whether it runs as the installed
// app. Under an id kept for this alone, never deviceId() (lib/ids): that one
// sits beside the account in push_subs, and a count that could be joined to
// it would be a count of people. No cookie goes with it either (lib/api).
import { deviceOffset, toWall } from "../shared/wall";
import { api } from "./api";
import { newId } from "./ids";
import { isIPad, isStandalone, platformOf } from "./pwa";

const ID = "nhonha:count";
const TOLD = "nhonha:counted";

/** What this device last told the server: the day, by its own calendar, and whether it ran as the app. */
export interface Told {
  day: string;
  standalone: boolean;
}

/**
 * Once a day; and once more on the day it first runs as the app after a tab,
 * where the two share the device's storage (Android, Chrome on a computer):
 * else an install made after the day's first visit would wait for tomorrow.
 */
export function dueToTell(told: Told | null, day: string, standalone: boolean): boolean {
  if (!told || told.day !== day) return true;
  return standalone && !told.standalone;
}

function readTold(raw: string | null): Told | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Told> | null;
    return v && typeof v.day === "string" && typeof v.standalone === "boolean" ? { day: v.day, standalone: v.standalone } : null;
  } catch {
    return null;
  }
}

let telling: Promise<void> | null = null;

/** Each time the app comes to the front; the server hears of it only when due. */
export function tellDevice(): Promise<void> {
  telling ??= tell().finally(() => (telling = null));
  return telling;
}

async function tell(): Promise<void> {
  let id: string;
  let told: Told | null;
  try {
    id = localStorage.getItem(ID) ?? "";
    if (!id) localStorage.setItem(ID, (id = newId()));
    told = readTold(localStorage.getItem(TOLD));
  } catch {
    // Nothing kept on this device: every opening would count as a new one.
    return;
  }
  const w = toWall(Date.now(), deviceOffset());
  const day = `${w.y}-${w.mo}-${w.d}`;
  const standalone = isStandalone();
  if (!dueToTell(told, day, standalone)) return;
  try {
    await api.device({ device: id, standalone, platform: platformOf(navigator.userAgent, isIPad()) });
    localStorage.setItem(TOLD, JSON.stringify({ day, standalone } satisfies Told));
  } catch {
    // No signal, or too many new devices at once (429): told the next time the app comes to the front.
  }
}
