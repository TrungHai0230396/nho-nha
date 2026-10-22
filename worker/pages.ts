// The few pages the Worker writes itself, on the way into or out of
// Google's sign-in. Everything else is the app.

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

export interface Button {
  href: string;
  label: string;
  /** A line under it. */
  note?: string;
}

export interface PageOptions {
  title: string;
  lines: string[];
  status: number;
  buttons?: Button[];
  headers?: Headers;
}

const STYLE = "font:18px/1.5 system-ui,sans-serif;padding:32px 20px;max-width:32rem;margin:auto;color:#134e4a;background:#f0fdfa";
const BUTTON =
  "display:inline-block;margin-top:12px;padding:12px 20px;border-radius:12px;background:#0f766e;color:#fff;text-decoration:none;font-weight:600";

export function page(o: PageOptions): Response {
  const buttons = (o.buttons ?? [])
    .map((b) => `<p><a href="${esc(b.href)}" style="${BUTTON}">${esc(b.label)}</a>${b.note ? `<br><small>${esc(b.note)}</small>` : ""}</p>`)
    .join("\n");
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(o.title)}</title>
<body style="${STYLE}">
<h1 style="font-size:24px">${esc(o.title)}</h1>
${o.lines.map((l) => `<p>${esc(l)}</p>`).join("\n")}
${buttons}
</body></html>`;
  const headers = new Headers(o.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(html, { status: o.status, headers });
}

/** Sign in again: the button most pages on the way end with. */
export const SIGN_IN_AGAIN: Button = { href: "/dang-nhap", label: "Đăng nhập lại" };
