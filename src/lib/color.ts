// Colours for the look a person picks (Cài đặt → Giao diện): any colour in,
// a whole palette out, in both themes, every pairing still readable. The
// teal palettes in styles.css are the pattern: each token keeps its
// lightness there and takes the picked hue, so a pale pink still gives
// dark text and a visible border; then each pairing is measured, and moved
// apart where a hue reads lighter than teal at the same lightness.

/** sRGB channels, 0 to 1. */
export type Rgb = [number, number, number];
/** OKLCH: lightness 0 to 1, chroma, hue in degrees. */
export type Lch = [number, number, number];

const TOKENS = [
  "bg",
  "card",
  "fg",
  "muted",
  "label",
  "primary",
  "primary-text",
  "chip-bg",
  "chip-fg",
  "accent",
  "on-accent",
  "control",
  "divider",
  "danger",
  "danger-bg",
  "warn",
  "warn-bg",
] as const;
export type Token = (typeof TOKENS)[number];
export type Palette = Record<Token, string>;

/** The palettes in styles.css (a test holds the two equal). */
export const LIGHT: Palette = {
  bg: "#f0fdfa",
  card: "#ffffff",
  fg: "#134e4a",
  muted: "#475569",
  label: "#1f3b38",
  primary: "#0d9488",
  "primary-text": "#0f766e",
  "chip-bg": "#ccfbf1",
  "chip-fg": "#115e59",
  accent: "#ea580c",
  "on-accent": "#000000",
  control: "#6b8f8a",
  divider: "#d5f0ea",
  danger: "#b91c1c",
  "danger-bg": "#fee2e2",
  warn: "#9a3412",
  "warn-bg": "#ffedd5",
};
export const DARK: Palette = {
  bg: "#042f2e",
  card: "#0b3b38",
  fg: "#ccfbf1",
  muted: "#a7c4c0",
  label: "#d5ebe7",
  primary: "#14b8a6",
  "primary-text": "#2dd4bf",
  "chip-bg": "#134e4a",
  "chip-fg": "#99f6e4",
  accent: "#fb923c",
  "on-accent": "#000000",
  control: "#4e8a84",
  divider: "#164e4a",
  danger: "#fca5a5",
  "danger-bg": "#3b1212",
  warn: "#fdba74",
  "warn-bg": "#3a2208",
};
export const DEFAULT_COLOR = LIGHT.primary;

/** Tokens that take the picked hue. Danger and warning keep theirs: red must still mean red. */
const HUED: Token[] = ["bg", "card", "fg", "muted", "label", "primary", "primary-text", "chip-bg", "chip-fg", "control", "divider"];

/**
 * What each pairing must keep, the first of each the one moved: the
 * levels styles.css was measured at, rounded down (body text 7:1, small
 * text 4.5:1, borders and fills 3:1).
 */
export const PAIRS: [Token, Token, number][] = [
  ["fg", "card", 7],
  ["fg", "bg", 7],
  ["label", "bg", 7],
  ["muted", "card", 4.5],
  ["muted", "bg", 4.5],
  ["primary-text", "card", 4.5],
  ["primary-text", "bg", 4.5],
  ["chip-fg", "chip-bg", 4.5],
  ["control", "card", 3],
  ["primary", "card", 3],
  ["accent", "on-accent", 4.5],
];

export interface Preset {
  name: string;
  hex: string;
}
/** The row of colours in Giao diện; any other is one tap away (the colour picker). */
export const PRESETS: Preset[] = [
  { name: "Ngọc", hex: DEFAULT_COLOR },
  { name: "Lá", hex: "#16a34a" },
  { name: "Vàng", hex: "#ca8a04" },
  { name: "Cam", hex: "#ea580c" },
  { name: "Đỏ", hex: "#dc2626" },
  { name: "Hồng", hex: "#db2777" },
  { name: "Sen", hex: "#c026d3" },
  { name: "Tím", hex: "#7c3aed" },
  { name: "Biển", hex: "#2563eb" },
  { name: "Trời", hex: "#0284c7" },
  { name: "Xám", hex: "#64748b" },
];

// ------------------------------------------------------------ colour math

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(c: Rgb): string {
  return `#${c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** "13 148 136", for rgb(… / alpha). */
const channels = (hex: string) => (hexToRgb(hex) ?? [0, 0, 0]).map((v) => Math.round(v * 255)).join(" ");

export function toOklch([r, g, b]: Rgb): Lch {
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

/** Linear sRGB, possibly outside 0–1. */
function linearOf([L, C, H]: Lch): Rgb {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** Into sRGB keeping lightness and hue, giving up chroma until it fits. */
export function fromOklch([L0, C0, H]: Lch): Rgb {
  const L = clamp(L0, 0, 1);
  const fits = (C: number) => linearOf([L, C, H]).every((v) => v >= -1e-5 && v <= 1 + 1e-5);
  let C = Math.max(0, C0);
  if (!fits(C)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    C = lo;
  }
  return linearOf([L, C, H]).map((v) => gam(clamp(v, 0, 1))) as Rgb;
}

export function contrast(a: Rgb, b: Rgb): number {
  const y = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const [hi, lo] = [y(a), y(b)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const contrastHex = (a: string, b: string) => contrast(hexToRgb(a)!, hexToRgb(b)!);
const lch = (hex: string) => toOklch(hexToRgb(hex)!);

// --------------------------------------------------------------- palettes

/** Black or white, whichever reads better on it. */
export function inkOn(hex: string): "#000000" | "#ffffff" {
  return contrastHex("#000000", hex) >= contrastHex("#ffffff", hex) ? "#000000" : "#ffffff";
}

/** Below this chroma a pick is a grey: its "hue" is noise. */
const GREY = 0.03;
/** Degrees round the wheel within which the orange accent would melt into the pick. */
const NEAR = 55;
const turn = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/**
 * The palette for a picked colour, from one of styles.css's: every hued
 * token at its own lightness, in the picked hue, as vivid as the pick is
 * against teal. The orange accent stays unless the pick is warm too (red,
 * orange, yellow, pink): then it turns blue, so the one button that
 * matters still stands apart. Turning it by teal's distance round the
 * wheel instead gave blue an olive button.
 */
export function derive(base: Palette, color: string): Palette {
  const pick = hexToRgb(color);
  if (!pick || color.toLowerCase() === DEFAULT_COLOR) return base;
  const [, Cu, Hu] = toOklch(pick);
  const Cp = lch(LIGHT.primary)[1];
  const k = Math.min(Cu / Cp, 1.6);
  const out = { ...base };
  for (const t of HUED) {
    const [L, C] = lch(base[t]);
    // Small text stays a grey with a hint of the colour, however loud the pick.
    out[t] = rgbToHex(fromOklch([L, C * (t === "muted" ? Math.min(k, 1) : k), Hu]));
  }
  // Decided on the light theme's orange, so both themes turn together.
  const warm = lch(LIGHT.accent)[2];
  if (Cu >= GREY && turn(Hu, warm) < NEAR) {
    const [La, Ca] = lch(base.accent);
    out.accent = rgbToHex(fromOklch([La, Ca, warm + 200]));
  }
  out["on-accent"] = inkOn(out.accent);
  // Twice round: a token moved for one pairing can fall short in another.
  for (let round = 0; round < 2; round++) {
    for (const [f, b, min] of PAIRS) out[f] = apart(out[f], out[b], min);
  }
  return out;
}

/** `hex`, lightened or darkened away from `against` until they reach `min`. */
function apart(hex: string, against: string, min: number): string {
  if (contrastHex(hex, against) >= min) return hex;
  const [L, C, H] = lch(hex);
  const step = lch(against)[0] > L ? -0.005 : 0.005;
  let out = hex;
  for (let l = L; l >= 0 && l <= 1; l += step) {
    out = rgbToHex(fromOklch([l, C, H]));
    if (contrastHex(out, against) >= min) break;
  }
  return out;
}

/** Light and dark palettes for a picked colour; the teal ones for none. */
export function palettes(color: string | null): { light: Palette; dark: Palette } {
  return color ? { light: derive(LIGHT, color), dark: derive(DARK, color) } : { light: LIGHT, dark: DARK };
}

/**
 * The palette as CSS custom properties, with the three tokens styles.css
 * writes from the others: the focus ring, the shadow, and the scrim behind
 * a sheet (in the light theme, the dark theme's background).
 */
export function cssVars(p: Palette, scheme: "light" | "dark", darkBg: string): string {
  const out = TOKENS.map((t) => `--${t}:${p[t]}`);
  if (scheme === "light") {
    out.push(`--scrim:rgb(${channels(darkBg)} / 0.55)`);
    out.push(`--shadow:0 1px 2px rgb(${channels(p.fg)} / 0.06), 0 4px 12px rgb(${channels(p.fg)} / 0.08)`);
    out.push(`--ring:0 0 0 3px rgb(${channels(p.primary)} / 0.45)`);
  } else {
    out.push("--scrim:rgb(0 0 0 / 0.6)");
    out.push("--shadow:0 1px 2px rgb(0 0 0 / 0.3), 0 6px 16px rgb(0 0 0 / 0.35)");
    out.push(`--ring:0 0 0 3px rgb(${channels(p["primary-text"])} / 0.55)`);
  }
  return out.join(";");
}
