import { useMemo, useState } from "react";
import { toast, useNotes } from "../app/state";
import { newId } from "../lib/ids";
import { called, useNicknames } from "../lib/nicknames";
import { applyEdit, editText, newNote, slotsOf, type WhenEdit } from "../lib/notes";
import { ruleLabel } from "../shared/describe";
import { parse, partsOf } from "../shared/parse";
import type { Note } from "../shared/protocol";
import { MINUTE, toWall } from "../shared/wall";
import { Understood, unmark } from "./Chips";
import { Switch } from "./Menu";
import { rowsFromSlots, SlotRows, slotsFromRows, type SlotRow } from "./ScheduleEditor";
import { useWhen, WhenFields } from "./WhenPicker";

const pad = (n: number) => String(n).padStart(2, "0");
type Mode = "none" | "once" | "repeat";

/**
 * Everything about a note in one place, as answers rather than a sentence:
 * its name, whether and when it reminds (not at all, once, or on days of
 * the week, session by session), and whether it nags. What is saved is
 * written back into the sentence (lib/notes applyEdit), so the sentence
 * stays true; "Sửa cả câu" is still there for whoever prefers typing it.
 */
export function NoteEditor({
  note,
  now,
  offset,
  start,
  onSave,
  onCancel,
}: {
  note: Note;
  now: number;
  offset: number;
  start?: Mode;
  /** `more`: new notes the sentence made beside this one ("mai 9h và 15h họp": the 15h one). */
  onSave(n: Note, message: string, more?: Note[]): void;
  onCancel(): void;
}) {
  const slots = slotsOf(note.rule);
  // A rule the week cannot hold (monthly, yearly, lunar) is shown, and changed through the sentence.
  const other = note.rule !== null && slots === null;
  const [title, setTitle] = useState(note.title);
  const [mode, setMode] = useState<Mode>(note.rule ? "repeat" : note.due !== null ? "once" : (start ?? "none"));
  const [nag, setNag] = useState(note.nag);
  const [sentence, setSentence] = useState(false);
  const [text, setText] = useState(note.text);
  const parsed = useMemo(() => parse(text, now, offset), [text, now, offset]);
  const parts = useMemo(() => partsOf(parsed, now, offset), [parsed, now, offset]);
  // A group's note: whom it is for and how it is ticked off, changed here with the rest of it
  // (Hải, 14/10/2026: "trong phần sửa không có chọn lại mỗi người tự bấm xong").
  const { groups } = useNotes();
  const group = note.group ? groups.find((g) => g.id === note.group) : undefined;
  const nicks = useNicknames();
  const [assignee, setAssignee] = useState<string | null>(() => (group?.members.some((m) => m.key === note.assignee) ? note.assignee : null));
  const [each, setEach] = useState(note.each);
  // Given to someone whose phone will not ring: said where it is chosen.
  const deaf = group?.members.find((m) => m.key === assignee && !m.me && !m.push);

  // The sentence typed again: this note takes it, or its first time when it names several,
  // and each other time becomes a note beside it, in the same group, for the same person.
  const saveSentence = () => {
    const line = text.trim();
    if (!line) return toast("Ghi chú không được để trống.");
    const at = Date.now();
    const split = partsOf(parse(line, at, offset), at, offset);
    if (!split) return onSave(editText(note, line, at, offset), "Đã sửa");
    const more = split.slice(1).map((x) => {
      const made = newNote(newId(), x.text, at, offset);
      return { ...made, group: note.group, assignee: note.assignee, each: note.each, watch: note.watch?.on ? { on: true, t: at } : null };
    });
    onSave(editText(note, split[0]!.text, at, offset), `Đã sửa, thêm ${more.length} lời nhắc`, more);
  };

  // Once: from the time set if still ahead, else an hour from now.
  const first = !note.rule && note.due !== null && note.due > now ? note.due : Math.ceil((now + 60 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;
  const picked = useWhen(first, offset);
  const [rows, setRows] = useState<SlotRow[]>(() => {
    if (slots) return rowsFromSlots(slots);
    const w = toWall(note.due ?? first, offset);
    return [{ wds: [w.wd], start: `${pad(w.h)}:${pad(w.mi)}`, end: "" }];
  });

  const save = () => {
    let when: WhenEdit = { kind: "keep" };
    if (mode === "none" && (note.due !== null || note.rule)) when = { kind: "none" };
    if (mode === "once") {
      const at = picked.at();
      if (at === null) return toast("Chọn giờ nhắc trước đã.");
      if (at <= Date.now()) return toast("Chọn một lúc chưa tới.");
      if (note.rule || at !== note.due) when = { kind: "once", at };
    }
    if (mode === "repeat" && !other) {
      const s = slotsFromRows(rows);
      if (typeof s === "string") return toast(s);
      if (JSON.stringify(s) !== JSON.stringify(slots)) when = { kind: "repeat", slots: s };
    }
    if (!title.trim()) return toast("Đặt cho ghi chú một cái tên.");
    const at = Date.now();
    let out = applyEdit(note, { title, when, nag: mode === "none" ? false : nag, ...(group ? { assignee, each } : {}) }, at, offset);
    // Given to someone else: told if they do not tap, unless this person already said no on it.
    const forOther = group?.members.some((m) => m.key === assignee && !m.me) ?? false;
    if (forOther && assignee !== note.assignee && note.watch === null) out = { ...out, watch: { on: true, t: at } };
    onSave(out, "Đã lưu");
  };

  if (sentence) {
    return (
      <div className="stack" style={{ marginTop: 8 }}>
        <label htmlFor="edit" className="small">
          Gõ lại cả câu, như lúc tạo. Bấm vào chữ tô màu nếu đó không phải giờ.
        </label>
        <textarea id="edit" rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        {text.trim() && <Understood text={text} parsed={parsed} parts={parts} now={now} offset={offset} off={false} onToggle={() => {}} onUnmark={(s, e) => setText((t) => unmark(t, s, e))} />}
        <div className="row">
          <button className="btn teal grow" onClick={saveSentence}>
            Lưu
          </button>
          <button className="btn ghost" onClick={() => setSentence(false)}>
            Quay lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <label className="field">
        <span>Tên</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} enterKeyHint="done" />
      </label>

      <div className="field">
        <span id="when-label">Nhắc</span>
        <div className="seg" role="radiogroup" aria-labelledby="when-label">
          {(
            [
              ["none", "Không nhắc"],
              ["once", "Một lần"],
              ["repeat", "Lặp lại"],
            ] as const
          ).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : undefined} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "once" && <WhenFields now={now} offset={offset} when={picked} />}

      {mode === "repeat" &&
        (other ? (
          <p className="small note-box">
            Đang lặp {ruleLabel(note.rule!)}. Muốn đổi kiểu lặp này thì bấm “Sửa cả câu” bên dưới.
          </p>
        ) : (
          <SlotRows rows={rows} onChange={setRows} />
        ))}

      {/* How it reminds, as rows on one card the way Cài đặt has them: the name on the left, a short
          line under it, the control on the right. A select and two checkboxes with their reasons
          trailing over two lines each read as clutter (Hải, 14/10/2026: "rối quá"). */}
      {(group || mode !== "none") && (
        <div className="menu editor-menu">
          {group && (
            <label className="menu-item">
              <span className="menu-text">
                Nhắc ai
                {deaf && <small className="warn">{called(deaf, nicks)} chưa bật thông báo nên sẽ không được nhắc</small>}
              </span>
              <select value={assignee ?? ""} onChange={(e) => setAssignee(e.target.value || null)}>
                <option value="">Cả nhóm</option>
                {group.members.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.me ? "Chỉ mình tôi" : `Chỉ ${called(m, nicks)}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* Repeating too: "9h, 18h hằng ngày uống thuốc", each person each dose. */}
          {group && !assignee && (
            <div className="menu-item">
              <span className="menu-text">
                Mỗi người tự bấm Xong
                <small>Người chưa bấm vẫn được nhắc</small>
              </span>
              <Switch on={each} label="Mỗi người tự bấm Xong" onChange={setEach} />
            </div>
          )}
          {mode !== "none" && (
            <div className="menu-item">
              <span className="menu-text">
                Nhắc dai
                <small>Mỗi 10 phút, tới khi bấm Xong</small>
              </span>
              <Switch on={nag} label="Nhắc dai" onChange={setNag} />
            </div>
          )}
        </div>
      )}

      <div className="row">
        <button className="btn teal grow" onClick={save}>
          Lưu
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Thôi
        </button>
      </div>
      <button type="button" className="link-btn" onClick={() => setSentence(true)}>
        Sửa cả câu
      </button>
    </div>
  );
}
