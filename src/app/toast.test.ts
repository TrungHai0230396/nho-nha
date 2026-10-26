import { afterEach, describe, expect, it, vi } from "vitest";
import { holdToast, toast, toastsNow } from "./state";

afterEach(() => vi.useRealTimers());

describe("toast", () => {
  it("keeps one with an action for ten seconds, and longer while held", () => {
    vi.useFakeTimers();
    toast("Đã xoá", { label: "Hoàn tác", run: () => {} }, { focus: true });
    const t = toastsNow().at(-1)!;
    expect(t.focus).toBe(true);
    const showing = () => toastsNow().some((x) => x.id === t.id);
    vi.advanceTimersByTime(9_000);
    expect(showing()).toBe(true);
    holdToast(t.id, true);
    vi.advanceTimersByTime(5_000);
    expect(showing()).toBe(true);
    holdToast(t.id, false);
    vi.advanceTimersByTime(2_000);
    expect(showing()).toBe(false);
  });
});
