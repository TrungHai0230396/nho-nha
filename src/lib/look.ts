// The look a person gave the app on this phone (Cài đặt → Giao diện): a
// colour, a wallpaper, light or dark. Kept on the phone, not the account:
// a wallpaper is a phone's own, like the one on its lock screen, and a
// photo has no business on the server.
import { useSyncExternalStore } from "react";
import { cssVars, palettes } from "./color";

export type Wall = "plain" | "glow" | "dots" | "grid" | "photo";
export type Scheme = "auto" | "light" | "dark";

export interface Look {
  /** The picked colour; null for the app's own teal. */
  color: string | null;
  wall: Wall;
  /** How much of the photo shows through, 0.2 to 1. */
  show: number;
  scheme: Scheme;
  /** A photo is kept, chosen or not. */
  photo: boolean;
}

export const DEFAULT_LOOK: Look = { color: null, wall: "plain", show: 0.7, scheme: "auto", photo: false };
const WALLS: Wall[] = ["plain", "glow", "dots", "grid", "photo"];
const KEY = "nho-nha-look";

/** The stored look, whatever an older version or a hand left there. */
export function readLook(raw: string | null): Look {
  let v: Record<string, unknown> = {};
  try {
    v = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // Unreadable: the app's own look.
  }
  if (!v || typeof v !== "object") v = {};
  const photo = v.photo === true;
  const wall = WALLS.includes(v.wall as Wall) ? (v.wall as Wall) : "plain";
  return {
    color: typeof v.color === "string" && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color.toLowerCase() : null,
    // A photo wallpaper with no photo kept would be a blank: plain instead.
    wall: wall === "photo" && !photo ? "plain" : wall,
    show: typeof v.show === "number" && v.show >= 0.2 && v.show <= 1 ? v.show : DEFAULT_LOOK.show,
    scheme: v.scheme === "light" || v.scheme === "dark" ? v.scheme : "auto",
    photo,
  };
}

/**
 * The stylesheet that puts a look's palette over styles.css's, or nothing
 * for the app's own. `:root:root` outranks styles.css's `:root` wherever
 * either is loaded. A theme forced against the phone's writes all of its
 * palette, the teal one too: half the tokens from each would leave red
 * text on a dark card.
 */
export function lookCss(look: Look): string {
  if (!look.color && look.scheme === "auto") return "";
  const { light, dark } = palettes(look.color);
  if (look.scheme === "light") return `:root:root{color-scheme:light;${cssVars(light, "light", dark.bg)}}`;
  if (look.scheme === "dark") return `:root:root{color-scheme:dark;${cssVars(dark, "dark", dark.bg)}}`;
  return `:root:root{${cssVars(light, "light", dark.bg)}}@media (prefers-color-scheme: dark){:root:root{${cssVars(dark, "dark", dark.bg)}}}`;
}

// ------------------------------------------------------------ the store

interface LookState {
  look: Look;
  /** The kept photo, as an object URL; null until read. */
  photo: string | null;
}

let state: LookState = { look: DEFAULT_LOOK, photo: null };
const listeners = new Set<() => void>();

function emit(next: LookState) {
  state = next;
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useLook(): LookState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Before the first render: the look on screen from the start, the photo a moment later. */
export function startLook() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage shut (private mode): the app's own look.
  }
  const look = readLook(raw);
  paint(look);
  emit({ look, photo: null });
  if (look.photo) {
    loadPhoto().then(
      (blob) => (blob ? emit({ ...state, photo: URL.createObjectURL(blob) }) : setLook({ photo: false, wall: state.look.wall === "photo" ? "plain" : state.look.wall })),
      () => {},
    );
  }
}

export function setLook(patch: Partial<Look>) {
  const look = { ...state.look, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // Not kept past this visit; still shown now.
  }
  paint(look);
  emit({ ...state, look });
}

/** A photo from the phone as the wallpaper: made small enough to keep, kept, shown. */
export async function setPhoto(file: File): Promise<void> {
  const blob = await shrink(file);
  await storePhoto(blob);
  if (state.photo) URL.revokeObjectURL(state.photo);
  emit({ ...state, photo: URL.createObjectURL(blob) });
  setLook({ photo: true, wall: "photo" });
}

export async function resetLook(): Promise<void> {
  if (state.photo) URL.revokeObjectURL(state.photo);
  emit({ ...state, photo: null });
  setLook(DEFAULT_LOOK);
  await dropPhoto().catch(() => {});
}

/**
 * What the page needs to wear a look: its stylesheet, the wallpaper's
 * mark, the colour of the phone's bars (light, dark) and the form
 * controls' theme. Kept as it is for public/look-boot.js, which puts it on
 * before the page first draws: a module script runs after that, and the
 * app opened teal, or white under a dark theme, for a moment each time.
 */
export interface Boot {
  css: string;
  wall: Wall | null;
  bars: [string, string];
  scheme: string;
}
export const BOOT_KEY = "nho-nha-look-boot";

export function bootOf(look: Look): Boot {
  const { light, dark } = palettes(look.color);
  const forced = look.scheme === "light" ? light.bg : look.scheme === "dark" ? dark.bg : null;
  return {
    css: lookCss(look),
    wall: look.wall === "plain" ? null : look.wall,
    bars: [forced ?? light.bg, forced ?? dark.bg],
    scheme: look.scheme === "auto" ? "light dark" : look.scheme,
  };
}

/** The same as public/look-boot.js does, for a look changed while the app is open. */
function paint(look: Look) {
  const b = bootOf(look);
  try {
    localStorage.setItem(BOOT_KEY, JSON.stringify(b));
  } catch {
    // The next launch opens in the app's own colours, then turns: no worse than before.
  }
  const root = document.documentElement;
  let style = document.getElementById("look") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "look";
    document.head.append(style);
  }
  style.textContent = b.css;
  if (b.wall) root.dataset.wall = b.wall;
  else delete root.dataset.wall;
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = (m.media || "").includes("dark") ? b.bars[1] : b.bars[0];
  const scheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (scheme) scheme.content = b.scheme;
}

// ------------------------------------------------------------ the photo

/** Long side, in pixels: sharp on a phone behind the list, and a few hundred KB. */
const PHOTO_SIDE = 1800;

/**
 * Through an <img>, not createImageBitmap: browsers turn a photo upright
 * (its EXIF) when drawing an image, not always when making a bitmap, and a
 * sideways wallpaper is the first thing anyone would see.
 */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Its own small database, apart from the notes': signing out or wiping the
// notes leaves the phone's wallpaper where it was.
let opened: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("nhonha-look", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("files", mode);
    const req = op(tx.objectStore("files"));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
}

const loadPhoto = () => run<Blob | undefined>("readonly", (s) => s.get("photo") as IDBRequest<Blob | undefined>).then((b) => b ?? null);
const storePhoto = (b: Blob) => run("readwrite", (s) => s.put(b, "photo"));
const dropPhoto = () => run("readwrite", (s) => s.delete("photo"));
