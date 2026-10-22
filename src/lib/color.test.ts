import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, cssVars, DARK, DEFAULT_COLOR, derive, fromOklch, hexToRgb, inkOn, LIGHT, PAIRS, palettes, PRESETS, rgbToHex, toOklch, type Palette } from "./color";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
/** The custom properties of the first block that `start` opens, as written. */
function block(start: string): Map<string, string> {
  const from = css.indexOf(start);
  const body = css.slice(css.indexOf("{", from + start.length - 1) + 1);
  const end = body.indexOf("}");
  return new Map([...body.slice(0, end).matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const lightCss = block(":root {");
const darkCss = block("@media (prefers-color-scheme: dark) {\n  :root {");

const ratio = (a: string, b: string) => contrast(hexToRgb(a)!, hexToRgb(b)!);
const shortfalls = (p: Palette) => PAIRS.filter(([f, b, min]) => ratio(p[f], p[b]) < min).map(([f, b]) => `${f} on ${b}: ${ratio(p[f], p[b]).toFixed(2)}`);

describe("the palettes", () => {
  it("are the ones styles.css has, token for token", () => {
    for (const [t, v] of Object.entries(LIGHT)) expect(lightCss.get(t), t).toBe(v);
    for (const [t, v] of Object.entries(DARK)) expect(darkCss.get(t), t).toBe(v);
    // And the three written from the others come out as styles.css writes them.
    const vars = (s: string) => new Map(s.split(";").map((d) => d.slice(2).split(/:(.*)/s).slice(0, 2) as [string, string]));
    for (const [p, scheme, written] of [
      [LIGHT, "light", lightCss],
      [DARK, "dark", darkCss],
    ] as const) {
      const ours = vars(cssVars(p, scheme, DARK.bg));
      for (const t of ["scrim", "shadow", "ring"]) expect(ours.get(t), `${scheme} ${t}`).toBe(written.get(t));
    }
  });

  it("are readable as they stand, which is what every pick is held to", () => {
    expect(shortfalls(LIGHT)).toEqual([]);
    expect(shortfalls(DARK)).toEqual([]);
  });
});

describe("a picked colour", () => {
  const picks = [...PRESETS.map((p) => p.hex), "#ffff00", "#00ffff", "#ff00ff", "#0000ff", "#00ff00", "#ffb6c1", "#000000", "#ffffff", "#808080", "#3b0764", "#fef3c7"];

  it("keeps every pairing readable, in both themes, whatever it is", () => {
    for (const pick of picks) {
      const { light, dark } = palettes(pick);
      expect(shortfalls(light), `${pick} light`).toEqual([]);
      expect(shortfalls(dark), `${pick} dark`).toEqual([]);
    }
  });

  it("gives the app its own teal back, exactly", () => {
    expect(derive(LIGHT, DEFAULT_COLOR)).toBe(LIGHT);
    expect(palettes(null)).toEqual({ light: LIGHT, dark: DARK });
  });

  it("colours the app in its hue, and leaves red meaning red", () => {
    const pink = palettes("#db2777").light;
    expect(Math.abs(toOklch(hexToRgb(pink.primary)!)[2] - toOklch(hexToRgb("#db2777")!)[2])).toBeLessThan(3);
    expect(pink.danger).toBe(LIGHT.danger);
    expect(pink.card).toBe("#ffffff");
  });

  it("keeps the orange button apart from a warm colour, and the orange otherwise", () => {
    const hueOf = (hex: string) => toOklch(hexToRgb(hex)!)[2];
    for (const warm of ["#ea580c", "#dc2626", "#ca8a04", "#db2777"]) {
      const { light, dark } = palettes(warm);
      expect(hueOf(light.accent), warm).toBeGreaterThan(200);
      expect(hueOf(dark.accent), warm).toBeGreaterThan(200);
    }
    for (const cool of ["#2563eb", "#16a34a", "#7c3aed", "#64748b", "#000000"]) expect(palettes(cool).light.accent, cool).toBe(LIGHT.accent);
  });

  it("is a grey theme when it is a grey, with no hue made up", () => {
    const { light } = palettes("#808080");
    expect(toOklch(hexToRgb(light.primary)!)[1]).toBeLessThan(0.005);
    expect(light.accent).toBe(LIGHT.accent);
  });
});

describe("colour math", () => {
  it("goes there and back", () => {
    for (const hex of ["#0d9488", "#ea580c", "#ffffff", "#000000", "#7c3aed", "#fef3c7"]) expect(rgbToHex(fromOklch(toOklch(hexToRgb(hex)!)))).toBe(hex);
  });

  it("measures contrast as WCAG does", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#0d9488", "#ffffff")).toBeCloseTo(3.74, 2);
  });

  it("brings a colour no screen shows inside sRGB, keeping its lightness", () => {
    const [L] = toOklch(fromOklch([0.95, 0.3, 140]));
    expect(L).toBeCloseTo(0.95, 2);
  });

  it("writes black on what is light and white on what is dark", () => {
    expect(inkOn("#fef3c7")).toBe("#000000");
    expect(inkOn("#3b0764")).toBe("#ffffff");
  });

  it("reads only six-digit hex", () => {
    expect(hexToRgb("#abc")).toBeNull();
    expect(hexToRgb("red")).toBeNull();
    expect(hexToRgb("#0D9488")).toEqual(hexToRgb("#0d9488"));
  });
});
