// Notifications with the app closed (Web Push): a phone's subscription in
// or out, and sending to every phone a person turned them on for.
import type { PushKeyResponse, PushMessage } from "../src/shared/protocol";
import { isObject, json, readJson } from "./http";
import type { Sql, UserSql } from "./sql";
import { b64url, fromB64url, pushTo, readVapid, vapidHeader, type Vapid } from "./webpush";

const MAX_ENDPOINT_CHARS = 1_024;
/** More phones and browsers than one person has: past this, the one quiet longest goes. */
export const MAX_SUBS = 10;
/** A phone subscribes again at least daily while in use (src/app/notify.ts): one quiet this long is gone. */
export const SUB_IDLE_MS = 120 * 86_400_000;
const DEVICE = /^[A-Za-z0-9_-]{16,40}$/;

// The push services browsers use. A subscription anywhere else is refused,
// so nobody can make the Worker post to an address of their choosing.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome and the browsers built on it
  /^android\.googleapis\.com$/, // older Chrome
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/, // Safari, iPhone
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/, // Edge
];

/** `testOrigin`: local runs only, a fake push service beside the real ones (PUSH_TEST_ORIGIN). */
export function pushEndpointOk(endpoint: string, testOrigin?: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_CHARS) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (testOrigin && url.origin === testOrigin) return true;
  return url.protocol === "https:" && url.port === "" && !url.username && !url.password && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

let cached: { secret: string; vapid: Promise<Vapid | null> } | null = null;

/** The VAPID_KEY secret, read once per isolate. */
export function vapidFor(secret: string | undefined): Promise<Vapid | null> {
  if (!secret) return Promise.resolve(null);
  if (cached?.secret !== secret) cached = { secret, vapid: readVapid(secret) };
  return cached.vapid;
}

/** A browser's key as it must be to encrypt for it: `bytes` long, and a point on the curve for the public one. */
async function browserKey(v: unknown, bytes: 65 | 16): Promise<string | null> {
  if (typeof v !== "string" || v.length > 200) return null;
  try {
    const raw = fromB64url(v);
    if (raw.length !== bytes) return null;
    if (bytes === 65) await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
    return b64url(raw);
  } catch {
    return null;
  }
}

const IDLE_SQL = "DELETE FROM push_subs WHERE user_id = ?1 AND at < ?2";
// A browser holds one subscription: the one it had before this one is dead.
const SAME_DEVICE_SQL = "DELETE FROM push_subs WHERE user_id = ?1 AND device = ?2 AND endpoint <> ?3";
// The endpoint is the key: a browser someone else signed in on before is now this person's.
const UPSERT_SQL = `INSERT INTO push_subs (endpoint, user_id, device, p256dh, auth, at) VALUES (?2, ?1, ?3, ?4, ?5, ?6)
  ON CONFLICT (endpoint) DO UPDATE SET user_id = ?1, device = ?3, p256dh = ?4, auth = ?5, at = ?6`;
const CAP_SQL = `DELETE FROM push_subs WHERE user_id = ?1 AND endpoint NOT IN
  (SELECT endpoint FROM push_subs WHERE user_id = ?1 ORDER BY at DESC LIMIT ?2)`;
const DROP_SQL = "DELETE FROM push_subs WHERE user_id = ?1 AND endpoint = ?2";

export async function handlePush(req: Request, path: string, sql: UserSql, now: number, vapid: Vapid | null, testOrigin?: string): Promise<Response> {
  if (path === "/api/push/key" && req.method === "GET") {
    return json({ key: vapid ? b64url(vapid.publicKey) : null } satisfies PushKeyResponse);
  }
  if (path === "/api/push/subscribe" && req.method === "POST") {
    if (!vapid) return json({ error: "notifications off" }, 503);
    const b = await readJson(req, 4_000);
    if (!isObject(b) || typeof b.endpoint !== "string" || !pushEndpointOk(b.endpoint, testOrigin)) return json({ error: "bad subscription" }, 400);
    if (typeof b.device !== "string" || !DEVICE.test(b.device) || !isObject(b.keys)) return json({ error: "bad subscription" }, 400);
    const p256dh = await browserKey(b.keys.p256dh, 65);
    const auth = await browserKey(b.keys.auth, 16);
    if (!p256dh || !auth) return json({ error: "bad subscription" }, 400);
    await sql.batch([
      { sql: IDLE_SQL, params: [now - SUB_IDLE_MS] },
      { sql: SAME_DEVICE_SQL, params: [b.device, b.endpoint] },
      { sql: UPSERT_SQL, params: [b.endpoint, b.device, p256dh, auth, now] },
      { sql: CAP_SQL, params: [MAX_SUBS] },
    ]);
    return json({ ok: true });
  }
  if (path === "/api/push/unsubscribe" && req.method === "POST") {
    const b = await readJson(req, 4_000);
    if (!isObject(b) || typeof b.endpoint !== "string" || b.endpoint.length > MAX_ENDPOINT_CHARS) return json({ error: "bad subscription" }, 400);
    await sql.batch([{ sql: DROP_SQL, params: [b.endpoint] }]);
    return json({ ok: true });
  }
  if (["/api/push/key", "/api/push/subscribe", "/api/push/unsubscribe"].includes(path)) return json({ error: "method" }, 405);
  return json({ error: "not found" }, 404);
}

export interface Sub {
  user: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendDeps {
  vapid: Vapid;
  /** The VAPID contact: the app's https address, or mailto:. Apple refuses anything else. */
  subject: string;
  now: number;
  fetch: typeof fetch;
}

/** How long a push service keeps a reminder for a phone that is off: later than this it is old news. */
const TTL_SECONDS = 12 * 3600;

/**
 * Sends each message to its phones, all at once. Gives back the endpoints
 * the push services said are gone for good (404/410), to forget them.
 */
export async function sendAll(jobs: { sub: Sub; message: PushMessage }[], d: SendDeps): Promise<{ sent: number; gone: string[] }> {
  // One signature per push service per run, not one per message: each costs CPU the free plan counts.
  const headers = new Map<string, Promise<string>>();
  const auth = (endpoint: string) => {
    const origin = new URL(endpoint).origin;
    let h = headers.get(origin);
    if (!h) headers.set(origin, (h = vapidHeader(d.vapid, endpoint, d.subject, d.now)));
    return h;
  };
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    jobs.map(async ({ sub, message }) => {
      const host = new URL(sub.endpoint).host;
      try {
        const status = await pushTo(sub, message, {
          vapid: d.vapid,
          subject: d.subject,
          now: d.now,
          fetch: d.fetch,
          ttl: TTL_SECONDS,
          urgency: "high",
          topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
          authorization: await auth(sub.endpoint),
        });
        if (status === 404 || status === 410) gone.push(sub.endpoint);
        // The endpoint is that browser's secret address: only the host goes in the logs.
        else if (status >= 400) console.warn("push refused", host, status);
        else sent++;
      } catch (e) {
        console.warn("push failed", host, String(e));
      }
    }),
  );
  return { sent, gone };
}

/** Every subscription of these people, by person. */
export async function subsOf(sql: Sql, users: string[]): Promise<Map<string, Sub[]>> {
  const out = new Map<string, Sub[]>();
  if (!users.length) return out;
  const [rows = []] = await sql.batch([
    { sql: "SELECT user_id, endpoint, p256dh, auth FROM push_subs WHERE user_id IN (SELECT value FROM json_each(?1))", params: [JSON.stringify(users)] },
  ]);
  for (const r of rows) {
    const sub = { user: String(r.user_id), endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth) };
    out.set(sub.user, [...(out.get(sub.user) ?? []), sub]);
  }
  return out;
}
