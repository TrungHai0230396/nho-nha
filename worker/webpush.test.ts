import { describe, expect, it } from "vitest";
import { fakeBrowser as browser, readPush as decryptFor, vapidSecret } from "./testing/push";
import { b64url, encrypt, fromB64url, MAX_PLAINTEXT, pushTo, readVapid, vapidHeader, type Bytes } from "./webpush";

const enc = new TextEncoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** A private key given as its 32-byte scalar plus the public point, as the RFC prints them. */
function ecdhJwk(d: string, publicKey: Bytes): JsonWebKey {
  return { kty: "EC", crv: "P-256", d, x: b64url(publicKey.slice(1, 33)), y: b64url(publicKey.slice(33)) };
}

describe("base64url", () => {
  it("goes both ways, with or without padding", () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 250, 1]);
    expect(b64url(bytes)).toBe("AP8-P_oB");
    expect([...fromB64url("AP8-P_oB")]).toEqual([...bytes]);
    expect([...fromB64url("AP8=")]).toEqual([0, 255]);
    expect(() => fromB64url("AP8+")).toThrow();
    expect(() => fromB64url("A")).toThrow();
  });
});

describe("encrypt", () => {
  it("matches the worked example of RFC 8291, byte for byte", async () => {
    const senderPublic = fromB64url("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    const privateKey = await crypto.subtle.importKey("jwk", ecdhJwk("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", senderPublic), ECDH, false, ["deriveBits"]);
    const body = await encrypt(
      enc.encode("When I grow up, I want to be a watermelon"),
      fromB64url("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
      fromB64url("BTBZMqHH6r4Tts7J_aSIgg"),
      { sender: { privateKey, publicKey: senderPublic }, salt: fromB64url("DGv6ra1nlYgDCS1FRnbzlw") },
    );
    expect(b64url(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("is read back by the browser it was made for, and differs every time", async () => {
    const b = await browser();
    const text = JSON.stringify({ title: "Đơn mới của chị Lan", body: "2 món: Mì Hảo Hảo × 2 gói, Bia Tiger (lạnh)" });
    const one = await encrypt(enc.encode(text), b.p256dh, b.auth);
    const two = await encrypt(enc.encode(text), b.p256dh, b.auth);
    expect(await decryptFor(one, b)).toBe(text);
    expect(b64url(one)).not.toBe(b64url(two));
    // Another phone's secret does not open it.
    await expect(decryptFor(one, { receiver: b.receiver, auth: crypto.getRandomValues(new Uint8Array(16)) })).rejects.toThrow();
  });

  it("refuses a message longer than one record holds", async () => {
    const b = await browser();
    await expect(encrypt(new Uint8Array(MAX_PLAINTEXT), b.p256dh, b.auth)).resolves.toBeInstanceOf(Uint8Array);
    await expect(encrypt(new Uint8Array(MAX_PLAINTEXT + 1), b.p256dh, b.auth)).rejects.toThrow();
  });
});

describe("VAPID", () => {
  it("reads the secret, and nothing else", async () => {
    const { secret, publicKey } = await vapidSecret();
    expect(b64url((await readVapid(secret))!.publicKey)).toBe(b64url(publicKey));
    const jwk = JSON.parse(secret) as Record<string, string>;
    for (const bad of [undefined, "", "not json", "{}", JSON.stringify({ ...jwk, crv: "P-384" }), JSON.stringify({ ...jwk, d: undefined }), JSON.stringify({ ...jwk, x: "AAAA" })]) {
      expect(await readVapid(bad)).toBeNull();
    }
  });

  it("signs a token for the push service's origin, checkable with the public key it carries", async () => {
    const { secret, publicKey } = await vapidSecret();
    const now = 1_800_000_000_000;
    const header = await vapidHeader((await readVapid(secret))!, "https://fcm.googleapis.com/fcm/send/abc:def", "https://vi-du.test", now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, head, claims, sig, k] = m!;
    expect(k).toBe(b64url(publicKey));
    expect(JSON.parse(new TextDecoder().decode(fromB64url(head!)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(fromB64url(claims!)))).toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + 43_200, sub: "https://vi-du.test" });
    const verifier = await crypto.subtle.importKey("raw", fromB64url(k!), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, fromB64url(sig!), enc.encode(`${head}.${claims}`))).toBe(true);
  });
});

describe("pushTo", () => {
  it("posts the sealed message with what a push service needs", async () => {
    const b = await browser();
    const vapid = (await readVapid((await vapidSecret()).secret))!;
    const sent: Request[] = [];
    const fetchStub = async function (this: unknown, url: string, init: RequestInit) {
      // As the Workers runtime does: its fetch throws on any `this` but the global one.
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      sent.push(new Request(url, init));
      return new Response(null, { status: 201 });
    } as typeof fetch;
    const target = { endpoint: "https://web.push.apple.com/QGuQyavXutnMH", p256dh: b64url(b.p256dh), auth: b64url(b.auth) };
    const message = { title: "Đơn đã soạn xong", body: "Tổng 23.500đ", tag: "order:1", audience: "shopper" };
    const opts = { vapid, subject: "https://vi-du.test", now: 1_800_000_000_000, fetch: fetchStub, ttl: 43_200, urgency: "high" as const };
    expect(await pushTo(target, message, { ...opts, topic: "0123456789abcdef0123456789abcdef" })).toBe(201);
    const req = sent[0]!;
    expect(req.url).toBe(target.endpoint);
    expect(req.method).toBe("POST");
    expect(req.headers.get("content-encoding")).toBe("aes128gcm");
    expect(req.headers.get("ttl")).toBe("43200");
    expect(req.headers.get("urgency")).toBe("high");
    expect(req.headers.get("topic")).toBe("0123456789abcdef0123456789abcdef");
    expect(req.headers.get("authorization")).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(JSON.parse(await decryptFor(new Uint8Array(await req.arrayBuffer()), b))).toEqual(message);
    // A topic the header cannot carry is left out, not sent broken.
    await pushTo(target, message, { ...opts, topic: "order:1" });
    expect(sent[1]!.headers.has("topic")).toBe(false);
  });
});
