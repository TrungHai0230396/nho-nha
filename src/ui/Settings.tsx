import { BellRing, Copy, Download, KeyRound, LogIn, LogOut, Palette, Smartphone, Trash2, UserRound, Users, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { upgradeToGoogle } from "../app/account";
import { store, syncSoon, toast } from "../app/state";
import { forgetPush, savedEndpoint, type Push } from "../app/usePush";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { newId } from "../lib/ids";
import { useLook } from "../lib/look";
import { newNote } from "../lib/notes";
import { blockedHow, inAppBrowser, installWay, isIOS, isIPad, isStandalone, promptInstall, useInstallState } from "../lib/pwa";
import type { GroupInfo, Me, TokenInfo } from "../shared/protocol";
import { deviceOffset } from "../shared/wall";
import { GroupList, GroupPage } from "./GroupSettings";
import { LookSettings } from "./LookSettings";
import { MenuRow, Switch } from "./Menu";
import { PairForm } from "./PairForm";
import { Sheet } from "./Sheet";

const HOURS = [5, 6, 7, 8, 9, 10];
/** Hours of sleep to pick from: from–to. */
const NIGHTS: [number, number][] = [
  [21, 6],
  [22, 6],
  [22, 7],
  [23, 6],
  [23, 7],
  [0, 6],
  [0, 7],
];

/** Notifications as they stand on this phone, in a word for the menu, and a line for their page. */
const PUSH_VALUE: Record<Push["state"], string> = {
  on: "Đang bật",
  off: "Đang tắt",
  blocked: "Bị chặn",
  install: "Cần cài app",
  unsupported: "Không có",
};
const PUSH_LINE: Record<Push["state"], string> = {
  on: "Đang bật trên máy này",
  off: "Đang tắt trên máy này",
  blocked: "Máy đang chặn thông báo của app.",
  install: "Trên iPhone, cài app vào màn hình chính rồi bật ở đó.",
  unsupported: "Trình duyệt này chưa nhận được thông báo (iPhone cần iOS 16.4 trở lên).",
};
const SCHEME_WORD = { auto: "Theo máy", light: "Sáng", dark: "Tối" } as const;

export type SettingsPage = "main" | "notify" | "groups" | "look" | "devices" | "account" | `group:${string}`;
type Page = SettingsPage;

async function copy(text: string) {
  toast((await copyText(text)) ? "Đã chép" : "Chưa chép được: bấm giữ để chọn rồi chép tay.");
}

/**
 * Settings as iPhone's own: one short list, each row saying how it stands
 * and opening a page of its own. It had been every switch, explanation and
 * button on one sheet three screens long, the group's eight buttons and the
 * Siri instructions among them (Hải, 14/10/2026: "quá rối").
 */
export function Settings({
  start = "main",
  me,
  push,
  onClose,
  onInstall,
  onLeave,
  onMe,
  onEnter,
  google,
  groups,
  onInvite,
}: {
  /** The page it opens at: "notify" from the "Thông báo đang bị chặn" nudge. */
  start?: SettingsPage;
  me: Me;
  push: Push;
  onClose(): void;
  onInstall(): void;
  onLeave(): void;
  onMe(me: Me): void;
  /** Paired into another account (a guest typing a code): this phone now belongs to it. */
  onEnter(me: Me): void;
  /** Google sign-in is on at the server. */
  google: boolean;
  groups: readonly GroupInfo[];
  /** An invite pasted in: asked about in the join sheet. */
  onInvite(code: string): void;
}) {
  const [page, setPage] = useState<Page>(start);
  const from = useRef<Page>("main");
  const { look } = useLook();

  // A new page starts at its top, with focus on its way back; back on the list, on the row it came from.
  useEffect(() => {
    const sheet = document.querySelector<HTMLElement>(".sheet");
    sheet?.scrollTo({ top: 0 });
    const returning = page === "main" || (page === "groups" && from.current.startsWith("group:"));
    const target = returning ? sheet?.querySelector<HTMLElement>(`[data-page="${from.current}"]`) : sheet?.querySelector<HTMLElement>(".back-btn");
    target?.focus({ preventScroll: true });
  }, [page]);
  const go = (next: Page) => {
    from.current = page;
    setPage(next);
  };

  const group = page.startsWith("group:") ? groups.find((g) => g.id === page.slice(6)) : undefined;
  const back = page === "main" ? undefined : group || page.startsWith("group:") ? () => go("groups") : () => go("main");
  const title =
    page === "notify"
      ? "Thông báo"
      : page === "groups"
        ? "Nhắc chung"
        : page === "look"
          ? "Giao diện"
          : page === "devices"
            ? "Máy khác & phím tắt"
            : page === "account"
              ? "Tài khoản"
              : group
                ? group.name
                : "Cài đặt";

  return (
    <Sheet title={title} onClose={onClose} onBack={back}>
      {page === "main" && (
        <>
          <div className="menu">
            <MenuRow
              icon={<BellRing size={18} />}
              label="Thông báo"
              value={PUSH_VALUE[push.state]}
              tone={push.state === "on" ? undefined : "warn"}
              page="notify"
              onClick={() => go("notify")}
            />
            <MenuRow icon={<Users size={18} />} label="Nhắc chung" value={groups.length ? `${groups.length} nhóm` : "Chưa có nhóm"} page="groups" onClick={() => go("groups")} />
            <MenuRow icon={<Palette size={18} />} label="Giao diện" value={SCHEME_WORD[look.scheme]} page="look" onClick={() => go("look")} />
            <MenuRow icon={<Smartphone size={18} />} label="Máy khác & phím tắt" page="devices" onClick={() => go("devices")} />
            <MenuRow icon={<UserRound size={18} />} label="Tài khoản" value={me.guest ? "Chưa đăng nhập" : me.name || me.email} page="account" onClick={() => go("account")} />
          </div>
          <p className="foot" style={{ marginTop: 24 }}>
            <a href="/rieng-tu">Quyền riêng tư</a> · Bản {__BUILD__}
          </p>
        </>
      )}
      {page === "notify" && <NotifyPage me={me} push={push} onMe={onMe} onInstall={onInstall} />}
      {page === "groups" && <GroupList groups={groups} myName={me.name} onOpen={(id) => go(`group:${id}`)} onInvite={onInvite} />}
      {group && <GroupPage g={group} onGone={() => go("groups")} />}
      {page.startsWith("group:") && !group && <p className="small page-intro">Bạn không còn ở trong nhóm này.</p>}
      {page === "look" && <LookSettings />}
      {page === "devices" && <DevicesPage me={me} onInstall={onInstall} onAccount={() => go("account")} />}
      {page === "account" && <AccountPage me={me} google={google} onLeave={onLeave} onEnter={onEnter} />}
    </Sheet>
  );
}

/** Thông báo: on or off on this phone, a test, the morning list, hours of sleep. One line each. */
function NotifyPage({ me, push, onMe, onInstall }: { me: Me; push: Push; onMe(me: Me): void; onInstall(): void }) {
  // Before this setting existed, a phone kept `me` without it: 22–6, as the server has it for everyone.
  const quiet = me.quiet === undefined ? { from: 22, to: 6 } : me.quiet;
  const nights = quiet && !NIGHTS.some(([f, t]) => f === quiet.from && t === quiet.to) ? [...NIGHTS, [quiet.from, quiet.to] as [number, number]] : NIGHTS;

  const digest = async (value: string) => {
    const h = value === "off" ? null : Number(value);
    try {
      await api.settings({ digestHour: h });
      onMe({ ...me, digestHour: h });
      toast(h === null ? "Đã tắt bản tin buổi sáng" : `Mỗi sáng ${h}:00 sẽ báo việc trong ngày`);
    } catch {
      toast("Cần có mạng để đổi.");
    }
  };
  const sleep = async (value: string) => {
    const [f, t] = value.split("-").map(Number);
    const q = value === "off" ? null : { from: f!, to: t! };
    try {
      await api.settings({ quiet: q });
      onMe({ ...me, quiet: q });
      toast(q ? `Từ ${q.from}:00 đến ${q.to}:00, tin báo người khác sẽ đợi tới sáng` : "Tin báo người khác sẽ đến ngay, cả ban đêm");
    } catch {
      toast("Cần có mạng để đổi.");
    }
  };
  const testPush = async () => {
    const at = Date.now();
    // A real note through the real path (sync, cron, push): what works here works for every reminder.
    await store.put(newNote(newId(), "1 phút nữa thử thông báo của Nhớ Nha", at, deviceOffset()));
    syncSoon();
    toast("Khoảng 1–2 phút nữa sẽ có thông báo thử. Khoá màn hình lại để xem.");
  };

  return (
    <>
      <div className="menu">
        <div className="menu-item">
          <span className="menu-text">
            Nhắc đúng giờ
            <small className={push.state === "on" || push.state === "off" ? undefined : "warn"}>
              {push.problem ?? PUSH_LINE[push.state]}
              {push.state === "blocked" ? ` ${blockedHow()}` : ""}
            </small>
          </span>
          {(push.state === "on" || push.state === "off") && <Switch on={push.state === "on"} label="Nhắc đúng giờ" busy={push.busy} onChange={(on) => (on ? push.turnOn() : push.turnOff())} />}
          {push.state === "install" && (
            <button className="btn teal" onClick={onInstall}>
              Cài app
            </button>
          )}
        </div>
        {push.state === "on" && (
          <button type="button" className="menu-row" onClick={() => void testPush()}>
            <span className="menu-icon" aria-hidden="true">
              <Zap size={18} />
            </span>
            <span className="menu-label">Thử: nhắc sau 1 phút</span>
          </button>
        )}
      </div>
      <div className="menu">
        <label className="menu-item">
          <span className="menu-text">
            Bản tin buổi sáng
            <small>Việc trong ngày, gửi mỗi sáng</small>
          </span>
          <select value={me.digestHour === null ? "off" : String(me.digestHour)} onChange={(e) => void digest(e.target.value)}>
            <option value="off">Tắt</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </label>
        <label className="menu-item">
          <span className="menu-text">
            Giờ ngủ
            <small>Tin báo người khác đợi tới sáng</small>
          </span>
          <select value={quiet ? `${quiet.from}-${quiet.to}` : "off"} onChange={(e) => void sleep(e.target.value)}>
            <option value="off">Không có</option>
            {nights.map(([f, t]) => (
              <option key={`${f}-${t}`} value={`${f}-${t}`}>
                {f}:00–{t}:00
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

/** Máy khác & phím tắt: the app on the home screen, another phone, an iPhone shortcut. */
function DevicesPage({ me, onInstall, onAccount }: { me: Me; onInstall(): void; onAccount(): void }) {
  const [pairCode, setPairCode] = useState<{ code: string; expires: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  useEffect(() => {
    api.tokens().then((r) => setTokens(r.tokens), () => setTokens([]));
  }, []);
  // The pairing code's minutes, counting down.
  useEffect(() => {
    if (!pairCode) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((pairCode.expires - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pairCode]);
  const mins = Math.floor(left / 60);
  const secs = String(left % 60).padStart(2, "0");
  const installBy = installWay(useInstallState(), navigator.userAgent, isIPad(), inAppBrowser() !== null);

  return (
    <>
      {installBy && (
        <button className="btn teal wide page-first" onClick={() => (installBy === "prompt" ? void promptInstall() : onInstall())}>
          {isIOS() ? <Smartphone size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
          {isIOS() ? "Cài vào màn hình chính" : "Cài app vào máy này"}
        </button>
      )}

      <h3>Dùng trên máy khác</h3>
      {me.guest ? (
        <div className="menu">
          <MenuRow label="Đăng nhập Google trước" sub="Rồi đăng nhập cùng tài khoản trên máy kia" onClick={onAccount} />
        </div>
      ) : pairCode && left > 0 ? (
        <div className="stack" style={{ marginTop: 0 }}>
          <p className="small" style={{ margin: 0 }}>
            Trên máy kia: mở Nhớ Nha → “Có mã ghép từ máy khác?” → nhập mã này. Còn {mins}:{secs}.
          </p>
          <div className="code" aria-label={`Mã ghép ${pairCode.code.split("").join(" ")}`}>
            {pairCode.code.slice(0, 4)} {pairCode.code.slice(4)}
          </div>
        </div>
      ) : (
        <button className="btn ghost wide" onClick={() => api.pairCode().then(setPairCode, () => toast("Cần có mạng để lấy mã ghép."))}>
          <KeyRound size={18} aria-hidden="true" />
          Lấy mã ghép máy khác
        </button>
      )}

      <h3>Phím tắt iPhone</h3>
      <p className="small" style={{ margin: "0 0 8px" }}>
        Ghi bằng Siri hay gõ lưng máy, không cần mở app.
      </p>
      {fresh ? (
        <div className="stack" style={{ marginTop: 0 }}>
          <p className="small" style={{ margin: 0 }}>
            Mã chỉ hiện một lần này. Trong app Phím tắt: tạo phím tắt mới → thêm <strong>Đọc chính tả văn bản</strong> → thêm <strong>Nhận nội dung của URL</strong> với địa chỉ dưới, phương thức POST, tiêu đề <strong>Authorization</strong> là <strong>Bearer</strong> + dấu cách + mã, nội dung JSON có trường <strong>text</strong> là văn bản vừa đọc → thêm <strong>Hiện thông báo</strong>.
          </p>
          <div className="token">{`${location.origin}/api/capture`}</div>
          <button className="btn ghost" onClick={() => void copy(`${location.origin}/api/capture`)}>
            <Copy size={18} aria-hidden="true" />
            Chép địa chỉ
          </button>
          <div className="token">{fresh}</div>
          <button className="btn ghost" onClick={() => void copy(`Bearer ${fresh}`)}>
            <Copy size={18} aria-hidden="true" />
            Chép “Bearer + mã”
          </button>
        </div>
      ) : (
        <button
          className="btn ghost wide"
          onClick={() =>
            api.newToken("Phím tắt").then(
              (r) => (setFresh(r.token), setTokens(r.tokens)),
              () => toast("Chưa tạo được mã (cần mạng; tối đa 5 mã)."),
            )
          }
        >
          <KeyRound size={18} aria-hidden="true" />
          Tạo mã cho phím tắt
        </button>
      )}
      {tokens && tokens.length > 0 && (
        <div className="menu">
          {tokens.map((t) => (
            <div key={t.id} className="menu-item">
              <span className="menu-text">
                {t.label}
                <small>{t.lastUsed ? `Dùng lần cuối ${new Date(t.lastUsed).toLocaleDateString("vi-VN")}` : "Chưa dùng"}</small>
              </span>
              <button className="btn ghost" onClick={() => api.revokeToken(t.id).then((r) => (setTokens(r.tokens), toast("Đã thu hồi mã")), () => toast("Cần có mạng."))}>
                Thu hồi
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Tài khoản: who is signed in (or that nobody is), and deleting, apart at the bottom. */
function AccountPage({ me, google, onLeave, onEnter }: { me: Me; google: boolean; onLeave(): void; onEnter(me: Me): void }) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const signOut = async () => {
    try {
      await api.logout(savedEndpoint());
    } catch {
      // Gone from this phone all the same; the server session dies of age.
    }
    forgetPush();
    onLeave();
  };
  const deleteAll = async () => {
    setDeleting(true);
    try {
      await api.deleteAccount();
      forgetPush();
      onLeave();
      toast("Đã xoá tài khoản và mọi ghi chú.");
    } catch {
      setDeleting(false);
      toast("Cần có mạng để xoá tài khoản.");
    }
  };

  return (
    <>
      {me.guest ? (
        <>
          <div className="menu">
            <div className="menu-item">
              <span className="menu-text">
                Chưa đăng nhập
                <small>Ghi chú gắn với máy này: đổi máy hay xoá trình duyệt là mất.</small>
              </span>
            </div>
          </div>
          {google ? (
            <div className="stack">
              <button className="btn primary wide" onClick={() => void upgradeToGoogle()}>
                <LogIn size={18} aria-hidden="true" />
                Đăng nhập Google để giữ ghi chú
              </button>
              <p className="small" style={{ margin: 0 }}>
                Ghi chú đang có gộp vào tài khoản, rồi có trên mọi máy.
                {isIOS() && isStandalone() ? " Nếu trang Google mở ra Safari: đăng nhập ở đó, lấy mã ghép trong Cài đặt, rồi nhập vào đây." : ""}
              </p>
              {isIOS() && isStandalone() && <PairForm onPaired={onEnter} guestNotes />}
            </div>
          ) : (
            <p className="small page-intro">Đăng nhập Google để đồng bộ nhiều máy sẽ có sớm.</p>
          )}
        </>
      ) : (
        <div className="menu">
          <div className="menu-item">
            <span className="menu-text">
              {me.name || "Bạn"}
              <small>{me.email}</small>
            </span>
            <button className="btn" onClick={() => void signOut()}>
              <LogOut size={18} aria-hidden="true" />
              Đăng xuất
            </button>
          </div>
        </div>
      )}

      <div className="danger-zone">
        <details>
          <summary className="btn ghost">
            <Trash2 size={18} aria-hidden="true" />
            {me.guest ? "Xoá dữ liệu trên máy này" : "Xoá tài khoản"}
          </summary>
          <div className="stack">
            <label htmlFor="confirm" className="small">
              {me.guest ? "Xoá hết ghi chú và phím tắt của máy này, cả bản trên máy chủ." : "Xoá hết ghi chú, máy đã đăng nhập và phím tắt."} Không lấy lại được. Gõ <strong>XOA</strong> để xác nhận.
            </label>
            <input id="confirm" type="text" autoCapitalize="characters" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="btn danger wide" disabled={confirm.trim().toUpperCase() !== "XOA" || deleting} onClick={() => void deleteAll()}>
              <Trash2 size={18} aria-hidden="true" />
              Xoá vĩnh viễn
            </button>
          </div>
        </details>
      </div>
    </>
  );
}
