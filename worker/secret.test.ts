import { describe, expect, it } from "vitest";
import { route } from "./app";
import { testApp } from "./testing/app";

// Without VAPID_KEY or a Google secret, the counters' and invites' key would be a string anyone can read.
describe("the key for counters and invites", () => {
  it("refuses the API on a real address when there is no secret", async () => {
    const { deps } = testApp();
    deps.google = null;
    const res = await route(new Request("https://vi-du.test/api/config"), deps);
    expect(res.status).toBe(503);
  });

  it("lets this machine run with a stand-in", async () => {
    const { deps } = testApp();
    deps.google = null;
    const res = await route(new Request("http://localhost:8787/api/config"), deps);
    expect(res.status).toBe(200);
  });
});
