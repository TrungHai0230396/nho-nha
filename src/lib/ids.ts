function randomId(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A note's id, made here so a note written with no signal already has one. 22 characters. */
export const newId = () => randomId(16);

const DEVICE_KEY = "nhonha:device";
let device: string | null = null;

/** This browser's own id: it tells the Worker which old subscription a new one replaces. */
export function deviceId(): string {
  if (device) return device;
  try {
    device = localStorage.getItem(DEVICE_KEY);
    if (!device) localStorage.setItem(DEVICE_KEY, (device = randomId(16)));
  } catch {
    device = randomId(16);
  }
  return device;
}
