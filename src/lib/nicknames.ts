// Names this phone gives people in its groups ("Vợ yêu" for Lan): kept
// here and sent nowhere, so only this phone shows them; the others keep
// seeing the name each person chose. By member key: one person in two
// groups is two keys, and leaving and joining again is a new one.
import { useSyncExternalStore } from "react";
import { LIMITS } from "../shared/protocol";

const KEY = "nhonha:nicknames";
const listeners = new Set<() => void>();

function read(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

let nicks: Record<string, string> = read();

export function setNickname(key: string, nick: string): void {
  const s = nick.replace(/\s+/g, " ").trim().slice(0, LIMITS.memberName);
  nicks = { ...nicks };
  if (s) nicks[key] = s;
  else delete nicks[key];
  try {
    localStorage.setItem(KEY, JSON.stringify(nicks));
  } catch {
    // Not kept past this visit; still shown now.
  }
  for (const f of listeners) f();
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export function useNicknames(): Record<string, string> {
  return useSyncExternalStore(subscribe, () => nicks);
}

/** A member as this phone calls them: its nickname if it has one, "bạn" for this person, or their own name. */
export function called(m: { key?: string; name: string; me?: boolean }, names: Record<string, string>): string {
  if (m.me) return "bạn";
  return (m.key && names[m.key]) || m.name;
}
