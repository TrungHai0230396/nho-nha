import type { DeviceReport, Me, PushKeyResponse, PushSubscribeRequest, SyncRequest, SyncResponse, TokenInfo } from "../shared/protocol";

/** The server says this phone is not signed in (any more). */
export class SignedOut extends Error {}

/** The server answered, with an error; `status` says which. Network failures throw TypeError instead. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function call<T>(path: string, body?: unknown, credentials: RequestCredentials = "same-origin"): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 401) throw new SignedOut();
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "");
  return data as T;
}

export const api = {
  me: () => call<Me>("/api/me"),
  config: () => call<{ google: boolean }>("/api/config"),
  /** "Dùng ngay": an account of this device, no sign-in. */
  guest: () => call<Me>("/api/guest", {}),
  sync: (req: SyncRequest) => call<SyncResponse & { rejected: string[] }>("/api/sync", req),
  /** Either or both: the morning list's hour, the hours of sleep. */
  settings: (s: { digestHour?: number | null; quiet?: Me["quiet"] }) => call<{ ok: true }>("/api/settings", s),
  logout: (endpoint: string | null) => call<{ ok: true }>("/api/logout", { endpoint }),
  deleteAccount: () => call<{ ok: true }>("/api/account/delete", { confirm: "XOA" }),
  pushKey: () => call<PushKeyResponse>("/api/push/key"),
  subscribe: (s: PushSubscribeRequest) => call<{ ok: true }>("/api/push/subscribe", s),
  unsubscribe: (endpoint: string) => call<{ ok: true }>("/api/push/unsubscribe", { endpoint }),
  pairInstall: () => call<{ code: string; expires: number }>("/api/pair/install", {}),
  pairCode: () => call<{ code: string; expires: number }>("/api/pair/code", {}),
  /** `app`: the installed app's first launch, whose code may be weeks old; a browser's must be fresh (worker/pair.ts). */
  pairRedeem: (code: string, app: boolean) => call<{ ok: true }>("/api/pair", { code, app }),
  /** Counting installs (lib/count): without the session cookie, so nothing goes with it that names anyone. */
  device: (report: DeviceReport) => call<{ ok: true }>("/api/device", report, "omit"),
  tokens: () => call<{ tokens: TokenInfo[] }>("/api/tokens"),
  newToken: (label: string) => call<{ token: string; tokens: TokenInfo[] }>("/api/tokens", { label }),
  revokeToken: (id: string) => call<{ tokens: TokenInfo[] }>("/api/tokens/revoke", { id }),
  /** "Nhắc chung" (worker/groups.ts). What changed comes back with the next sync. */
  groups: {
    invite: (code: string) => call<{ name: string; inviter: string; members: number }>(`/api/groups/invite?code=${encodeURIComponent(code)}`),
    create: (name: string, me: string) => call<{ id: string }>("/api/groups/create", { name, me }),
    join: (code: string, me: string) => call<{ id: string }>("/api/groups/join", { code, me }),
    leave: (id: string) => call<{ ok: true }>("/api/groups/leave", { id }),
    me: (id: string, name: string) => call<{ ok: true }>("/api/groups/me", { id, name }),
    rename: (id: string, name: string) => call<{ ok: true }>("/api/groups/rename", { id, name }),
    renew: (id: string) => call<{ ok: true }>("/api/groups/renew", { id }),
    remove: (id: string, key: string) => call<{ ok: true }>("/api/groups/remove", { id, key }),
    /** "Tắt tiếng nhóm này", for this person only. */
    mute: (id: string, muted: boolean) => call<{ ok: true }>("/api/groups/mute", { id, muted }),
    delete: (id: string) => call<{ ok: true }>("/api/groups/delete", { id }),
  },
};
