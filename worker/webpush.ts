// Web Push from the Worker with nothing but WebCrypto: each message
// encrypted for the one browser it goes to (RFC 8291, aes128gcm) and the
// request signed for the push service (VAPID, RFC 8292). No library: the
// usual ones are built on Node's crypto module, which a Worker lacks.

export type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
/** Text as bytes of its own buffer: what WebCrypto's types want for keys and infos. */
const text = (s: string): Bytes => new Uint8Array(enc.encode(s));

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Throws on anything that is not base64url (padded or not). */
export function fromB64url(s: string): Bytes {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error("not base64url");
  const b64 = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** The record size written in the header: one record holds the whole message. */
const RECORD_SIZE = 4096;
/** What fits in that one record: the delimiter and the 16-byte tag take the rest. */
export const MAX_PLAINTEXT = RECORD_SIZE - 17;

/** A one-off ECDH key pair; the public half travels in the message header. */
export interface Sender {
  privateKey: CryptoKey;
  /** Uncompressed point, 65 bytes. */
  publicKey: Bytes;
}

async function newSender(): Promise<Sender> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer) };
}

/**
 * `plaintext` sealed for the browser whose subscription gave `p256dh` (its
 * public key) and `auth` (a shared secret): the aes128gcm body of a push.
 * `sender` and `salt` are fresh each time; tests fix them to replay the
 * RFC's worked example.
 */
export async function encrypt(plaintext: Uint8Array, p256dh: Bytes, auth: Bytes, fixed: { sender?: Sender; salt?: Bytes } = {}): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("push message too long");
  const sender = fixed.sender ?? (await newSender());
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const receiver = await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // workers-types spell the field `$public`; the runtime, like every browser, reads `public`.
  const ecdh = { name: "ECDH", public: receiver } as unknown as Parameters<SubtleCrypto["deriveBits"]>[0];
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, sender.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(text("WebPush: info\0"), p256dh, sender.publicKey), 32);
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // The last (only) record: the message, then the delimiter 2, no padding.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = sender.publicKey.length;
  return concat(header, sender.publicKey, sealed);
}

/** The Worker's own key pair, which every subscription was made against. */
export interface Vapid {
  privateKey: CryptoKey;
  /** Uncompressed point, 65 bytes: what browsers take as applicationServerKey. */
  publicKey: Bytes;
}

/**
 * The VAPID_KEY secret: the private key as a JWK, whose x and y are the
 * public half. Null for anything else, so a bad secret turns
 * notifications off rather than failing each order.
 */
export async function readVapid(secret: string | undefined): Promise<Vapid | null> {
  if (!secret) return null;
  try {
    const k = JSON.parse(secret) as Record<string, unknown>;
    if (k.kty !== "EC" || k.crv !== "P-256" || typeof k.x !== "string" || typeof k.y !== "string" || typeof k.d !== "string") return null;
    const publicKey = concat(new Uint8Array([4]), fromB64url(k.x), fromB64url(k.y));
    if (publicKey.length !== 65) return null;
    const privateKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: k.x, y: k.y, d: k.d }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return { privateKey, publicKey };
  } catch {
    return null;
  }
}

/**
 * The Authorization header for one push service (RFC 8292): a JWT naming
 * that service, good for 12 hours (24 is the most they take), with a
 * contact for whoever runs it. Apple refuses a `subject` that is not an
 * https: or mailto: URL.
 */
export async function vapidHeader(v: Vapid, endpoint: string, subject: string, now: number): Promise<string> {
  const part = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));
  const signed = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  // WebCrypto signs ECDSA as r‖s, 64 bytes: the form JWS ES256 wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.privateKey, enc.encode(signed)));
  return `vapid t=${signed}.${b64url(sig)}, k=${b64url(v.publicKey)}`;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushOptions {
  vapid: Vapid;
  subject: string;
  now: number;
  fetch: typeof fetch;
  /** Seconds the push service keeps it for a phone that is off. */
  ttl: number;
  urgency: "normal" | "high";
  /** A later message with the same topic replaces one not yet delivered. */
  topic?: string;
  /** vapidHeader() for this endpoint's origin, made once for a run of many pushes (each one is a signature). */
  authorization?: string;
}

/** Sends one message to one browser; the push service's status comes back (201 is taken, 404/410 gone for good). */
export async function pushTo(target: PushTarget, message: unknown, o: PushOptions): Promise<number> {
  const body = await encrypt(enc.encode(JSON.stringify(message)), fromB64url(target.p256dh), fromB64url(target.auth));
  // Called on its own, not as o.fetch(…): the Workers runtime throws "Illegal
  // invocation" when its fetch runs with any `this` but the global one. Node does not mind.
  const post = o.fetch;
  const res = await post(target.endpoint, {
    method: "POST",
    headers: {
      authorization: o.authorization ?? (await vapidHeader(o.vapid, target.endpoint, o.subject, o.now)),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(o.ttl),
      urgency: o.urgency,
      ...(o.topic && /^[A-Za-z0-9_-]{1,32}$/.test(o.topic) ? { topic: o.topic } : {}),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  // The body is a reason at best; nothing reads it, so let it go.
  await res.body?.cancel();
  return res.status;
}
