// Random tokens and digests for sign-in: Web Crypto, so the same code runs
// in the Worker and under vitest.
import { b64url } from "./webpush";

const encoder = new TextEncoder();

/** `bytes` random bytes as base64url: 24 → 32 characters, 32 → 43. */
export function randomToken(bytes: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** base64url → UTF-8 text. Throws on anything that is not both. */
export function b64urlText(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  // fatal: names from Google are Vietnamese; mangled bytes must fail, not turn into U+FFFD.
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
}

/** HMAC-SHA-256 of `text` under `key`, hex. */
export async function hmacHex(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, encoder.encode(text)));
}

/** PKCE S256: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

/** Equal strings, compared in time that does not depend on where they differ. */
export function sameText(a: string | null, b: string | null): boolean {
  if (a === null || b === null || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
