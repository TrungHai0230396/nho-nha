// A Worker to drive from tests: real routes, real SQL on node:sqlite, the
// local stand-in for Google, and a clock the test moves.
import { route, type Deps } from "../app";
import type { Google } from "../google";
import { memorySql } from "./sqlite";

export const ORIGIN = "http://localhost:8787";

export function testApp(start = Date.UTC(2026, 9, 12, 3, 30)) {
  const sql = memorySql();
  const clock = { now: start };
  const google: Google = { clientId: "test-client", clientSecret: "test-secret", publicOrigin: null, fake: true };
  const deps: Deps = {
    sql,
    assets: { fetch: async () => new Response("<!doctype html><title>app</title>", { headers: { "content-type": "text/html" } }) },
    now: () => clock.now,
    google,
  };
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.method && init.method !== "GET" && !headers.has("origin")) headers.set("origin", ORIGIN);
    return route(new Request(`${ORIGIN}${path}`, { ...init, headers }), deps);
  };
  const post = (path: string, body: unknown, cookie?: string) => call(path, { method: "POST", body: JSON.stringify(body), cookie, headers: { "content-type": "application/json" } });

  /** Signs in through the fake Google as one of its people; the session cookie comes back. */
  async function signIn(person: "fake-a" | "fake-b" = "fake-a"): Promise<string> {
    const start = await call("/dang-nhap");
    const signinCookie = cookiePair(start, "nhonha-signin");
    const chooser = await route(new Request(start.headers.get("location")!), deps);
    const html = await chooser.text();
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
    const pick = links.find((l) => l.includes("code=") && decodeURIComponent(l).length > 0 && whoIn(l) === person)!;
    const back = await call(new URL(pick).pathname + new URL(pick).search, { cookie: signinCookie });
    if (back.status !== 302) throw new Error(`sign-in failed: ${back.status} ${await back.text()}`);
    return cookiePair(back, "nhonha");
  }

  return { sql, clock, deps, call, post, signIn };
}

/** "name=value" of a cookie a response set. */
export function cookiePair(res: Response, name: string): string {
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(";")[0]!;
    if (pair.startsWith(`${name}=`)) return pair;
  }
  throw new Error(`no ${name} cookie`);
}

// The fake code carries who was picked (worker/google.ts fakeCode): read it back to pick by person.
function whoIn(link: string): string | null {
  const code = new URL(link).searchParams.get("code");
  if (!code) return null;
  try {
    return (JSON.parse(atob(code.replace(/-/g, "+").replace(/_/g, "/"))) as { p: string }).p;
  } catch {
    return null;
  }
}
