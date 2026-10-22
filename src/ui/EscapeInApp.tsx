import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "../app/state";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { pendingInviteLink } from "../lib/groups";
import { escapeUrl } from "../lib/pwa";

const TRIED = "nhonha:escape-tried";
const CODE = "nhonha:escape-code";

/**
 * Signed in inside Zalo: an install address carrying this account, so the
 * page Safari opens is already signed in, notes and all, instead of
 * starting over. Fetched ahead (a tap must open the link at once, or the
 * app around the page may not let it out), and once per visit: a code is
 * good for 30 days and each one asked for is kept until then. Only the
 * button opens it, on this same phone; "Chép link" copies the bare address,
 * since a copied link gets pasted into chats, and whoever opened this one
 * first would be in this account.
 */
function usePairedHref(on: boolean): string {
  const [href, setHref] = useState(() => {
    try {
      const code = on ? sessionStorage.getItem(CODE) : null;
      if (code) return `${location.origin}/cai/${code}/`;
    } catch {
      // Asked for again below.
    }
    return location.href;
  });
  useEffect(() => {
    if (!on || href !== location.href) return;
    let live = true;
    api
      .pairInstall()
      .then(({ code }) => {
        try {
          sessionStorage.setItem(CODE, code);
        } catch {
          // Asked for again next visit.
        }
        if (live) setHref(`${location.origin}/cai/${code}/`);
      })
      .catch(() => {
        // Offline or refused: the plain address still opens the app, signed out.
      });
    return () => {
      live = false;
    };
  }, [on, href]);
  return href;
}

/**
 * Inside Zalo's, Facebook's or another app's own browser nothing installs and no reminder
 * arrives, so the way out comes first: tried by itself once on arrival
 * (iPhone only: there a refused try changes nothing, while an Android
 * webview that cannot take an intent shows an error page instead of this
 * one), then as a button, then the link to paste, then the app's own menu.
 */
export function EscapeInApp({ app, auto, signedIn }: { app: string; auto: boolean; signedIn: boolean }) {
  const ua = navigator.userAgent;
  const android = /Android/i.test(ua);
  const browser = android ? "Chrome" : "Safari";
  const href = usePairedHref(signedIn);
  // Opened from an invite: the invite is what must reach the browser, not the bare address.
  const invite = signedIn ? null : pendingInviteLink();
  const out = escapeUrl(invite ?? href, ua);

  useEffect(() => {
    if (!auto || !out || android) return;
    try {
      // Once per visit: back in Zalo after Safari opened, the page stays put.
      if (sessionStorage.getItem(TRIED)) return;
      sessionStorage.setItem(TRIED, "1");
    } catch {
      // No storage: tried on each load, which a refused try survives anyway.
    }
    const t = setTimeout(() => location.assign(out), 400);
    return () => clearTimeout(t);
  }, [auto, out, android]);

  const copy = async () => {
    toast((await copyText(invite ?? `${location.origin}/`)) ? `Đã chép link. Mở ${browser}, dán vào ô địa chỉ.` : "Chưa chép được. Bấm ⋯ ở góc trên để mở bằng trình duyệt.");
  };

  return (
    <div className="banner escape" role="note">
      <ExternalLink className="ico" size={24} aria-hidden="true" />
      <div className="text">
        <strong>{invite ? `Mở bằng ${browser} để vào nhóm` : `Mở bằng ${browser} để dùng được`}</strong>
        {invite
          ? // Someone with the app already need not go round by the browser at all: the link goes into the app.
            "Đã cài app Nhớ Nha thì bấm Chép link mời, rồi mở app → Cài đặt → Nhắc chung → Dán link mời."
          : `Trình duyệt trong ${app} không cài được app, cũng không nhận được thông báo nhắc giờ.`}
        {signedIn && out && ` Bấm "Mở bằng ${browser}" thì ghi chú vừa tạo đi theo luôn.`}
        <div className="actions">
          {out && (
            <a className="btn teal" href={out}>
              Mở bằng {browser}
            </a>
          )}
          <button className="btn" onClick={() => void copy()}>
            <Copy size={18} aria-hidden="true" />
            {invite ? "Chép link mời" : "Chép link"}
          </button>
        </div>
        <span className="small">Không mở được thì bấm ⋯ ở góc trên, chọn mở bằng trình duyệt.</span>
      </div>
    </div>
  );
}
