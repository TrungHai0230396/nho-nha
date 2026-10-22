import { Download, PlusSquare, Share } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "../app/state";
import { api } from "../lib/api";
import { canPromptInstall, INSTALL_CODE, isIOS, isIPad, keepOwnCode, macSafari, onComputer, promptInstall, shareWay } from "../lib/pwa";
import { Sheet } from "./Sheet";

const onInstallPage = () => {
  const m = /^\/cai\/([^/]+)\/?$/.exec(location.pathname);
  return !!m && INSTALL_CODE.test(m[1]!);
};

// A label and its icon stay on one line: an icon wrapped alone reads as a step of its own.
const SHARE = (
  <span className="nowrap">
    <strong>Chia sẻ</strong> <Share size={18} className="inline-ico" aria-hidden="true" />
  </span>
);

/** Safari's or Chrome's own menu, as this browser lays it out (see shareWay). */
function ShareSteps({ last }: { last: ReactNode }) {
  const way = shareWay(navigator.userAgent, isIPad());
  return (
    <ol className="steps">
      <li>
        {way.button === "more" && (
          <>
            Bấm nút <strong>⋯</strong> ở thanh dưới, chọn {SHARE}.
          </>
        )}
        {way.button === "bar" && (
          <>
            Bấm nút {SHARE} ở thanh dưới.
          </>
        )}
        {way.button === "top" && (
          <>
            Bấm nút {SHARE} ở góc trên bên phải.
          </>
        )}
        {way.button === "menu" && (
          <>
            Mở menu của trình duyệt, chọn {SHARE}.
          </>
        )}
      </li>
      <li>
        {way.sheet === "scroll" ? (
          "Kéo xuống, chọn "
        ) : (
          <>
            Bấm <strong>Xem thêm</strong>
            {way.sheet === "either" ? " (hoặc kéo xuống)" : ""}, chọn{" "}
          </>
        )}
        <span className="nowrap">
          <strong>Thêm vào MH chính</strong> <PlusSquare size={18} className="inline-ico" aria-hidden="true" />
        </span>
        .
      </li>
      <li>
        Bấm <strong>Thêm</strong>.
      </li>
      <li>{last}</li>
    </ol>
  );
}

/**
 * Putting the app on the home screen, where on iPhone it can be notified.
 * On iPhone that is the browser's own menu. Signed in, this page first
 * moves to an address holding a pairing code, so the installed app (which
 * cannot see Safari's cookies) starts already signed in; signed out there
 * is nothing to carry, and the installed app starts at the welcome page.
 */
export function InstallSheet({ signedIn, onClose }: { signedIn: boolean; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const ready = !signedIn || onInstallPage();

  const prepare = async () => {
    setBusy(true);
    try {
      const { code } = await api.pairInstall();
      keepOwnCode(code);
      location.assign(`/cai/${code}/`);
    } catch {
      setBusy(false);
      toast("Cần có mạng để chuẩn bị cài app.");
    }
  };

  if (!isIOS()) {
    const ua = navigator.userAgent;
    return (
      <Sheet title="Cài app vào máy" onClose={onClose}>
        <p>Cài vào máy để mở nhanh như một app, và nhận thông báo nhắc giờ.</p>
        {canPromptInstall() ? (
          <button className="btn primary wide" onClick={() => void promptInstall().then((ok) => ok && onClose())}>
            <Download size={20} aria-hidden="true" />
            Cài app
          </button>
        ) : macSafari(ua, false) ? (
          // A Mac's Safari never offers by itself: its menu bar does (Safari 17, macOS Sonoma on).
          <ol className="steps">
            <li>
              Trên thanh menu của Safari, bấm <strong>Tệp</strong> (File).
            </li>
            <li>
              Chọn <strong>Thêm vào Dock</strong> (Add to Dock), rồi bấm <strong>Thêm</strong>.
            </li>
            <li>Mở Nhớ Nha từ Dock.</li>
          </ol>
        ) : onComputer(ua, false) ? (
          <ol className="steps">
            <li>Bấm biểu tượng cài ở cuối thanh địa chỉ, hoặc mở menu ⋮ của trình duyệt.</li>
            <li>
              Chọn <strong>Cài đặt Nhớ Nha</strong>.
            </li>
          </ol>
        ) : (
          <ol className="steps">
            <li>Mở menu của trình duyệt (dấu ⋮ hoặc ⋯).</li>
            <li>Chọn “Cài đặt ứng dụng” hoặc “Thêm vào màn hình chính”.</li>
          </ol>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title="Cài vào màn hình chính" onClose={onClose}>
      <p className="small">Trên iPhone, chỉ app đã cài ở màn hình chính mới nhận được thông báo nhắc giờ (iOS 16.4 trở lên).</p>
      {!ready ? (
        <div className="stack">
          <button className="btn primary wide" onClick={() => void prepare()} disabled={busy} data-autofocus>
            {busy ? "Đang chuẩn bị…" : "Bắt đầu"}
          </button>
          <p className="small">Trang sẽ tải lại một lần để app cài ra tự đăng nhập sẵn.</p>
        </div>
      ) : (
        <ShareSteps
          last={
            signedIn ? (
              "Mở Nhớ Nha từ màn hình chính, rồi bật thông báo."
            ) : (
              <>
                Mở Nhớ Nha từ màn hình chính, bấm <strong>Dùng ngay</strong> ở đó.
              </>
            )
          }
        />
      )}
    </Sheet>
  );
}
