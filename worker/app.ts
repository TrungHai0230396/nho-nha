import { handleAccount } from "./account";
import { GUEST_LIMITS, handleGuest } from "./guest";
import { handleCapture, handleTokens } from "./capture";
import { CSP } from "./csp";
import { handleDevice, type DEVICE_LIMITS } from "./devices";
import { handleSignIn, LOOPBACK, START_PATH, type Google, type Limits } from "./google";
import { handleGroups, handleInvite, notifyJoined } from "./groups";
import { json } from "./http";
import { handleSync } from "./notes";
import { page } from "./pages";
import { handlePairRedeem, handlePairStart, INSTALL, type PAIR_LIMITS } from "./pair";
import { handlePush, vapidFor } from "./push";
import { session } from "./session";
import { forUser, type Sql } from "./sql";

export interface Deps {
  sql: Sql;
  assets: { fetch(req: Request): Promise<Response> };
  now(): number;
  fetch?: typeof fetch;
  /** The VAPID_KEY secret (a JWK). Unset, no phone is offered notifications. */
  vapidKey?: string;
  /** Local runs only: a fake push service's origin, allowed beside the real ones. */
  pushTestOrigin?: string;
  /** Google sign-in (worker/google.ts); null or unset: off. */
  google?: Google | null;
  /** Where people write to about the app: on the privacy page. */
  contactEmail?: string;
  /** Tests lower the limits. */
  authLimits?: Partial<Limits>;
  pairLimits?: typeof PAIR_LIMITS;
  guestLimits?: typeof GUEST_LIMITS;
  deviceLimits?: typeof DEVICE_LIMITS;
  /** Tells the reminders' clock that a time may have come closer (worker/clock.ts). */
  wake?(): void;
  /** The VAPID contact (worker/clock.ts has the same): without it no push goes out. */
  subject?: string;
  /** Work that may finish after the answer has gone (ctx.waitUntil). */
  background?(work: Promise<unknown>): void;
}

const INSTALL_PATH = /^\/cai\/([^/]+)\/(manifest\.webmanifest)?$/;
const PRIVACY_PATH = "/rieng-tu";

export async function route(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const now = deps.now();
  // Keys the hash of a visitor's address in the rate-limit counters, and the
  // invites' HMAC. A key anyone could read would let the counters be
  // reversed into addresses (IPv4 is small) and invites be forged, so a
  // secret: the push key, there from the first deploy. A stand-in only on
  // this machine; anywhere else, without a secret, nothing below answers.
  const keyed = deps.vapidKey || deps.google?.clientSecret || (LOOPBACK.has(url.hostname) ? "nho-nha-local" : "");

  if (path === START_PATH || path.startsWith("/auth/")) {
    const res = await handleSignIn(req, url, { sql: deps.sql, now: deps.now, fetch: deps.fetch, authLimits: deps.authLimits }, deps.google ?? null);
    // A guest signing in brings their reminders into the account.
    if (res.status === 302 && path === "/auth/google") deps.wake?.();
    return harden(res);
  }
  if (path === PRIVACY_PATH) return harden(privacy(deps.contactEmail));
  if (path === "/manifest.webmanifest") return harden(manifest("/"));
  const install = INSTALL_PATH.exec(path);
  if (install) {
    const code = install[1] ?? "";
    // A code that is not even the right shape gets the plain app, not an error page.
    if (!INSTALL.test(code)) return Response.redirect(`${url.origin}/`, 302);
    // The page Safari adds to the home screen: the same app, with a manifest that starts it here.
    if (install[2]) return harden(manifest(`/cai/${code}/`));
    return shell(req, url, deps);
  }

  if (!path.startsWith("/api/")) return deps.assets.fetch(req);
  if (!keyed) return harden(json({ error: "no VAPID_KEY: run scripts/deploy.sh again" }, 503));

  // Not signed in yet, by design: a shortcut's token, a pairing code, and "Dùng ngay".
  if (path === "/api/capture") return harden(woke(await handleCapture(req, deps.sql, now), deps));
  if (path === "/api/guest") return harden(woke(await handleGuest(req, url, { sql: deps.sql, now, secret: keyed, limits: deps.guestLimits }), deps));
  // What this server has turned on, so the app does not offer what would only fail.
  if (path === "/api/config") return harden(json({ google: !!deps.google }));
  // An invite's group, for the page it opens before anyone has signed in.
  if (path === "/api/groups/invite" && req.method === "GET") return harden(await handleInvite(url, deps.sql, keyed));
  if (path === "/api/pair") {
    return harden(woke(await handlePairRedeem(req, url, { sql: deps.sql, now, secret: keyed, limits: deps.pairLimits }), deps));
  }
  // Counting installs: nobody's, so no session is looked at (worker/devices.ts).
  if (path === "/api/device") return harden(await handleDevice(req, url, { sql: deps.sql, now, secret: keyed, limits: deps.deviceLimits }));

  // Everything else is one person's, through their session.
  // A form or script on another site cannot act with their cookie: SameSite=Lax stops the forms, this the rest.
  if (req.method !== "GET" && req.headers.get("origin") !== url.origin) return harden(json({ error: "origin" }, 403));
  const me = await session(req, url, deps.sql, now);
  if (!me) return harden(json({ error: "signed out" }, 401));
  const sql = forUser(deps.sql, me.userId);
  if (path === "/api/sync") return harden(await handleSync(req, sql, now, deps.wake, keyed));
  if (path.startsWith("/api/groups/")) {
    // Someone new in a group: the others hear of it, after this answer has gone.
    const joined = (group: string) => {
      const subject = deps.subject;
      if (!deps.background || !subject) return;
      deps.background(
        vapidFor(deps.vapidKey)
          .then((vapid) => vapid && notifyJoined(deps.sql, group, me.userId, { vapid, subject, now, fetch: deps.fetch ?? fetch }))
          .catch((e: unknown) => console.error("nho-nha: join push failed", String(e))),
      );
    };
    return harden(await handleGroups(req, path, sql, now, keyed, joined));
  }
  if (path.startsWith("/api/push/")) return harden(await handlePush(req, path, sql, now, await vapidFor(deps.vapidKey), deps.pushTestOrigin));
  if (path === "/api/pair/install" || path === "/api/pair/code") return harden(await handlePairStart(req, path, sql, now));
  if (path === "/api/tokens" || path === "/api/tokens/revoke") return harden(await handleTokens(req, path, sql, now));
  const res = await handleAccount(req, url, path, sql, me.hash, now);
  return harden(path === "/api/settings" ? woke(res, deps) : res);
}

/** The reminders' clock looks again after a request that may have brought a time closer. */
function woke(res: Response, deps: Deps): Response {
  if (res.ok) deps.wake?.();
  return res;
}

async function shell(req: Request, url: URL, deps: Deps): Promise<Response> {
  const res = harden(await deps.assets.fetch(new Request(new URL("/", url), { headers: req.headers })), true);
  res.headers.set("cache-control", "no-cache");
  return res;
}

/**
 * `start`: where the installed app opens. /cai/<code>/ for the page
 * Safari installs from (see worker/pair.ts); the same `id` either way, so
 * it is one app to the phone.
 */
function manifest(start: string): Response {
  const body = {
    id: "/",
    name: "Nhớ Nha",
    short_name: "Nhớ Nha",
    description: "Ghi chú nhắc giờ, hiểu tiếng Việt và lịch âm",
    start_url: start,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "vi",
    background_color: "#f0fdfa",
    theme_color: "#0f766e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-cache" } });
}

function privacy(contact: string | undefined): Response {
  return page({
    title: "Quyền riêng tư",
    status: 200,
    lines: [
      "Nhớ Nha giữ ghi chú của bạn để mọi máy bạn đăng nhập đều thấy, và để gửi thông báo đúng giờ.",
      "Từ tài khoản Google, app chỉ lấy tên, email và mã tài khoản để biết bạn là ai. Không đọc gì khác trong Google của bạn.",
      "Dùng ngay không cần đăng nhập: ghi chú gắn với máy của bạn, không kèm tên hay email. Máy chủ vẫn giữ một bản để nhắc đúng giờ khi app đóng. Đăng nhập Google sau thì ghi chú gộp vào tài khoản.",
      "Ghi chú không được bán, không đem cho ai, không dùng để quảng cáo. Nội dung thông báo được mã hoá riêng cho máy của bạn.",
      // worker/devices.ts: what is kept, and only that, and for how long.
      "Để đếm số máy đã cài app, ngày nào mở app thì máy bạn gửi một lần: một mã ngẫu nhiên của riêng máy, loại máy (iPhone, Android, máy tính…) và app đang chạy từ màn hình chính hay trong trình duyệt. Máy chủ chỉ giữ chừng đó cùng ngày gửi, không gắn với tài khoản hay ghi chú nào, và xoá sau 90 ngày máy không mở app.",
      "Muốn xoá hết: vào Cài đặt, chọn Xoá tài khoản. Mọi ghi chú, máy đã đăng nhập và phím tắt bị xoá ngay, không lấy lại được.",
      // Time Travel (D1, 7 days) and scripts/sao-luu.sh (8 copies, weekly).
      "Để phòng sự cố, cơ sở dữ liệu có lịch sử 7 ngày do Cloudflare giữ, và có thể có bản sao lưu đã mã hoá giữ tối đa 8 tuần. Những gì đã xoá còn trong đó tới khi hết hạn, rồi mất hẳn.",
      ...(contact ? [`Liên hệ: ${contact}`] : []),
    ],
    buttons: [
      { href: "/", label: "Về app" },
      { href: "/licenses.txt", label: "Giấy phép thư viện" },
    ],
  });
}

function harden(res: Response, isHtml = false): Response {
  const out = new Response(res.body, res);
  // Pairing codes travel in /cai/… addresses: never hand them to another site.
  out.headers.set("referrer-policy", "no-referrer");
  out.headers.set("x-content-type-options", "nosniff");
  if (isHtml || (out.headers.get("content-type") ?? "").startsWith("text/html")) out.headers.set("content-security-policy", CSP);
  return out;
}
