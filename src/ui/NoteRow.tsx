import { BellRing, CheckCircle2, Circle, Pin, Repeat, UserRound, Users } from "lucide-react";
import { memo } from "react";
import { eachLine } from "../lib/groups";
import { called, useNicknames } from "../lib/nicknames";
import { doneAt, shownTime, slotsOf } from "../lib/notes";
import { clockRange, daysLabel, dayLabel, lunarLabel, ruleLabel } from "../shared/describe";
import type { GroupInfo, Note } from "../shared/protocol";
import { durationAt } from "../shared/recur";
import { dayDiff } from "../shared/wall";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const LUNAR_ONEOFF = /(?:rằm|mùng|mồng)/iu;

/** "Lặp T2, T4, T7", "Lặp mỗi ngày", "Lặp ngày 5 hằng tháng": what repeats, short, after the time. */
function repeatWords(note: Note): string | null {
  if (!note.rule) return null;
  const slots = slotsOf(note.rule);
  if (!slots) return `Lặp ${ruleLabel(note.rule)}`;
  const days = [...new Set(slots.flatMap((s) => s.wds))];
  return days.length === 7 ? "Lặp mỗi ngày" : `Lặp ${daysLabel(days)}`;
}

/**
 * The note's time in plain words, under its name: no chips to decode. The
 * group above already says today or tomorrow, so those show the hour
 * alone; further off, the day comes first ("T6 16/10 · 20:30–22:00").
 */
/** A group's note as the list needs its group: its name, and its people for who it is for. */
export interface RowGroup {
  name: string;
  members: GroupInfo["members"];
}

function When({ note, now, offset, group, forName, nicks }: { note: Note; now: number; offset: number; group?: RowGroup; forName: string | null; nicks: Record<string, string> }) {
  const at = shownTime(note, now, offset);
  const extras: string[] = [];
  const again = repeatWords(note);
  if (again) extras.push(again);
  if (at !== null && !note.rule && LUNAR_ONEOFF.test(note.text)) extras.push(lunarLabel(at, offset));
  if (at === null) {
    if (!extras.length && !note.tags.length && !group) return null;
  }
  let main = "";
  let due = false;
  if (at !== null) {
    const d = dayDiff(now, at, offset);
    const time = clockRange(at, durationAt(note.rule, at, offset), offset);
    due = at <= now && doneAt(note) === null;
    // The section above already says "Đã qua giờ" or "Đến giờ": the time alone, in that colour.
    if (due) main = `${time}${d !== 0 ? ` · ${capital(dayLabel(at, now, offset))}` : ""}`;
    else if (d === 0 || d === 1) main = time;
    else main = `${capital(dayLabel(at, now, offset))} · ${time}`;
  }
  // Each ticking for themselves: how many have; once this person has, who is left (lib/groups eachLine).
  const tally = group && note.each ? eachLine(note, group.members, now, offset, nicks) : null;
  // The small words keep together, a dot between them, so a wrapped line never starts with a dot.
  return (
    <span className="when-line">
      {main && <span className={due ? "main due" : "main"}>{main}</span>}
      <span className="extras">
        {group && (
          <span className="group-tag">
            <Users size={13} aria-hidden="true" />
            {group.name}
            {/* For one person: who. Each ticking for themselves: how many have. */}
            {forName ? ` · ${forName}` : tally && ` · ${tally}`}
          </span>
        )}
        {extras.map((e) => (
          <span key={e}>{e}</span>
        ))}
        {note.nag && doneAt(note) === null && (
          <span className="nag">
            <BellRing size={13} aria-hidden="true" />
            nhắc dai
          </span>
        )}
        {note.tags.map((t) => (
          <span key={t}>#{t}</span>
        ))}
      </span>
    </span>
  );
}

export const NoteRow = memo(function NoteRow({
  note,
  now,
  offset,
  onOpen,
  onTick,
  onItem,
  group,
}: {
  note: Note;
  now: number;
  offset: number;
  /** The group, for a group's note ("Nhắc chung"). */
  group?: RowGroup;
  onOpen(id: string): void;
  onTick(id: string): void;
  onItem(id: string, i: number): void;
}) {
  // For a note each member ticks off, this person's own tick.
  const done = doneAt(note) !== null;
  const at = shownTime(note, now, offset);
  const nicks = useNicknames();
  const forWho = note.assignee ? group?.members.find((m) => m.key === note.assignee) : undefined;
  const forName = forWho ? called(forWho, nicks) : null;
  // Someone else's to tick: not with one stray tap in the list, which would do it for them
  // (the note's sheet has "Bấm Xong thay …", said in words). A person stands there instead.
  const forOther = forWho !== undefined && !forWho.me;
  // A repeating note is ticked off only when its time has come: ahead of it, the circle skipped
  // tomorrow's class without a word (a review of the app, 13/10/2026). The repeat sign stands there instead.
  const tickable = !forOther && (done || !note.rule || (at !== null && at <= now));
  return (
    <li className={`note${done ? " is-done" : ""}`}>
      {forOther ? (
        <span className="tick-space" aria-hidden="true">
          {done ? <CheckCircle2 size={22} /> : <UserRound size={20} />}
        </span>
      ) : tickable ? (
        <button className="icon-btn tick" onClick={() => onTick(note.id)} aria-label={done ? `Mở lại: ${note.title}` : note.rule ? `Xong lần này: ${note.title}` : `Xong: ${note.title}`}>
          {done ? <CheckCircle2 size={24} aria-hidden="true" /> : <Circle size={24} aria-hidden="true" />}
        </button>
      ) : (
        <span className="tick-space" aria-hidden="true">
          <Repeat size={18} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <button className="open" onClick={() => onOpen(note.id)}>
          <span className="title">
            {note.pinned && <Pin size={15} className="pin" aria-label="Đã ghim" />}
            {note.title}
          </span>
          <When note={note} now={now} offset={offset} group={group} forName={forName} nicks={nicks} />
        </button>
        {note.items && note.items.length > 0 && (
          <ul className="items">
            {note.items.map((it, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={it.done} onChange={() => onItem(note.id, i)} />
                  <span className={it.done ? "ticked" : undefined}>{it.t}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
});
