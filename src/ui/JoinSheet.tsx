import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { syncSoon, toast } from "../app/state";
import { api, ApiError } from "../lib/api";
import { forgetInvite } from "../lib/groups";
import { LIMITS } from "../shared/protocol";
import { Sheet } from "./Sheet";

type Preview = { name: string; inviter: string; members: number };

const REFUSED: Record<string, string> = {
  "group full": "Nhóm này đã đủ người.",
  "too many groups": `Bạn đã ở trong ${LIMITS.groupsPerPerson} nhóm, rời bớt một nhóm rồi vào lại.`,
};

/**
 * An invite opened (`/?moi=<code>`), once signed in: whose group, how many
 * are in it, and the name the others will see. Nothing joins without the
 * tap, and "Để sau" forgets it: an invite never pulls anyone in by itself.
 */
export function JoinSheet({ code, myName, onClose }: { code: string; myName: string; onClose(): void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [gone, setGone] = useState(false);
  const [name, setName] = useState(myName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.groups.invite(code).then(
      (p) => live && setPreview(p),
      (e: unknown) => live && (e instanceof ApiError ? setGone(true) : toast("Cần có mạng để xem lời mời.")),
    );
    return () => {
      live = false;
    };
  }, [code]);

  const close = () => {
    forgetInvite();
    onClose();
  };

  const join = async () => {
    if (!name.trim()) return toast("Gõ tên của bạn để mọi người biết là ai.");
    setBusy(true);
    try {
      await api.groups.join(code, name);
      forgetInvite();
      syncSoon();
      toast(`Đã vào nhóm ${preview?.name ?? ""}`.trim());
      onClose();
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.status === 404) return setGone(true);
      toast(e instanceof ApiError ? (REFUSED[e.code] ?? "Chưa vào được nhóm, thử lại sau.") : "Cần có mạng để vào nhóm.");
    }
  };

  return (
    <Sheet title="Lời mời vào nhóm" onClose={close}>
      {gone ? (
        <>
          <p>Link mời này không còn dùng được: nhóm đã đổi link hoặc không còn nữa. Xin người mời gửi lại link mới.</p>
          <button className="btn wide" onClick={close}>
            Đóng
          </button>
        </>
      ) : !preview ? (
        <div className="center" style={{ minHeight: 120 }} role="status">
          <div className="spinner" aria-hidden="true" />
        </div>
      ) : (
        <div className="stack">
          <div className="join-head">
            <Users size={28} aria-hidden="true" />
            <p>
              {preview.inviter ? `${preview.inviter} mời bạn vào nhóm` : "Bạn được mời vào nhóm"} <strong>{preview.name}</strong> ({preview.members} người).
            </p>
          </div>
          <p className="small" style={{ margin: 0 }}>
            Lời nhắc của nhóm thì ai trong nhóm cũng thấy, cũng được nhắc. Ai bấm Xong, mọi người đều biết.
          </p>
          <label className="field">
            <span>Tên của bạn trong nhóm</span>
            <input type="text" value={name} maxLength={LIMITS.memberName} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Lan, Mẹ Bin" enterKeyHint="done" />
          </label>
          <button className="btn primary wide" onClick={() => void join()} disabled={busy} data-autofocus>
            Vào nhóm
          </button>
          <button className="btn ghost wide" onClick={close}>
            Để sau
          </button>
        </div>
      )}
    </Sheet>
  );
}
