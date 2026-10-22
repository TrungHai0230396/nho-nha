import { describe, expect, it } from "vitest";
import { DARK, LIGHT } from "./color";
import { bootOf, DEFAULT_LOOK, lookCss, readLook } from "./look";

describe("the stored look", () => {
  it("is the app's own when there is none, or it cannot be read", () => {
    expect(readLook(null)).toEqual(DEFAULT_LOOK);
    expect(readLook("{oops")).toEqual(DEFAULT_LOOK);
    expect(readLook("42")).toEqual(DEFAULT_LOOK);
  });

  it("keeps what it can of what an older version or a hand left", () => {
    expect(readLook(JSON.stringify({ color: "#DB2777", wall: "dots", show: 0.5, scheme: "dark" }))).toEqual({ color: "#db2777", wall: "dots", show: 0.5, scheme: "dark", photo: false });
    expect(readLook(JSON.stringify({ color: "pink", wall: "stars", show: 7, scheme: "dim" }))).toEqual(DEFAULT_LOOK);
  });

  it("never shows a photo wallpaper with no photo kept", () => {
    expect(readLook(JSON.stringify({ wall: "photo" })).wall).toBe("plain");
    expect(readLook(JSON.stringify({ wall: "photo", photo: true })).wall).toBe("photo");
  });
});

describe("the look's stylesheet", () => {
  it("is nothing for the app's own look: styles.css is the look", () => {
    expect(lookCss(DEFAULT_LOOK)).toBe("");
    expect(lookCss({ ...DEFAULT_LOOK, wall: "grid" })).toBe("");
  });

  it("follows the phone's theme for a colour, outranking styles.css", () => {
    const s = lookCss({ ...DEFAULT_LOOK, color: "#db2777" });
    expect(s.startsWith(":root:root{--bg:")).toBe(true);
    expect(s).toContain("@media (prefers-color-scheme: dark){:root:root{");
  });

  it("writes the whole palette of a theme forced against the phone's, teal too", () => {
    const dark = lookCss({ ...DEFAULT_LOOK, scheme: "dark" });
    expect(dark).toContain("color-scheme:dark");
    expect(dark).not.toContain("@media");
    // Red and amber too: the light theme's on a dark card would not read.
    expect(dark).toContain(`--danger:${DARK.danger}`);
    expect(dark).toContain(`--bg:${DARK.bg}`);
    expect(lookCss({ ...DEFAULT_LOOK, scheme: "light" })).toContain(`--warn:${LIGHT.warn}`);
  });
});

describe("what the page wears before it first draws", () => {
  it("is nothing to add for the app's own look", () => {
    expect(bootOf(DEFAULT_LOOK)).toEqual({ css: "", wall: null, bars: [LIGHT.bg, DARK.bg], scheme: "light dark" });
  });

  it("colours both of the phone's bars for a theme forced either way", () => {
    const dark = bootOf({ ...DEFAULT_LOOK, scheme: "dark", wall: "dots" });
    expect(dark).toMatchObject({ wall: "dots", bars: [DARK.bg, DARK.bg], scheme: "dark" });
    expect(bootOf({ ...DEFAULT_LOOK, color: "#db2777", scheme: "light" }).bars[1]).toBe(bootOf({ ...DEFAULT_LOOK, color: "#db2777", scheme: "light" }).bars[0]);
  });
});
