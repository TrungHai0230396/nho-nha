import { ArrowRight, Copy, Download, LogIn, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { pendingInviteLink } from "../lib/groups";
import { inAppBrowser, installWay, isIOS, isIPad, isStandalone, promptInstall, useInstallState } from "../lib/pwa";
import { lunarLabel, ruleLabel, whenLabel } from "../shared/describe";
import { parse } from "../shared/parse";
import type { Me } from "../shared/protocol";
import { deviceOffset } from "../shared/wall";
import { toast, useGoogleOn } from "../app/state";
import { Marked } from "./Chips";
import { EscapeInApp } from "./EscapeInApp";
import { InstallSheet } from "./InstallSheet";
import { PairForm } from "./PairForm";

const EXAMPLES = ["mai 8h gọi mẹ", "thứ 6 tuần sau nộp báo cáo!", "rằm thắp hương", "mỗi thứ 2,4,7 học tiếng Anh, thứ 2 từ 20h đến 20h30, thứ 4,7 từ 20h30 đến 22h"];

/**
 * Signed out: what the app does, and two ways in. "Dùng ngay" starts at
 * once on this device with no account; Google keeps every device in step.
 * A guest can sign in later and keep everything. On iPhone the app is
 * offered for the home screen first: only there can it be notified, and
 * starting there spares carrying an account over from Safari later.
 */
export function Welcome({ notice, tone, onPaired }: { notice?: string; tone?: "invite"; onPaired(me: Me): void }) {
  const offset = deviceOffset();
  const now = useMemo(() => Date.now(), []);
  const installedIPhone = isIOS() && isStandalone();
  const inApp = inAppBrowser();
  const installBy = installWay(useInstallState(), navigator.userAgent, isIPad(), inApp !== null);
  // Opened from a group's invite (lib/groups), not used yet.
  const [invite] = useState(pendingInviteLink);
  const [install, setInstall] = useState(false);
  const google = useGoogleOn();
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onPaired(await api.guest());
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError && e.status === 429 ? "Đang có quá nhiều người bắt đầu cùng lúc. Thử lại sau ít phút." : "Cần có mạng để bắt đầu lần đầu.");
    }
  };

  const ways = (
    <>
      {/* Inside Zalo's browser, with an invite, the only way that works is out: signed in here, the
          account would stay in Zalo's browser, which no reminder ever reaches, and Google refuses
          to sign anyone in from inside another app's browser at all. */}
      {!(inApp && invite) && (
      <div className="stack">
        <button className="btn primary wide choice" onClick={() => void start()} disabled={busy} data-autofocus>
          <span className="row" style={{ gap: 8 }}>
            Dùng ngay
            <ArrowRight size={20} aria-hidden="true" />
          </span>
          <small>Không cần đăng nhập · ghi chú gắn với máy này</small>
        </button>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {google && !inApp && (
          <a className="btn wide choice" href="/dang-nhap">
            <span className="row" style={{ gap: 8 }}>
              <LogIn size={20} aria-hidden="true" />
              Đăng nhập Google
            </span>
            <small>Đồng bộ mọi máy, đổi máy không mất ghi chú</small>
          </a>
        )}
        {google && installedIPhone && (
          <p className="small">
            Trên app đã cài ở màn hình chính, trang Google có thể mở ra Safari. Cách chắc chắn: đăng nhập trong Safari, vào Cài đặt → Lấy mã ghép máy khác, rồi nhập mã ở đây.
          </p>
        )}
        {showCode || installedIPhone ? (
          <PairForm onPaired={onPaired} />
        ) : (
          <button className="btn ghost wide" onClick={() => setShowCode(true)}>
            Có mã ghép từ máy khác?
          </button>
        )}
      </div>
      )}
    </>
  );

  return (
    <main className="welcome">
      <img className="logo" src="/icons/icon-192.png" alt="" width={72} height={72} />
      <div>
        <h1>Nhớ Nha</h1>
        <p className="lead">Gõ như nhắn tin cho chính mình. App tự hiểu giờ, cả ngày âm lịch, và nhắc đúng lúc.</p>
      </div>
      {/* What to do comes before what the app is: someone who opened an invite in Zalo had to
          scroll past the examples to find it. */}
      {notice && <p className={tone ? `notice ${tone}` : "notice"}>{notice}</p>}
      {inApp && <EscapeInApp app={inApp} auto signedIn={false} />}
      {/* An iPhone opens a link in Safari, never in the app on the home screen, and the two are
          apart: joining here makes another account the app never hears of. So whoever has the app
          is asked first, before "Dùng ngay" (Hải, 14/10/2026). */}
      {invite && !inApp && (
        <div className="have-app">
          <p className="small">
            <strong>Đã cài app Nhớ Nha?</strong> Chép link mời, mở app → Cài đặt → Nhắc chung → Dán link mời. Chưa có app thì vào nhóm ngay dưới đây.
          </p>
          <button className="btn teal" onClick={() => void copyText(invite).then((ok) => toast(ok ? "Đã chép link mời. Mở app → Cài đặt → Nhắc chung → Dán link mời." : "Chưa chép được link mời."))}>
            <Copy size={18} aria-hidden="true" />
            Chép link mời
          </button>
        </div>
      )}
      {/* Opened from an invite, the ways into the group come before what the app is. */}
      {invite && ways}
      <div className="demo" aria-label="Ví dụ">
        {EXAMPLES.map((t) => {
          const p = parse(t, now, offset);
          return (
            <div className="line" key={t}>
              <span>
                <Marked text={t} spans={p.spans} />
              </span>
              {p.due !== null && <span className="chip">{p.rule?.kind === "weekly" ? ruleLabel(p.rule) : /rằm/.test(t) ? lunarLabel(p.due, offset) : whenLabel(p.due, now, offset)}</span>}
            </div>
          );
        })}
      </div>
      {installBy && (
          <div className="banner">
            {isIOS() ? <Smartphone className="ico" size={24} aria-hidden="true" /> : <Download className="ico" size={24} aria-hidden="true" />}
            <div className="text">
              <strong>{isIOS() ? "Cài app vào màn hình chính" : "Cài app vào máy"}</strong>
              {isIOS() ? "iPhone chỉ nhắc giờ được cho app đã cài." : "Mở nhanh như một app, có biểu tượng riêng."}
              <div className="actions">
                <button className="btn teal" onClick={() => (installBy === "prompt" ? void promptInstall() : setInstall(true))}>
                  Cài app
                </button>
              </div>
            </div>
          </div>
      )}
      {!invite && ways}
      <p className="foot">
        <a href="/rieng-tu">Quyền riêng tư</a>
      </p>
      {install && <InstallSheet signedIn={false} onClose={() => setInstall(false)} />}
    </main>
  );
}
