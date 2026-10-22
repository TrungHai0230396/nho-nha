// A browser's side of Web Push, for tests: the keys a subscription hands
// out, and reading a message back as the browser would (RFC 8291 §3.4).
import { b64url, type Bytes } from "../webpush";

const enc = new TextEncoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

export interface FakeBrowser {
  receiver: CryptoKeyPair;
  p256dh: Bytes;
  auth: Bytes;
  /** As PushSubscription.toJSON() has them. */
  keys: { p256dh: string; auth: string };
}

export async function fakeBrowser(): Promise<FakeBrowser> {
  const receiver = (await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = new Uint8Array((await crypto.subtle.exportKey("raw", receiver.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { receiver, p256dh, auth, keys: { p256dh: b64url(p256dh), auth: b64url(auth) } };
}

/** Throws when the message was not sealed for this browser. */
export async function readPush(body: Bytes, b: Pick<FakeBrowser, "receiver" | "auth">): Promise<string> {
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const senderPublic = body.slice(21, 21 + idLength);
  const receiverPublic = new Uint8Array((await crypto.subtle.exportKey("raw", b.receiver.publicKey)) as ArrayBuffer);
  const sender = await crypto.subtle.importKey("raw", senderPublic, ECDH, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: sender } as never, b.receiver.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...receiverPublic, ...senderPublic]);
  const ikm = await hkdf(b.auth, shared, info, 32);
  const cek = await crypto.subtle.importKey("raw", await hkdf(salt, ikm, new Uint8Array(enc.encode("Content-Encoding: aes128gcm\0")), 16), "AES-GCM", false, ["decrypt"]);
  const nonce = await hkdf(salt, ikm, new Uint8Array(enc.encode("Content-Encoding: nonce\0")), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cek, body.slice(21 + idLength)));
  if (plain.at(-1) !== 2) throw new Error("no last-record delimiter");
  return new TextDecoder().decode(plain.slice(0, -1));
}

/** A VAPID_KEY secret as scripts/deploy.sh makes one, and its public half. */
export async function vapidSecret(): Promise<{ secret: string; publicKey: Bytes }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { secret: JSON.stringify(jwk), publicKey: new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer) };
}
