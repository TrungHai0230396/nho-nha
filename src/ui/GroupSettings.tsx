import { ClipboardPaste, Copy, Crown, LogOut, Plus, RefreshCw, Trash2, UserPlus, Users, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { store, toast } from "../app/state";
import { api, ApiError } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { inviteIn, inviteLink, membersLine, readClipboard, shareInvite } from "../lib/groups";
import { setNickname, useNicknames } from "../lib/nicknames";
import { LIMITS, type GroupInfo } from "../shared/protocol";
import { MenuRow, Switch } from "./Menu";

/** Runs a group call, then lets the next sync bring the groups as they now are. */
async function run(call: () => Promise<unknown>, done: string): Promise<boolean> {
  try {
    await call();
    await store.sync();
    toast(done);
    return true;
  } catch (e) {
    toast(e instanceof ApiError ? "Chưa làm được, thử lại sau." : "Cần có mạng.");
    return false;
  }
}

export async function invite(g: GroupInfo) {
  const how = await shareInvite(g);
  if (how === "copied") toast("Đã chép link mời. Dán vào tin nhắn để gửi.");
  if (how === "failed") toast("Chưa chép được link mời.");
}

/**
 * The bare link onto the clipboard: the share sheet hides it, and it is
 * what gets pasted into a chat, or into "Vào nhóm bằng link" in an
 * installed app that the link itself would not open (Safari would).
 */
export async function copyInvite(g: GroupInfo) {
  toast((await copyText(inviteLink(g))) ? "Đã chép link mời. Dán vào tin nhắn để gửi." : "Chưa chép được link mời.");
}

/** A destructive button that asks once more in its own words before it acts. */
function Twice({ label, again, icon, onGo, className = "btn ghost" }: { label: string; again: string; icon: ReactNode; onGo(): void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={`${className}${armed ? " danger" : ""}`} onClick={() => (armed ? onGo() : setArmed(true))} onBlur={() => setArmed(false)}>
      {icon}
      {armed ? again : label}
    </button>
  );
}

/**
 * Cài đặt → Nhắc chung: the groups this person is in, one row each (a tap
 * opens the group's own page), making one, and an invite pasted by hand
 * (an iPhone's installed app does not open links itself: they open in
 * Safari, which is signed in apart from it).
 */
export function GroupList({ groups, myName, onOpen, onInvite }: { groups: readonly GroupInfo[]; myName: string; onOpen(id: string): void; onInvite(code: string): void }) {
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [me, setMe] = useState(myName);
  const [joining, setJoining] = useState(false);
  const [link, setLink] = useState("");
  // What is wrong with what was pasted, said under the box: a toast came and went unread.
  const [problem, setProblem] = useState<string | null>(null);
  const nicks = useNicknames();

  const make = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !me.trim()) return toast("Gõ tên nhóm và tên của bạn.");
    try {
      const { id } = await api.groups.create(name, me);
      await store.sync();
      setMaking(false);
      setName("");
      const g = store.getSnapshot().groups.find((x) => x.id === id);
      toast(`Đã tạo nhóm ${g?.name ?? name}. Mời mọi người vào nhé.`, g ? { label: "Mời", run: () => void invite(g) } : undefined);
      onOpen(id);
    } catch (err) {
      toast(err instanceof ApiError && err.code === "too many groups" ? `Mỗi người ở tối đa ${LIMITS.groupsPerPerson} nhóm.` : "Cần có mạng để tạo nhóm.");
    }
  };

  // Into the group a link is for, or a word on what is wrong with it, under the box.
  const tryLink = (text: string, empty: string) => {
    const code = inviteIn(text);
    if (!code) return setProblem(text.trim() ? "Đây chưa phải link mời của Nhớ Nha." : empty);
    setLink("");
    setProblem(null);
    onInvite(code);
  };
  // What was just copied, on a tap. The box and the words on what to do show at once, whatever
  // comes back: with nothing copied an iPhone answers nothing at all, and waiting on it, the tap
  // showed nothing (Hải, 14/10/2026: "ko xuất hiện gì người dùng ko hiểu").
  const fromClipboard = async () => {
    setJoining(true);
    setProblem(null);
    const text = await readClipboard();
    if (text === null) return setProblem("Chưa đọc được nội dung vừa chép. Giữ tay vào ô để dán.");
    tryLink(text, "Chưa có gì được chép.");
  };

  return (
    <>
      {groups.length === 0 && <p className="small page-intro">Lời nhắc cho cả nhà, cả nhóm: ai trong nhóm cũng thấy, cũng được nhắc.</p>}
      {groups.length > 0 && (
        <div className="menu">
          {groups.map((g) => (
            <MenuRow key={g.id} icon={<Users size={18} />} label={g.name} sub={g.muted ? "Đã tắt tiếng" : membersLine(g, nicks)} onClick={() => onOpen(g.id)} page={`group:${g.id}`} />
          ))}
        </div>
      )}
      {making ? (
        <form className="stack group-new" onSubmit={(e) => void make(e)}>
          <label className="field">
            <span>Tên nhóm</span>
            <input type="text" value={name} maxLength={LIMITS.groupName} onChange={(e) => setName(e.target.value)} placeholder="Gia đình, Lớp 12A…" autoFocus />
          </label>
          <label className="field">
            <span>Tên của bạn trong nhóm</span>
            <input type="text" value={me} maxLength={LIMITS.memberName} onChange={(e) => setMe(e.target.value)} placeholder="Ví dụ: Bố Bin" />
          </label>
          <div className="row">
            <button className="btn teal grow" type="submit">
              Tạo nhóm
            </button>
            <button className="btn ghost" type="button" onClick={() => setMaking(false)}>
              Thôi
            </button>
          </div>
        </form>
      ) : (
        <div className="menu">
          <button type="button" className="menu-row" onClick={() => setMaking(true)}>
            <span className="menu-icon" aria-hidden="true">
              <Plus size={18} />
            </span>
            <span className="menu-label">Tạo nhóm</span>
          </button>
          {joining ? (
            <form
              className="join-row"
              onSubmit={(e) => {
                e.preventDefault();
                tryLink(link, "Dán link mời vào ô trước đã.");
              }}
            >
              <p className="small">Chép link mời bạn nhận được trong tin nhắn, rồi bấm Dán.</p>
              <div className="row">
                <label className="sr-only" htmlFor="invite-link">
                  Link mời
                </label>
                <input
                  id="invite-link"
                  className="grow"
                  type="text"
                  value={link}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLink(v);
                    // Many letters at once is a paste (a long press, "Dán"): in at once when it is an
                    // invite, said so under the box when it is not. One letter at a time is typing.
                    if (v.length - link.length > 8) tryLink(v, "");
                    else setProblem(null);
                  }}
                  placeholder="Dán link mời vào đây"
                  autoComplete="off"
                  enterKeyHint="go"
                  aria-describedby={problem ? "invite-problem" : undefined}
                />
                <button type="button" className="btn teal" onClick={() => void fromClipboard()}>
                  <ClipboardPaste size={18} aria-hidden="true" />
                  Dán
                </button>
              </div>
              {problem && (
                <p id="invite-problem" className="field-error" role="alert">
                  {problem}
                </p>
              )}
            </form>
          ) : (
            <button type="button" className="menu-row" onClick={() => void fromClipboard()}>
              <span className="menu-icon" aria-hidden="true">
                <ClipboardPaste size={18} />
              </span>
              <span className="menu-label">
                Dán link mời
                <small>Chép link mời bạn nhận được, rồi bấm vào đây</small>
              </span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * One group's page: inviting first (the thing done most), its people, this
 * person's choices, and leaving or deleting apart at the bottom, in red.
 * Eight equal buttons in a grid were what made it look a mess (Hải,
 * 14/10/2026: "quá rối").
 */
export function GroupPage({ g, onGone }: { g: GroupInfo; onGone(): void }) {
  const me = g.members.find((m) => m.me);
  const [renaming, setRenaming] = useState<null | "group" | "me">(null);
  const [text, setText] = useState("");
  const nicks = useNicknames();
  // The member whose nickname is being typed (lib/nicknames): kept on this phone only.
  const [naming, setNaming] = useState<string | null>(null);
  const [nick, setNick] = useState("");
  const saveNick = (e: FormEvent, key: string) => {
    e.preventDefault();
    setNickname(key, nick);
    setNaming(null);
    toast(nick.trim() ? "Đã đặt biệt danh. Chỉ máy này thấy." : "Đã bỏ biệt danh");
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    const call = renaming === "group" ? () => api.groups.rename(g.id, text) : () => api.groups.me(g.id, text);
    void run(call, "Đã đổi tên").then((ok) => ok && setRenaming(null));
  };

  return (
    <>
      <div className="row group-top">
        <button type="button" className="btn teal grow" onClick={() => void invite(g)}>
          <UserPlus size={18} aria-hidden="true" />
          Mời người
        </button>
        <button type="button" className="btn ghost" onClick={() => void copyInvite(g)}>
          <Copy size={18} aria-hidden="true" />
          Chép link
        </button>
      </div>

      <h3>Thành viên · {g.members.length}</h3>
      <ul className="members">
        {g.members.map((m) =>
          naming === m.key ? (
            <li key={m.key}>
              <form className="row nick-form" onSubmit={(e) => saveNick(e, m.key)}>
                <label className="sr-only" htmlFor={`nick-${m.key}`}>
                  Biệt danh cho {m.name}
                </label>
                <input id={`nick-${m.key}`} className="grow" type="text" value={nick} maxLength={LIMITS.memberName} onChange={(e) => setNick(e.target.value)} placeholder={`Biệt danh cho ${m.name}`} autoFocus enterKeyHint="done" />
                <button className="btn teal" type="submit">
                  Lưu
                </button>
              </form>
            </li>
          ) : (
            <li key={m.key}>
              {m.me ? (
                <span>
                  {m.name}
                  <span className="me-mark"> (bạn)</span>
                </span>
              ) : (
                <button type="button" className="member-name" onClick={() => (setNick(nicks[m.key] ?? ""), setNaming(m.key))} aria-label={`${nicks[m.key] ?? m.name}. Bấm để đặt biệt danh`}>
                  {nicks[m.key] ?? m.name}
                  {nicks[m.key] && <span className="me-mark"> ({m.name})</span>}
                  {/* Reminders for them reach nobody until they turn notifications on: worth knowing before giving them one. */}
                  {!m.push && <span className="no-push">Chưa bật thông báo</span>}
                </button>
              )}
              {m.owner ? (
                <Crown size={16} aria-label="Chủ nhóm" />
              ) : (
                g.owner && (
                  <button type="button" className="icon-btn" aria-label={`Mời ${m.name} ra khỏi nhóm`} onClick={() => void run(() => api.groups.remove(g.id, m.key), `Đã mời ${m.name} ra khỏi nhóm`)}>
                    <X size={18} aria-hidden="true" />
                  </button>
                )
              )}
            </li>
          ),
        )}
      </ul>
      {g.members.length > 1 && <p className="small nick-hint">Bấm tên để đặt biệt danh, chỉ máy này thấy.</p>}

      {renaming ? (
        <form className="stack" onSubmit={rename}>
          <label className="field">
            <span>{renaming === "group" ? "Tên nhóm" : "Tên của bạn trong nhóm"}</span>
            <input type="text" value={text} maxLength={renaming === "group" ? LIMITS.groupName : LIMITS.memberName} onChange={(e) => setText(e.target.value)} autoFocus enterKeyHint="done" />
          </label>
          <div className="row">
            <button className="btn teal grow" type="submit">
              Lưu
            </button>
            <button className="btn ghost" type="button" onClick={() => setRenaming(null)}>
              Thôi
            </button>
          </div>
        </form>
      ) : (
        <div className="menu">
          <div className="menu-item">
            <span className="menu-text">
              Báo về máy này
              <small>{g.muted ? "Đang tắt: lời nhắc vẫn hiện trong app" : "Lời nhắc của nhóm kêu trên máy này"}</small>
            </span>
            <Switch
              on={!g.muted}
              label="Báo về máy này"
              onChange={(on) => void run(() => api.groups.mute(g.id, !on), on ? `Đã bật tiếng nhóm ${g.name}` : "Đã tắt tiếng. Lời nhắc của nhóm vẫn hiện trong app.")}
            />
          </div>
          <MenuRow label="Tên của bạn" value={me?.name ?? ""} onClick={() => (setText(me?.name ?? ""), setRenaming("me"))} />
          {g.owner && <MenuRow label="Tên nhóm" value={g.name} onClick={() => (setText(g.name), setRenaming("group"))} />}
          {g.owner && (
            <Twice className="menu-row as-btn" label="Đổi link mời" again="Link cũ sẽ thôi dùng được. Đổi?" icon={<RefreshCw size={18} aria-hidden="true" />} onGo={() => void run(() => api.groups.renew(g.id), "Đã đổi link mời")} />
          )}
        </div>
      )}

      <div className="danger-zone">
        <Twice label="Rời nhóm" again="Chắc chắn rời nhóm?" icon={<LogOut size={18} aria-hidden="true" />} onGo={() => void run(() => api.groups.leave(g.id), `Đã rời nhóm ${g.name}`).then((ok) => ok && onGone())} />
        {g.owner && (
          <Twice label="Xoá nhóm" again="Xoá nhóm và mọi lời nhắc chung?" icon={<Trash2 size={18} aria-hidden="true" />} onGo={() => void run(() => api.groups.delete(g.id), `Đã xoá nhóm ${g.name}`).then((ok) => ok && onGone())} />
        )}
      </div>
    </>
  );
}
