import { useCallback, useEffect, useState } from "react";
import { api, ApiError, SignedOut } from "../lib/api";
import { pendingInvite } from "../lib/groups";
import { inAppBrowser, INSTALL_CODE, isOwnCode, isStandalone, keepOwnCode } from "../lib/pwa";
import type { Me } from "../shared/protocol";
import { Main } from "../ui/Main";
import { Toasts } from "../ui/Toasts";
import { Welcome } from "../ui/Welcome";
import { cachedMe, cacheMe, store } from "./state";

type Phase = { kind: "loading"; text?: string } | { kind: "welcome"; notice?: string; tone?: "invite" } | { kind: "main"; me: Me };

const SPENT = "Mã cài app đã dùng rồi hoặc hết hạn. Đăng nhập lại, hoặc nhập mã ghép từ máy khác.";
const OFFLINE = "Cần có mạng để đăng nhập lần đầu.";
const WAS_SPENT = "nhonha:code-spent";

/** The code an installed iPhone app was started with (/cai/<code>/), if any. */
function installCode(): string | null {
  const m = /^\/cai\/([^/]+)\/?$/.exec(location.pathname);
  return m && INSTALL_CODE.test(m[1]!) ? m[1]! : null;
}

/**
 * A browser whose code did not work, to the plain address: a page at
 * /cai/<code>/ puts that code on the home screen, so it must not stay. A
 * reload, not history.replaceState: the page's manifest was read from there.
 */
function leaveSpent(): void {
  try {
    sessionStorage.setItem(WAS_SPENT, "1");
  } catch {
    // Said nowhere then; the welcome page is enough.
  }
  location.replace("/");
}

function wasSpent(): boolean {
  try {
    const was = sessionStorage.getItem(WAS_SPENT) === "1";
    sessionStorage.removeItem(WAS_SPENT);
    return was;
  } catch {
    return false;
  }
}

/** The server said no (not: no signal, when the code may still be good). */
const answered = (err: unknown) => err instanceof ApiError || err instanceof SignedOut;

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const enter = useCallback(async (me: Me) => {
    await store.claim(me.id);
    cacheMe(me);
    setPhase({ kind: "main", me });
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const owner = await store.load().catch(() => null);
      const code = installCode();
      try {
        const me = await api.me();
        // Signed in here, a code in the address is not spent: it may be anyone's link, and would
        // trade this account for theirs. The install steps this page shows need a code of this
        // account, so a browser makes its own, unless this tab made the one there (InstallSheet).
        if (code && !isStandalone() && !isOwnCode(code)) {
          const mine = await api.pairInstall().then((r) => r.code, () => null);
          if (mine && keepOwnCode(mine)) return location.replace(`/cai/${mine}/`);
          history.replaceState(null, "", `/${location.search}`);
        }
        if (live) await enter(me);
      } catch (e) {
        if (!live) return;
        if (!(e instanceof SignedOut)) {
          // No signal: open what this phone already has.
          const me = cachedMe();
          if (me && me.id === owner) setPhase({ kind: "main", me });
          else setPhase({ kind: "welcome", notice: OFFLINE });
          return;
        }
        if (!code) {
          setPhase({ kind: "welcome", notice: wasSpent() ? SPENT : undefined });
          // Opened from an invite: say whose group waits, once signed in (ui/JoinSheet asks then).
          // Inside Zalo's own browser the way in is out first, to Safari or Chrome (ui/EscapeInApp).
          const invite = pendingInvite();
          if (invite) {
            const how = inAppBrowser() ? `Mở bằng ${/Android/i.test(navigator.userAgent) ? "Chrome" : "Safari"} để vào nhóm.` : "Bấm Dùng ngay hoặc đăng nhập để vào nhóm.";
            api.groups.invite(invite).then(
              (p) => live && setPhase({ kind: "welcome", tone: "invite", notice: `${p.inviter || "Có người"} mời bạn vào nhóm "${p.name}". ${how}` }),
              () => {},
            );
          }
          return;
        }
        // The installed app's first launch: trade the code it was installed with for its own session.
        // A browser takes one only fresh (worker/pair.ts): an install link someone posted is refused.
        setPhase({ kind: "loading", text: "Đang mở app…" });
        try {
          await api.pairRedeem(code, isStandalone());
          if (!isStandalone()) {
            // A browser, not the installed app: sent here from Zalo's own browser with that account
            // (EscapeInApp). The code is spent now, and the app this page puts on the home screen will
            // need one of its own, so this address moves to a fresh one; the install steps open there.
            try {
              const mine = (await api.pairInstall()).code;
              if (keepOwnCode(mine)) return location.replace(`/cai/${mine}/`);
            } catch {
              // No code (no signal): the app at the plain address, installable from Cài đặt later.
            }
            history.replaceState(null, "", "/");
          }
          await enter(await api.me());
        } catch (err) {
          if (!answered(err)) return setPhase({ kind: "welcome", notice: OFFLINE });
          if (!isStandalone()) return leaveSpent();
          setPhase({ kind: "welcome", notice: SPENT });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [enter]);

  // Opened from the home screen: the address has done its job.
  useEffect(() => {
    if (phase.kind === "main" && installCode() && isStandalone()) history.replaceState(null, "", `/${location.search}`);
  }, [phase.kind]);

  const signedOut = useCallback(() => setPhase({ kind: "welcome", notice: "Phiên đăng nhập đã hết. Đăng nhập lại để tiếp tục." }), []);
  const leave = useCallback(async () => {
    await store.clear();
    cacheMe(null);
    setPhase({ kind: "welcome" });
  }, []);

  return (
    <>
      {phase.kind === "loading" && (
        <div className="center" role="status">
          <div className="spinner" aria-hidden="true" />
          <span>{phase.text ?? "Đang mở…"}</span>
        </div>
      )}
      {phase.kind === "welcome" && <Welcome notice={phase.notice} tone={phase.tone} onPaired={enter} />}
      {phase.kind === "main" && <Main me={phase.me} onSignedOut={signedOut} onLeave={leave} onMe={(me) => setPhase({ kind: "main", me })} onEnter={enter} />}
      <Toasts />
    </>
  );
}
