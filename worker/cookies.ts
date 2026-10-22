// The two cookies there are: a Google sign-in under way, and signed in.

/**
 * __Host-: only this exact host can set it, over https, so a sibling
 * subdomain (another app on the same workers.dev account) cannot plant
 * one. Plain http (wrangler dev on localhost) cannot hold a Secure cookie,
 * so it gets a plain one.
 */
export function cookieName(url: URL, base: "nhonha-signin" | "nhonha"): string {
  return url.protocol === "https:" ? `__Host-${base}` : base;
}

export function setCookie(url: URL, name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${url.protocol === "https:" ? "; Secure" : ""}`;
}

export const clearCookie = (url: URL, name: string) => setCookie(url, name, "", 0);

export function cookieOf(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
