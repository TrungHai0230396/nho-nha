import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("takes a success it cannot read as no answer", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>a captive portal</html>", { status: 200 }));
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
  });

  it("gives up on a request that hangs", async () => {
    // A real 15 s would slow the tests: the timeout asked for, made to fire at once.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    vi.stubGlobal("fetch", (_: string, init: RequestInit) =>
      init.signal?.aborted ? Promise.reject(init.signal.reason) : new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    await expect(api.me()).rejects.toThrow("timed out");
    expect(timeout).toHaveBeenCalledWith(15_000);
    timeout.mockRestore();
  });
});
