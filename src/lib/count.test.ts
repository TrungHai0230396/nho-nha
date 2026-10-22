import { afterEach, describe, expect, it, vi } from "vitest";
import { dueToTell, tellDevice } from "./count";
import { deviceId } from "./ids";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

/** A phone as the app sees it: its storage, its browser, and what it sends (answered with `status`). */
function phone(ua: string, opts: { standalone?: boolean; status?: number; storage?: boolean } = {}) {
  const kept = new Map<string, string>();
  const sent: { url: string; init: RequestInit }[] = [];
  const state = { standalone: opts.standalone ?? false, status: opts.status ?? 200 };
  const broken = () => {
    throw new Error("SecurityError");
  };
  vi.stubGlobal(
    "localStorage",
    opts.storage === false
      ? { getItem: broken, setItem: broken, removeItem: broken }
      : { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, String(v)), removeItem: (k: string) => void kept.delete(k) },
  );
  vi.stubGlobal("navigator", { userAgent: ua, platform: "iPhone", maxTouchPoints: 5, standalone: false });
  vi.stubGlobal("matchMedia", () => ({ matches: state.standalone }));
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(state.status === 200 ? '{"ok":true}' : '{"error":"too many"}', { status: state.status });
  });
  return { kept, sent, state, body: (i: number) => JSON.parse(String(sent[i]!.init.body)) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when a device tells the server", () => {
  it("once a day", () => {
    expect(dueToTell(null, "2026-10-15", false)).toBe(true);
    expect(dueToTell({ day: "2026-10-15", standalone: false }, "2026-10-15", false)).toBe(false);
    expect(dueToTell({ day: "2026-10-14", standalone: true }, "2026-10-15", true)).toBe(true);
    expect(dueToTell({ day: "2026-10-14", standalone: true }, "2026-10-15", false)).toBe(true);
  });

  it("and once more the day it first runs as the app, never for a tab after the app", () => {
    expect(dueToTell({ day: "2026-10-15", standalone: false }, "2026-10-15", true)).toBe(true);
    expect(dueToTell({ day: "2026-10-15", standalone: true }, "2026-10-15", true)).toBe(false);
    expect(dueToTell({ day: "2026-10-15", standalone: true }, "2026-10-15", false)).toBe(false);
  });
});

describe("what a device tells", () => {
  it("three things, under an id of its own, with no cookie and no user agent", async () => {
    const p = phone(IPHONE, { standalone: true });
    await tellDevice();
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]!.url).toBe("/api/device");
    expect(p.sent[0]!.init.credentials).toBe("omit");
    const body = p.body(0);
    expect(Object.keys(body).sort()).toEqual(["device", "platform", "standalone"]);
    expect(body).toMatchObject({ standalone: true, platform: "iphone" });
    expect(body.device).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Not the id its push subscription carries, which the server keeps beside the account.
    expect(body.device).not.toBe(deviceId());
    expect(String(p.sent[0]!.init.body)).not.toMatch(/Mozilla|iPhone OS|Safari/);
    // Opened again that day: nothing goes.
    await tellDevice();
    expect(p.sent).toHaveLength(1);
  });

  it("the same id every day, and again the day a tab becomes the installed app", async () => {
    const p = phone(ANDROID);
    await tellDevice();
    expect(p.body(0)).toMatchObject({ standalone: false, platform: "android" });
    p.state.standalone = true;
    await tellDevice();
    await tellDevice();
    expect(p.sent).toHaveLength(2);
    expect(p.body(1)).toMatchObject({ device: p.body(0).device, standalone: true });
    // The next day, by this phone's own calendar.
    p.kept.set("nhonha:counted", JSON.stringify({ day: "2000-1-1", standalone: true }));
    await tellDevice();
    expect(p.sent).toHaveLength(3);
    expect(p.body(2).device).toBe(p.body(0).device);
  });

  it("tries again next time when the server did not take it", async () => {
    const p = phone(IPHONE, { status: 429 });
    await tellDevice();
    p.state.status = 200;
    await tellDevice();
    await tellDevice();
    expect(p.sent).toHaveLength(2);
  });

  it("nothing where nothing can be kept: it would be a new device every opening", async () => {
    const p = phone(IPHONE, { storage: false });
    await tellDevice();
    expect(p.sent).toHaveLength(0);
  });
});
