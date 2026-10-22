export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { status, headers: h });
}

/** The body as JSON, or null when it is too long or not JSON. */
export async function readJson(req: Request, maxChars: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxChars * 4) return null;
  const text = await req.text();
  if (text.length > maxChars) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Minutes east of UTC that a real clock can be on (UTC−12 … UTC+14). */
export const isOffset = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= -720 && v <= 840;
