// Google sign-in: OpenID Connect, the authorization code flow with PKCE
// (S256), state and nonce. It holds to: a state used once and bound to the
// browser that began it (login CSRF), the ID token's every claim checked,
// starts limited per address and overall, and a stand-in for Google that
// answers only on this machine. Only reached when googleConfig found a
// complete client; otherwise /dang-nhap says so.
//
// A finished sign-in sets the session cookie (worker/session.ts). An
// iPhone's home-screen app keeps its cookies apart from Safari's, and this
// page opened from it finishes in Safari: the app gets its own session
// from a pairing code instead (worker/pair.ts).
import { adoptGuest } from "./guest";
import { session as currentSession, signIn } from "./session";
import { clearCookie, cookieName, cookieOf, setCookie } from "./cookies";
import { b64urlText, hmacHex, pkceChallenge, randomToken, sameText } from "./crypto";
import { page, SIGN_IN_AGAIN } from "./pages";
import type { Sql } from "./sql";
import { b64url } from "./webpush";

export const START_PATH = "/dang-nhap";
/** The redirect URI registered with Google (README "Đăng nhập Google"). */
export const CALLBACK_PATH = "/auth/google";
const FAKE_PATH = "/auth/fake-google";
export const APP_PATH = "/";

export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
export const STATE_TTL_MS = 10 * 60 * 1000;
const SKEW_MS = 60 * 1000;
const STATE = /^[A-Za-z0-9_-]{43}$/;
export const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const EMAIL = /^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/;
const encoder = new TextEncoder();

export interface Google {
  clientId: string;
  clientSecret: string;
  /** "https://nhonha.app"; null: each request's own origin (workers.dev). */
  publicOrigin: string | null;
  /** GOOGLE_FAKE=1 (.dev.vars only). Takes effect only for requests to localhost, which none on Cloudflare is. */
  fake: boolean;
}

export interface GoogleEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PUBLIC_ORIGIN?: string;
  GOOGLE_FAKE?: string;
}

/** On only when everything it needs is there and well formed: never half on. */
export function googleConfig(env: GoogleEnv): Google | null {
  const clientId = text(env.GOOGLE_CLIENT_ID);
  const clientSecret = text(env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  const origin = publicOrigin(env.PUBLIC_ORIGIN);
  if (origin === undefined) {
    console.error("nho-nha: PUBLIC_ORIGIN must be an https origin like https://nhonha.app; Google sign-in stays off");
    return null;
  }
  return Object.freeze({ clientId, clientSecret, publicOrigin: origin, fake: env.GOOGLE_FAKE === "1" });
}

/** How an email is compared: trimmed, lowercase. For ADMIN_EMAILS only, never to find an account. */
export function normalEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// null: unset (use the request's origin). undefined: set but unusable.
function publicOrigin(v: unknown): string | null | undefined {
  const s = text(v);
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.has(u.hostname))) return undefined;
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/") return undefined;
  return u.origin;
}

export interface AuthDeps {
  sql: Sql;
  now(): number;
  fetch?: typeof fetch;
  /** Tests lower the limits. */
  authLimits?: Partial<Limits>;
}

// Limits on sign-ins BEGUN in the last ten minutes, not merely unfinished
// ones: begin, then call back with your own state, and a pending-only count
// never passes 1 while every round writes rows.
export interface Limits {
  /** Everyone together: bounds what an unauthenticated crowd can write. */
  starts: number;
  /** One address. IPv6 counts per /64: one customer's network hands out the rest freely. */
  perClient: number;
  /** Requests that carry no address at all (never on Cloudflare): one shared, small bucket. */
  unknown: number;
}
export const LIMITS: Limits = { starts: 300, perClient: 10, unknown: 5 };

export async function handleSignIn(req: Request, url: URL, deps: AuthDeps, g: Google | null): Promise<Response> {
  if (req.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
  if (!g) {
    return page({
      title: "Chưa mở đăng nhập",
      lines: ["Đăng nhập bằng Google chưa bật trên máy chủ này."],
      status: 503,
    });
  }
  if (url.pathname === START_PATH) return start(req, url, deps, g);
  if (url.pathname === CALLBACK_PATH) return callback(req, url, deps, g);
  if (url.pathname === FAKE_PATH && fakeHere(url, g)) return fakeChooser(url, deps, g);
  return new Response("Không có trang này.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * The local stand-in for Google. GOOGLE_FAKE=1 alone is not enough: the
 * request must also be addressed to this machine. On Cloudflare a request
 * reaches the Worker only through its own hostname, never as localhost.
 */
export function fakeHere(url: URL, g: Google): boolean {
  return g.fake && LOOPBACK.has(url.hostname);
}

/** Where Google sends the browser back to: PUBLIC_ORIGIN, or this request's own origin. */
export function originFor(url: URL, g: Google): string {
  return fakeHere(url, g) ? url.origin : (g.publicOrigin ?? url.origin);
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

/**
 * The address a limit counts by: IPv4 as it is, IPv6 by its /64, "unknown"
 * without one. Cloudflare sets CF-Connecting-IP itself; a client cannot.
 */
export function clientBucket(req: Request): string {
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim().toLowerCase();
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1]!;
  return v6Prefix(ip) ?? ip;
}

// The first four groups of an IPv6 address, written out: "2001:db8:1:2::/64".
function v6Prefix(ip: string): string | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const part = (s: string | undefined) => (s ? s.split(":") : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  // An embedded IPv4 (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) fills the last two groups.
  for (const groups of [head, tail]) {
    if (groups.length && groups[groups.length - 1]!.includes(".")) groups.splice(groups.length - 1, 1, "0", "0");
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!all.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return null;
  return `${all
    .slice(0, 4)
    .map((x) => x.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

// Rows older than the ten minutes go at the start of every sign-in request.
// Cheap: both sit behind an index, and a DELETE matching nothing writes nothing.
const windowOf = (now: number) => Math.floor(now / STATE_TTL_MS);
function sweep(now: number) {
  return [
    { sql: "DELETE FROM oauth_states WHERE created_at < ?1", params: [now - STATE_TTL_MS] },
    { sql: "DELETE FROM counters WHERE win < ?1", params: [windowOf(now) - 1] },
  ];
}

/** A new sign-in on its way: a row in oauth_states, or null when a limit says no. */
async function newFlow(deps: AuthDeps, g: Google, req: Request, url: URL) {
  const now = deps.now();
  const lim = { ...LIMITS, ...deps.authLimits };
  const bucket = clientBucket(req);
  // Not with the local stand-in: wrangler dev gives every request one
  // address, and a few abandoned tries would lock the developer out.
  // Keyed with the client secret, so the table never holds an address.
  const client = fakeHere(url, g) ? null : await hmacHex(g.clientSecret, `signin|${bucket}`);
  const perClient = bucket === "unknown" ? lim.unknown : lim.perClient;
  const since = now - STATE_TTL_MS;
  // This client's own starts first, an index range of at most its limit: a
  // refused start costs that and writes nothing.
  const [, , mine = []] = await deps.sql.batch([
    ...sweep(now),
    { sql: "SELECT COUNT(*) AS n FROM oauth_states WHERE client = ?1 AND created_at >= ?2", params: [client, since] },
  ]);
  if (client !== null && Number(mine[0]?.n ?? 0) >= perClient) return null;
  const state = randomToken(32);
  const verifier = randomToken(32);
  const nonce = randomToken(32);
  // Then everyone's: one counter row per ten-minute window, bumped for every
  // attempt that got this far, and the state written only within both limits,
  // checked again in this one transaction for two starts racing past the read.
  const [, , row = []] = await deps.sql.batch([
    { sql: "INSERT INTO counters (kind, win, n) VALUES ('signin', ?1, 1) ON CONFLICT (kind, win) DO UPDATE SET n = n + 1", params: [windowOf(now)] },
    {
      sql: `INSERT INTO oauth_states (state, verifier, nonce, created_at, client)
            SELECT ?1, ?2, ?3, ?4, ?5
            WHERE (SELECT n FROM counters WHERE kind = 'signin' AND win = ?6) <= ?7
              AND (?5 IS NULL OR (SELECT COUNT(*) FROM oauth_states WHERE client = ?5 AND created_at >= ?8) < ?9)`,
      params: [state, verifier, nonce, now, client, windowOf(now), lim.starts, since, perClient],
    },
    { sql: "SELECT 1 AS ok FROM oauth_states WHERE state = ?1", params: [state] },
  ]);
  return row[0] ? { state, nonce, challenge: await pkceChallenge(verifier) } : null;
}

function authUrl(g: Google, url: URL, flow: { state: string; nonce: string; challenge: string }): string {
  const origin = originFor(url, g);
  const q = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: flow.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${fakeHere(url, g) ? `${origin}${FAKE_PATH}` : GOOGLE_AUTH}?${q}`;
}

async function start(req: Request, url: URL, deps: AuthDeps, g: Google): Promise<Response> {
  const origin = originFor(url, g);
  // Begun on another host than the one Google returns to (workers.dev while
  // PUBLIC_ORIGIN is the domain): go there first, so the cookie below is set
  // where the callback can read it.
  if (url.origin !== origin) return redirect(`${origin}${START_PATH}`);
  const flow = await newFlow(deps, g, req, url);
  if (!flow) return page({ title: "Đang có nhiều lượt đăng nhập", lines: ["Thử lại sau ít phút."], status: 429, buttons: [SIGN_IN_AGAIN] });
  return redirect(authUrl(g, url, flow), [setCookie(url, cookieName(url, "nhonha-signin"), flow.state, STATE_TTL_MS / 1000)]);
}

// A state works once: marked used in the same statement that reads it, so a
// second request carrying it finds nothing, even one racing the first. The
// row stays until its ten minutes are up: it is how starts are counted.
async function takeFlow(deps: AuthDeps, state: string) {
  const now = deps.now();
  const [rows = []] = await deps.sql.batch([
    {
      sql: "UPDATE oauth_states SET used_at = ?2 WHERE state = ?1 AND used_at IS NULL RETURNING verifier, nonce, created_at",
      params: [state, now],
    },
    ...sweep(now),
  ]);
  const r = rows[0];
  return r ? { verifier: String(r.verifier), nonce: String(r.nonce), createdAt: Number(r.created_at) } : null;
}

async function callback(req: Request, url: URL, deps: AuthDeps, g: Google): Promise<Response> {
  const q = url.searchParams;
  const state = q.get("state") ?? "";
  const flow = STATE.test(state) ? await takeFlow(deps, state) : (await deps.sql.batch(sweep(deps.now())), null);
  // The cookie has done its job, whatever happens next.
  const bindName = cookieName(url, "nhonha-signin");
  const headers = new Headers({ "set-cookie": clearCookie(url, bindName) });

  if (q.has("error")) {
    // access_denied: Cancel was pressed at Google. Anything else is Google's own trouble.
    if (q.get("error") === "access_denied") {
      return page({ title: "Chưa đăng nhập", lines: ["Bạn chưa cho dùng tài khoản Google, nên chưa có gì thay đổi."], status: 200, buttons: [SIGN_IN_AGAIN], headers });
    }
    return failedPage(headers);
  }
  const now = deps.now();
  // Login CSRF: a stranger could begin a sign-in, finish it at Google with
  // their own account, and send the callback link to someone, who would then
  // write their notes into the stranger's account. So the state is bound to
  // the browser that began it by the cookie start() set.
  const bound = sameText(cookieOf(req, bindName), state);
  if (!flow || flow.createdAt < now - STATE_TTL_MS || !bound) {
    return page({ title: "Lượt đăng nhập đã hết hạn", lines: ["Lượt này đã dùng rồi, hoặc để quá lâu. Chưa có gì thay đổi."], status: 400, buttons: [SIGN_IN_AGAIN], headers });
  }
  const code = q.get("code") ?? "";
  if (!code || code.length > 4096) return failedPage(headers);
  const idToken = await exchange(deps, g, fakeHere(url, g), originFor(url, g), code, flow.verifier);
  const who = idToken === null ? null : checkIdToken(idToken, { clientId: g.clientId, nonce: flow.nonce, now });
  if (!who) return failedPage(headers);
  // Signed in as a guest on this browser before ("Dùng ngay"): what they wrote comes along.
  const before = await currentSession(req, url, deps.sql, now);
  const session = await signIn(deps, who);
  if (before) await adoptGuest(deps.sql, before.userId, session.userId);
  headers.append("set-cookie", setCookie(url, cookieName(url, "nhonha"), session.token, session.maxAgeSeconds));
  headers.set("location", `${originFor(url, g)}${APP_PATH}`);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers });
}

function failedPage(headers: Headers): Response {
  return page({ title: "Chưa đăng nhập được", lines: ["Google chưa xác nhận được tài khoản. Chưa có gì thay đổi, thử lại sau ít phút."], status: 502, buttons: [SIGN_IN_AGAIN], headers });
}

/** The code for an ID token, at Google's token endpoint. null on any failure. */
async function exchange(deps: AuthDeps, g: Google, fake: boolean, origin: string, code: string, verifier: string): Promise<string | null> {
  const body = new URLSearchParams({
    code,
    client_id: g.clientId,
    client_secret: g.clientSecret,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    grant_type: "authorization_code",
    code_verifier: verifier,
  }).toString();
  // Called on its own, not as deps.fetch(…): the Workers runtime throws "Illegal invocation" otherwise.
  const send = fake ? fakeTokenEndpoint(g, deps.now) : (deps.fetch ?? fetch);
  try {
    const res = await send(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200) {
      console.error("nho-nha: token endpoint answered", res.status);
      return null;
    }
    const data = (await res.json()) as { id_token?: unknown };
    return typeof data.id_token === "string" ? data.id_token : null;
  } catch (e) {
    // The message only: never the code, the secret or a token.
    console.error("nho-nha: token endpoint:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export interface Who {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * The claims of an ID token this flow asked for, or null. The signature is
 * not checked, deliberately: the token comes straight from Google's token
 * endpoint over TLS, in exchange for a one-time code plus this client's
 * secret and PKCE verifier, and OpenID Connect Core 3.1.3.7 lets TLS stand
 * in for the signature in exactly that case. Everything the token says
 * about who it is for is checked.
 */
export function checkIdToken(idToken: string, o: { clientId: string; nonce: string; now: number }): Who | null {
  if (idToken.length > 16384) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let c: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(b64urlText(parts[1]!));
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    c = v as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof c.iss !== "string" || !ISSUERS.has(c.iss)) return null;
  const aud = c.aud;
  if (!(aud === o.clientId || (Array.isArray(aud) && aud.includes(o.clientId) && c.azp === o.clientId))) return null;
  // Present, it names the client the token was issued to: ours, or not for us.
  if (c.azp !== undefined && c.azp !== o.clientId) return null;
  if (typeof c.exp !== "number" || !(c.exp * 1000 + SKEW_MS > o.now)) return null;
  if (typeof c.nonce !== "string" || c.nonce !== o.nonce) return null;
  if (typeof c.sub !== "string" || !c.sub || c.sub.length > 255) return null;
  return {
    sub: c.sub,
    email: typeof c.email === "string" ? c.email.slice(0, 320) : "",
    emailVerified: c.email_verified === true,
    name: typeof c.name === "string" ? c.name.slice(0, 200) : "",
  };
}

/* -------------------------------------------------------------- local stand-in for Google */

export const FAKE_PEOPLE = Object.freeze([
  { sub: "fake-a", email: "nguoi-a@vi-du.test", name: "Người thử A" },
  { sub: "fake-b", email: "nguoi-b@vi-du.test", name: "Người thử B" },
]);

// Google's account chooser, played locally: every choice goes back to the
// callback exactly as Google would, so the rest of the flow runs for real.
function fakeChooser(url: URL, deps: AuthDeps, g: Google): Response {
  const q = url.searchParams;
  const back = `${url.origin}${CALLBACK_PATH}`;
  const state = q.get("state") ?? "";
  if (q.get("client_id") !== g.clientId || q.get("redirect_uri") !== back || !STATE.test(state) || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge") || !q.get("nonce")) {
    return page({ title: "Yêu cầu không hợp lệ", lines: ["Google giả chỉ nhận đúng yêu cầu từ /dang-nhap."], status: 400 });
  }
  const buttons = FAKE_PEOPLE.map((p) => ({
    label: p.name,
    note: p.email,
    href: `${back}?${new URLSearchParams({ state, code: fakeCode(p, q, back, deps.now()) })}`,
  }));
  buttons.push({ label: "Không cho phép", note: "như bấm Huỷ ở Google", href: `${back}?${new URLSearchParams({ error: "access_denied", state })}` });
  return page({ title: "Google giả (chỉ trên máy này)", lines: ["Chọn tài khoản để thử đăng nhập:"], status: 200, buttons });
}

// Nothing is stored for a fake code, so it carries what the fake token
// endpoint must check: who, the nonce, the PKCE challenge, where it may be
// redeemed, and when it was made.
function fakeCode(person: { sub: string }, q: URLSearchParams, back: string, now: number): string {
  return b64url(encoder.encode(JSON.stringify({ p: person.sub, n: q.get("nonce"), c: q.get("code_challenge"), r: back, t: now })));
}

function fakeTokenEndpoint(g: Google, now: () => number): typeof fetch {
  const refuse = () => Response.json({ error: "invalid_grant" }, { status: 400 });
  return (async (endpoint: string, init: RequestInit) => {
    const f = new URLSearchParams(String(init.body));
    let c: { p?: unknown; n?: unknown; c?: unknown; r?: unknown; t?: unknown };
    try {
      c = JSON.parse(b64urlText(f.get("code") ?? "")) as typeof c;
    } catch {
      return refuse();
    }
    const person = FAKE_PEOPLE.find((p) => p.sub === c.p);
    const ok =
      endpoint === GOOGLE_TOKEN &&
      person &&
      f.get("grant_type") === "authorization_code" &&
      f.get("client_id") === g.clientId &&
      f.get("client_secret") === g.clientSecret &&
      f.get("redirect_uri") === c.r &&
      typeof c.t === "number" &&
      now() - c.t <= STATE_TTL_MS &&
      (await pkceChallenge(f.get("code_verifier") ?? "")) === c.c;
    if (!ok || !person) return refuse();
    const iat = Math.floor(now() / 1000);
    const claims = { iss: "https://accounts.google.com", azp: g.clientId, aud: g.clientId, sub: person.sub, email: person.email, email_verified: true, name: person.name, nonce: c.n, iat, exp: iat + 3600 };
    const part = (o: unknown) => b64url(encoder.encode(JSON.stringify(o)));
    return Response.json({ id_token: `${part({ alg: "RS256", kid: "fake", typ: "JWT" })}.${part(claims)}.ZmFrZQ`, token_type: "Bearer", expires_in: 3599 });
  }) as typeof fetch;
}
