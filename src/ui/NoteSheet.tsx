import { Bell, BellRing, Check, Clock, Eye, Hash, Moon, Pencil, Pin, PinOff, Plus, Repeat, RotateCcw, Trash2, UserCheck, UserPlus, Users, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cachedMe, store, syncSoon, toast, useNotes } from "../app/state";
import { leftAfterTap, membersLine } from "../lib/groups";
import { called, useNicknames } from "../lib/nicknames";
import { addItem, doneAt, markDone, remove, removeItem, reopen, restore, roundOf, shownTime, slotsOf, snooze, snoozeOptions, stamp, tapsFor, toggleItem, togglePin, undone } from "../lib/notes";
import { andList, clockRange, dayLabel, DOW, lunarLabel, ruleLabel, whenLabel } from "../shared/describe";
import type { Note } from "../shared/protocol";
import { durationAt } from "../shared/recur";
import { MINUTE } from "../shared/wall";
import { invite } from "./GroupSettings";
import { Switch } from "./Menu";
import { NoteEditor } from "./NoteEditor";
import { ShareToGroup } from "./ShareToGroup";
import { useWhen, WhenFields } from "./WhenPicker";
import { Sheet } from "./Sheet";

async function save(n: Note) {
  await store.put(n);
  syncSoon();
}

const LUNAR_WORDS = /(?:rằm|mùng|mồng|âm)/iu;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n: number) => String(n).padStart(2, "0");
const slotClock = (s: { h: number; mi: number; dur?: number }) => {
  const at = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const start = s.h * 60 + s.mi;
  return s.dur ? `${at(start)}–${at(start + s.dur)}` : at(start);
};

/** One fact about the note: an icon, what it is, and its value. */
function Fact({ icon, label, tone, children }: { icon: ReactNode; label: string; tone?: "due"; children: ReactNode }) {
  return (
    <div className={`fact${tone ? ` ${tone}` : ""}`}>
      <span className="fact-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="fact-label">{label}</span>
      <span className="fact-value">{children}</span>
    </div>
  );
}

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DOW_FULL = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

/**
 * A repeating note's week at a glance: Monday to Sunday, the days it falls
 * on filled, each with its hours under it. Read like a timetable, which is
 * what a class schedule is.
 */
function WeekStrip({ slots }: { slots: { wds: number[]; h: number; mi: number; dur?: number }[] }) {
  const at = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  return (
    <div className="week" role="list" aria-label="Lịch trong tuần">
      {WEEK.map((d) => {
        const here = slots.filter((s) => s.wds.includes(d)).sort((a, b) => a.h * 60 + a.mi - (b.h * 60 + b.mi));
        return (
          <div key={d} role="listitem" className={`wk${here.length ? " on" : ""}`} aria-label={`${DOW_FULL[d]}: ${here.length ? here.map((s) => slotClock(s)).join(", ") : "không có"}`}>
            <span className="wk-day" aria-hidden="true">
              {DOW[d]}
            </span>
            {here.map((s, i) => (
              <span key={i} className="wk-time" aria-hidden="true">
                {at(s.h * 60 + s.mi)}
                {s.dur ? <small>{at(s.h * 60 + s.mi + s.dur)}</small> : null}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One note, open. Hải found the last one hard to use and hard to read
 * (13/10/2026): the same week said four times (a chip, a list, the
 * sentence, the next time), "Xong" and "+10 phút" offered for a class that
 * is tomorrow, and four places to edit. Now:
 *
 * - what it is, once, in words: when it reminds next, how it repeats;
 * - only the actions that fit where it stands: come round, "Xong" and the
 *   times to be reminded again; ahead, "Sửa"; without a time, "Đặt giờ
 *   nhắc"; done, "Mở lại";
 * - one place to change it (NoteEditor), and the sentence it was typed as
 *   only there, behind "Sửa cả câu".
 *
 * Opened from a notification, it is come round: "Xong" is first and big,
 * since iPhone shows no buttons on a web app's notification.
 */
export function NoteSheet({ note, now, offset, onClose, onTag }: { note: Note; now: number; offset: number; onClose(): void; onTag(tag: string): void }) {
  const [editing, setEditing] = useState<false | "edit" | "once">(false);
  const [adding, setAdding] = useState("");
  const [moving, setMoving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const { groups } = useNotes();
  const group = note.group ? groups.find((g) => g.id === note.group) : undefined;
  const nicks = useNicknames();
  // Who ticked it off, as this phone calls them; the name is empty until the server has stamped it.
  const byMember = note.by?.key ? group?.members.find((m) => m.key === note.by!.key) : undefined;
  const byWho = !note.by ? "" : note.by.name === "" ? "bạn" : byMember ? called(byMember, nicks) : note.by.name;
  const showBy = !note.each && note.by !== null && group !== undefined && (note.rule !== null || note.done !== null);
  const doneMine = doneAt(note);
  const at = shownTime(note, now, offset);
  const state = doneMine !== null ? "done" : at === null ? "plain" : at <= now ? "due" : "ahead";
  // Each ticking for themselves (protocol Note.each): who has, who has not yet. A repeating one,
  // for one time: the one this person is at once it has come, else the last one, said as such.
  const round = note.each && group ? roundOf(note, now, offset) : null;
  const lastTime = note.rule !== null && round !== null && state !== "due";
  const taps = round !== null && group ? tapsFor(note, group.members, round, offset) : null;
  const counted = group && taps ? group.members.flatMap((m) => (taps.done.has(m.key) ? [{ ...m, at: taps.done.get(m.key)! }] : [])) : [];
  const notYet = group && taps ? group.members.filter((m) => taps.missing.includes(m.key)) : [];
  // For one member (protocol Note.assignee): a key gone from the group counts as everyone's.
  const forWho = note.assignee ? group?.members.find((m) => m.key === note.assignee) : undefined;
  const forOther = forWho !== undefined && !forWho.me;
  const forName = forWho ? called(forWho, nicks) : "";
  // "Báo cho tôi": on a note for someone else, or one each ticks off.
  const canWatch = group !== undefined && (forOther || (!forWho && note.each));
  const watching = note.watch?.on === true;
  // Who is told, as this phone calls them: by key, so a nickname or a new name shows. Not this
  // person where the box below already says it (the same thing said twice, Hải's dislike).
  const told = note.watchers.filter((w) => !(canWatch && w.me)).map((w) => {
    const m = group?.members.find((x) => x.key === w.key);
    return m ? called(m, nicks) : w.me ? "bạn" : w.name;
  });
  const slots = slotsOf(note.rule);
  // "Tối nay 20:00" on a note already set for 20:00 tonight would change nothing.
  const options = snoozeOptions(now, offset).filter((o) => note.due === null || Math.abs(o.at - note.due) >= MINUTE);
  const details = note.text.includes("\n") ? note.text.slice(note.text.indexOf("\n") + 1).trim() : "";
  const picked = useWhen(at !== null && at > now ? at : now + 60 * MINUTE, offset);

  // `more`: notes made beside this one (a sentence with several times); undone with it.
  const act = async (n: Note, message: string, undo?: Note, more: Note[] = []) => {
    await save(n);
    for (const m of more) await save(m);
    // The undo is an edit of its own, later than the one it undoes, or the server would keep that one.
    const back = () => {
      if (!undo) return;
      void save(undone(undo, store.get(undo.id), Date.now()));
      for (const m of more) void save(remove(store.get(m.id) ?? m, Date.now()));
    };
    toast(message, undo ? { label: "Hoàn tác", run: back } : undefined);
    onClose();
  };
  const done = () => {
    const n = markDone(note, Date.now(), offset);
    const then = n.rule ? shownTime(n, Date.now(), offset) : null;
    const left = group ? leftAfterTap(n, group.members, offset, nicks) : null;
    void act(n, left ? `Xong. ${left}.` : then !== null ? `Xong. Lần tới: ${whenLabel(then, Date.now(), offset)}` : "Xong", note);
  };
  const putOff = (when: number) => void act(snooze(note, when, Date.now()), `Sẽ nhắc ${forOther ? `${forName} ` : ""}lại ${whenLabel(when, Date.now(), offset)}`, note);
  // This one time only: the week stays as it is.
  const moveOnce = () => {
    const t = picked.at();
    if (t === null) return toast("Chọn giờ trước đã.");
    if (t <= Date.now()) return toast("Chọn một lúc chưa tới.");
    void act(snooze(note, t, Date.now()), `Lần này dời sang ${whenLabel(t, Date.now(), offset)}`, note);
  };
  const addThing = () => {
    if (!adding.trim()) return;
    void save(addItem(note, adding, Date.now(), offset));
    setAdding("");
  };

  if (sharing) {
    return (
      <Sheet title="Nhắc chung" onClose={onClose}>
        <ShareToGroup note={note} groups={groups} myName={cachedMe()?.name ?? ""} onDone={onClose} onCancel={() => setSharing(false)} />
      </Sheet>
    );
  }

  if (editing) {
    return (
      <Sheet title="Sửa ghi chú" onClose={onClose}>
        <NoteEditor note={note} now={now} offset={offset} start={editing === "once" ? "once" : undefined} onSave={(n, m, more) => void act(n, m, note, more)} onCancel={() => setEditing(false)} />
      </Sheet>
    );
  }

  const when = (t: number) => `${capital(dayLabel(t, now, offset))} · ${clockRange(t, durationAt(note.rule, t, offset), offset)}`;

  return (
    <Sheet title={note.title} onClose={onClose}>
      {state === "done" ? (
        <div className="next">
          <span className="next-label">{note.each && group ? "Bạn đã xong" : "Đã xong"}</span>
          <span className="next-time">{when(doneMine!)}</span>
        </div>
      ) : at !== null ? (
        <div className={`next${state === "due" ? " due" : ""}`}>
          <span className="next-label">{state === "due" ? (note.rule ? "Đến giờ" : "Đã qua giờ") : note.rule ? "Lần tới" : "Nhắc lúc"}</span>
          <span className="next-day">{capital(dayLabel(at, now, offset))}</span>
          <span className="next-time">{clockRange(at, durationAt(note.rule, at, offset), offset)}</span>
        </div>
      ) : (
        <p className="small fact-none">Chưa đặt giờ nhắc.</p>
      )}
      {slots && <WeekStrip slots={slots} />}
      {(group || showBy || (note.rule && !slots) || (at !== null && (LUNAR_WORDS.test(note.text) || note.rule?.kind.startsWith("lunar"))) || (note.nag && state !== "done") || note.tags.length > 0) && (
        <div className="facts">
          {group && (
            <Fact icon={<Users size={20} />} label="Nhóm">
              {group.name} · {membersLine(group, nicks)}
            </Fact>
          )}
          {group && forWho && (
            <Fact icon={<Bell size={20} />} label="Nhắc">
              {capital(forName)}
              {forOther && !forWho.push && <span className="small warn-line">Chưa bật thông báo nên sẽ không được nhắc</span>}
            </Fact>
          )}
          {group && (forWho || note.each) && told.length > 0 && (
            <Fact icon={<Eye size={20} />} label="Báo cho">
              {capital(andList(told))}
              <span className="small">{forWho?.me ? "nếu bạn chưa bấm Xong sau 30 phút" : "nếu 30 phút sau giờ nhắc chưa bấm Xong"}</span>
            </Fact>
          )}
          {group && round !== null && !lastTime && counted.length > 0 && (
            <Fact icon={<UserCheck size={20} />} label={`Xong ${counted.length}/${group.members.length}`}>
              {/* Capital at the start only: "bạn" further on stays lowercase. */}
              {capital(
                [...counted]
                  .sort((a, b) => a.at - b.at)
                  .map((t) => `${called(t, nicks)} ${clockRange(t.at, null, offset)}`)
                  .join(" · "),
              )}
            </Fact>
          )}
          {group && round !== null && !lastTime && notYet.length > 0 && (
            <Fact icon={<Clock size={20} />} label="Chưa xong">
              {capital(notYet.map((m) => called(m, nicks)).join(", "))}
            </Fact>
          )}
          {/* Past the last time already ("Lần tới 18:00"): how the morning's went, said with its hour. */}
          {group && round !== null && lastTime && (
            <Fact icon={notYet.length ? <Clock size={20} /> : <UserCheck size={20} />} label="Lần trước">
              {notYet.length ? `${capital(andList(notYet.map((m) => called(m, nicks))))} chưa xong` : "Cả nhóm đã xong"}
              <span className="small">{whenLabel(round, now, offset)}</span>
            </Fact>
          )}
          {showBy && (
            <Fact icon={<UserCheck size={20} />} label={note.rule ? "Lần trước" : "Xong bởi"}>
              {capital(byWho)}
              {note.rule ? " xong" : ""} · {whenLabel(note.by!.at, now, offset)}
            </Fact>
          )}
          {note.rule && !slots && (
            <Fact icon={<Repeat size={20} />} label="Lặp lại">
              {capital(ruleLabel(note.rule))}
            </Fact>
          )}
          {at !== null && (LUNAR_WORDS.test(note.text) || note.rule?.kind.startsWith("lunar")) && (
            <Fact icon={<Moon size={20} />} label="Âm lịch">
              {capital(lunarLabel(at, offset))}
            </Fact>
          )}
          {note.nag && state !== "done" && (
            <Fact icon={<BellRing size={20} />} label="Nhắc dai">
              Mỗi 10 phút, tới khi bấm Xong
            </Fact>
          )}
          {note.tags.length > 0 && (
            <Fact icon={<Hash size={20} />} label="Thẻ">
              <span className="fact-tags">
                {note.tags.map((t) => (
                  <button key={t} type="button" className="chip tag" onClick={() => (onTag(t), onClose())} aria-label={`Lọc theo #${t}`}>
                    #{t}
                  </button>
                ))}
              </span>
            </Fact>
          )}
        </div>
      )}

      {/* Whom it is for and how it is ticked off are changed in Sửa, with the rest of the note; this is
          this person's own choice, so it stays here. */}
      {group && canWatch && (
        <div className="menu sheet-menu">
          <div className="menu-item">
            <span className="menu-text">
              {forOther ? `Báo cho tôi nếu ${forName} chưa bấm Xong` : "Báo cho tôi ai chưa bấm Xong"}
              <small className={group.muted ? "warn" : undefined}>
                {group.muted ? "Bạn đang tắt tiếng nhóm này nên sẽ không được báo." : `${note.rule ? "30 phút sau mỗi lần nhắc" : "Một lần, 30 phút sau giờ nhắc"}. Giờ ngủ thì đợi sáng.`}
              </small>
            </span>
            <Switch on={watching} label={forOther ? `Báo cho tôi nếu ${forName} chưa bấm Xong` : "Báo cho tôi ai chưa bấm Xong"} onChange={(on) => void save({ ...note, watch: { on, t: Date.now() }, updated: stamp(note, Date.now()) })} />
          </div>
        </div>
      )}

      {state === "due" && (
        <>
          {forOther ? (
            // Not the big button: opened from "Bố chưa bấm Xong", a tap meant to dismiss would tick it off for him.
            <button className="btn ghost wide sheet-main" onClick={done}>
              <Check size={20} aria-hidden="true" />
              Bấm Xong thay {forName}
            </button>
          ) : (
            <button className="btn primary wide sheet-main" onClick={done} data-autofocus>
              <Check size={20} aria-hidden="true" />
              {note.rule ? "Xong lần này" : "Xong"}
            </button>
          )}
          <h3>{forOther ? `Nhắc ${forName} lại sau` : "Nhắc lại sau"}</h3>
          <div className="pills" role="group" aria-label="Nhắc lại sau">
            {options.map((o) => (
              <button key={o.label} className="pill" onClick={() => putOff(o.at)}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
      {state === "ahead" && (
        <div className="stack sheet-main">
          <button className="btn teal wide" onClick={() => setEditing("edit")} data-autofocus>
            <Pencil size={18} aria-hidden="true" />
            Sửa
          </button>
          {note.rule ? (
            <div className="two">
              <button className={`btn ghost${moving ? " on" : ""}`} onClick={() => setMoving(!moving)} aria-expanded={moving}>
                Dời lần này
              </button>
              <button className="btn ghost" onClick={done}>
                Bỏ qua lần này
              </button>
            </div>
          ) : (
            <button className="btn ghost wide" onClick={done}>
              <Check size={18} aria-hidden="true" />
              {forOther ? `Bấm Xong thay ${forName}` : "Xong rồi"}
            </button>
          )}
          {moving && (
            <>
              <WhenFields now={now} offset={offset} when={picked} />
              <button className="btn teal wide" onClick={moveOnce}>
                Dời lần này sang giờ đã chọn
              </button>
            </>
          )}
        </div>
      )}
      {state === "plain" && (
        <button className="btn teal wide sheet-main" onClick={() => setEditing("once")} data-autofocus>
          <Bell size={18} aria-hidden="true" />
          Đặt giờ nhắc
        </button>
      )}
      {state === "done" && (
        <button className="btn teal wide sheet-main" onClick={() => void act(reopen(note, Date.now()), "Đã mở lại")} data-autofocus>
          <RotateCcw size={18} aria-hidden="true" />
          Mở lại
        </button>
      )}

      {note.items && (
        <>
          <h3>Danh sách</h3>
          <ul className="items editable">
            {note.items.map((it, i) => (
              <li key={`${i}-${it.t}`}>
                <label>
                  <input type="checkbox" checked={it.done} onChange={() => void save(toggleItem(note, i, Date.now()))} />
                  <span className={it.done ? "ticked" : undefined}>{it.t}</span>
                </label>
                <button className="icon-btn item-x" onClick={() => void save(removeItem(note, i, Date.now(), offset))} aria-label={`Bỏ ${it.t} khỏi danh sách`}>
                  <X size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="row add-item"
            onSubmit={(e) => {
              e.preventDefault();
              addThing();
            }}
          >
            <label htmlFor="add-item" className="sr-only">
              Thêm món
            </label>
            <input id="add-item" className="grow" type="text" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Thêm món…" enterKeyHint="done" />
            <button className="btn ghost" type="submit" aria-label="Thêm vào danh sách">
              <Plus size={18} aria-hidden="true" />
              Thêm
            </button>
          </form>
        </>
      )}

      {details && (
        <>
          <h3>Ghi chú</h3>
          <p className="details">{details}</p>
        </>
      )}

      <div className="sheet-tools">
        {state !== "ahead" && (
          <button className="tool" onClick={() => setEditing("edit")}>
            <Pencil size={20} aria-hidden="true" />
            Sửa
          </button>
        )}
        {group ? (
          <button className="tool" onClick={() => void invite(group)}>
            <UserPlus size={20} aria-hidden="true" />
            Mời
          </button>
        ) : (
          note.group === null && (
            <button className="tool" onClick={() => setSharing(true)}>
              <Users size={20} aria-hidden="true" />
              Nhắc chung
            </button>
          )
        )}
        <button className="tool" onClick={() => void act(togglePin(note, Date.now()), note.pinned ? "Đã bỏ ghim" : "Đã ghim")}>
          {note.pinned ? <PinOff size={20} aria-hidden="true" /> : <Pin size={20} aria-hidden="true" />}
          {note.pinned ? "Bỏ ghim" : "Ghim"}
        </button>
        <button className="tool danger" onClick={() => void act(remove(note, Date.now()), "Đã xoá", restore(note, Date.now()))}>
          <Trash2 size={20} aria-hidden="true" />
          Xoá
        </button>
      </div>
    </Sheet>
  );
}
