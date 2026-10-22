import { Plus, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { store, syncSoon, toast } from "../app/state";
import { api, ApiError } from "../lib/api";
import { membersLine } from "../lib/groups";
import { useNicknames } from "../lib/nicknames";
import { newId } from "../lib/ids";
import { intoGroup } from "../lib/notes";
import { LIMITS, type GroupInfo, type Note } from "../shared/protocol";
import { invite } from "./GroupSettings";

/**
 * "Nhắc chung": one's own note into a group, where everyone in it sees it
 * and is reminded. Into a group already there, or one made here; a group
 * of one gets the invite offered straight away, since nobody else would
 * be reminded yet.
 */
export function ShareToGroup({ note, groups, myName, onDone, onCancel }: { note: Note; groups: readonly GroupInfo[]; myName: string; onDone(): void; onCancel(): void }) {
  const [making, setMaking] = useState(groups.length === 0);
  const [name, setName] = useState("");
  const [me, setMe] = useState(myName);
  const [busy, setBusy] = useState(false);
  const nicks = useNicknames();

  const move = async (g: GroupInfo) => {
    const [moved, gone] = intoGroup(note, g.id, newId(), Date.now());
    await store.put(gone);
    await store.put(moved);
    syncSoon();
    const alone = g.members.length < 2;
    toast(alone ? `Đã đưa vào nhóm ${g.name}. Mời người vào để cùng được nhắc.` : `Đã đưa vào nhóm ${g.name}`, alone ? { label: "Mời", run: () => void invite(g) } : undefined);
    onDone();
  };

  const make = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !me.trim()) return toast("Gõ tên nhóm và tên của bạn.");
    setBusy(true);
    try {
      const { id } = await api.groups.create(name, me);
      await store.sync();
      const g = store.getSnapshot().groups.find((x) => x.id === id);
      if (!g) throw new Error("not synced");
      await move(g);
    } catch (err) {
      setBusy(false);
      toast(err instanceof ApiError && err.code === "too many groups" ? `Mỗi người ở tối đa ${LIMITS.groupsPerPerson} nhóm.` : "Cần có mạng để tạo nhóm.");
    }
  };

  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <p className="small" style={{ margin: 0 }}>
        Ai trong nhóm cũng thấy lời nhắc này, cũng được nhắc đúng giờ. Ai bấm Xong, mọi người đều biết.
      </p>
      {groups.map((g) => (
        <button key={g.id} type="button" className="choice-row" onClick={() => void move(g)}>
          <Users size={22} aria-hidden="true" />
          <span>
            <strong>{g.name}</strong>
            <span className="small">{membersLine(g, nicks)}</span>
          </span>
        </button>
      ))}
      {making ? (
        <form className="stack group-new" onSubmit={(e) => void make(e)}>
          <label className="field">
            <span>Tên nhóm mới</span>
            <input type="text" value={name} maxLength={LIMITS.groupName} onChange={(e) => setName(e.target.value)} placeholder="Gia đình, Lớp 12A…" autoFocus />
          </label>
          <label className="field">
            <span>Tên của bạn trong nhóm</span>
            <input type="text" value={me} maxLength={LIMITS.memberName} onChange={(e) => setMe(e.target.value)} placeholder="Ví dụ: Bố Bin" />
          </label>
          <button className="btn teal wide" type="submit" disabled={busy}>
            Tạo nhóm và đưa vào
          </button>
        </form>
      ) : (
        <button type="button" className="btn ghost wide" onClick={() => setMaking(true)}>
          <Plus size={18} aria-hidden="true" />
          Nhóm mới
        </button>
      )}
      <button type="button" className="btn ghost wide" onClick={onCancel}>
        Thôi
      </button>
    </div>
  );
}
