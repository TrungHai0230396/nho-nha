import { Bell, BellRing, Moon, Repeat, X } from "lucide-react";
import { Fragment } from "react";
import { lunarLabel, ruleLabel, whenLabel } from "../shared/describe";
import type { Parsed } from "../shared/parse";
import type { Note } from "../shared/protocol";
import { durationAt, type Rule } from "../shared/recur";
import { doneAt, shownTime } from "../lib/notes";

/**
 * The line with the words read as time (and tags) marked, as pieces to
 * render. With `onUnmark`, a word read as a time is a button: tapped, it is
 * put in quotes and read as a word (parse.ts), the way a wrong reading is
 * undone without losing the words.
 */
export function Marked({ text, spans, off, onUnmark }: { text: string; spans: Parsed["spans"]; off?: boolean; onUnmark?(s: number, e: number): void }) {
  const pieces: { t: string; mark: boolean; s: number; e: number; time: boolean }[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.s < pos) continue;
    if (s.s > pos) pieces.push({ t: text.slice(pos, s.s), mark: false, s: pos, e: s.s, time: false });
    pieces.push({ t: text.slice(s.s, s.e), mark: true, s: s.s, e: s.e, time: s.kind === "time" });
    pos = s.e;
  }
  if (pos < text.length) pieces.push({ t: text.slice(pos), mark: false, s: pos, e: text.length, time: false });
  return (
    <>
      {pieces.map((p, i) =>
        !p.mark ? (
          <Fragment key={i}>{p.t}</Fragment>
        ) : onUnmark && p.time && !off ? (
          <button key={i} type="button" className="mark-btn" onClick={() => onUnmark(p.s, p.e)} aria-label={`${p.t}: bấm nếu đây không phải giờ`}>
            <mark>{p.t}</mark>
          </button>
        ) : (
          <mark key={i} className={off ? "off" : undefined}>
            {p.t}
          </mark>
        ),
      )}
    </>
  );
}

/** The words from s to e put in quotes: read as words from then on. */
export const unmark = (text: string, s: number, e: number) => `${text.slice(0, s)}“${text.slice(s, e)}”${text.slice(e)}`;

const LUNAR_WORDS = /(?:rằm|mùng|mồng|âm)/iu;
const isLunar = (rule: Rule | null, text: string) => rule?.kind === "lunarMonth" || rule?.kind === "lunarYear" || LUNAR_WORDS.test(text);

/**
 * In the list, the lunar day only where it is the point: a lunar rule, or
 * a rằm or mùng 1 the line was about. "rằm thắp hương" put off to this
 * afternoon would otherwise carry "mùng 3" beside it, true and beside the point.
 */
function lunarWorthShowing(note: Note, at: number, offset: number): boolean {
  if (note.rule?.kind === "lunarYear") return true;
  if (note.rule || !LUNAR_WORDS.test(note.text)) return false;
  return /^(?:rằm|mùng 1) /.test(lunarLabel(at, offset));
}

/**
 * Time, repeat, lunar day, "nhắc dai" and tags, for a note in the list or
 * open. Open (`full`), the lunar day shows for any note that speaks of one,
 * not only the rằm and mùng 1 the list keeps it for.
 */
export function NoteChips({ note, now, offset, onTag, full = false, compact = false }: { note: Note; now: number; offset: number; onTag?(tag: string): void; full?: boolean; compact?: boolean }) {
  const at = shownTime(note, now, offset);
  const due = at !== null && at <= now && doneAt(note) === null;
  return (
    <span className="meta">
      {at !== null && (
        <span className={`chip${due ? " due" : ""}`}>
          {/* In the list one chip says both: the next time, and (by its icon) that it repeats. */}
          {compact && note.rule ? <Repeat size={14} aria-label="Lặp lại" /> : <Bell size={14} aria-hidden="true" />}
          {due && !note.rule ? "Đã qua · " : due ? "Đến giờ · " : ""}
          {whenLabel(at, now, offset, durationAt(note.rule, at, offset))}
        </span>
      )}
      {note.rule && !compact && (
        <span className="chip">
          <Repeat size={14} aria-hidden="true" />
          {ruleLabel(note.rule)}
        </span>
      )}
      {at !== null && (full ? LUNAR_WORDS.test(note.text) || note.rule?.kind.startsWith("lunar") : lunarWorthShowing(note, at, offset)) && (
        <span className="chip">
          <Moon size={14} aria-hidden="true" />
          {lunarLabel(at, offset)}
        </span>
      )}
      {note.nag && (
        <span className="chip nag">
          <BellRing size={14} aria-hidden="true" />
          nhắc dai
        </span>
      )}
      {note.tags.map((t) =>
        onTag ? (
          <button key={t} type="button" className="chip tag" onClick={(e) => (e.stopPropagation(), onTag(t))} aria-label={`Lọc theo #${t}`}>
            #{t}
          </button>
        ) : (
          <span key={t} className="chip tag">
            #{t}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * What the app understood of the line being typed: the words it read as a
 * time are marked, and the time itself shown, before anything is saved.
 * The × beside it keeps the line as a plain note when it read wrong.
 */
export function Understood({
  text,
  parsed,
  now,
  offset,
  off,
  onToggle,
  onUnmark,
  parts,
}: {
  text: string;
  parsed: Parsed;
  now: number;
  offset: number;
  off: boolean;
  onToggle(): void;
  onUnmark?(s: number, e: number): void;
  /** The reminders a one-off with several times makes (parse partsOf): a chip each, as they will be. */
  parts?: { parsed: Parsed }[] | null;
}) {
  const any = parsed.due !== null || parsed.items || parsed.tags.length;
  if (!any) return null;
  // The first time is the chip that turns reminding off for the whole line; the others are said beside it.
  const first = parts?.[0]?.parsed ?? parsed;
  return (
    <div className="understood" aria-live="polite">
      <div>
        <Marked text={text} spans={parsed.spans} off={off} onUnmark={onUnmark} />
      </div>
      <div className="meta">
        {first.due !== null &&
          (off ? (
            <button type="button" className="chip tag" onClick={onToggle}>
              <Bell size={14} aria-hidden="true" />
              Không nhắc · bấm để nhắc lại
            </button>
          ) : (
            <button
              type="button"
              className={`chip${first.past ? " due" : ""}`}
              onClick={onToggle}
              aria-label={`Nhắc ${(parts ?? [{ parsed }]).map((x) => whenLabel(x.parsed.due!, now, offset)).join(" và ")}. Bấm để bỏ nhắc`}
            >
              <Bell size={14} aria-hidden="true" />
              {first.past ? "Đã qua · " : ""}
              {whenLabel(first.due, now, offset, durationAt(first.rule, first.due, offset))}
              <X size={14} aria-hidden="true" />
            </button>
          ))}
        {!off &&
          parts?.slice(1).map((x, i) => (
            <span key={i} className={`chip${x.parsed.past ? " due" : ""}`} aria-hidden="true">
              <Bell size={14} />
              {x.parsed.past ? "Đã qua · " : ""}
              {whenLabel(x.parsed.due!, now, offset)}
            </span>
          ))}
        {!off && parts && <span className="chip tag">{parts.length} lời nhắc</span>}
        {!off && parsed.rule && (
          <span className="chip">
            <Repeat size={14} aria-hidden="true" />
            {ruleLabel(parsed.rule)}
          </span>
        )}
        {!off && parsed.due !== null && isLunar(parsed.rule, text) && parsed.rule?.kind !== "lunarMonth" && (
          <span className="chip">
            <Moon size={14} aria-hidden="true" />
            {lunarLabel(parsed.due, offset)}
          </span>
        )}
        {!off && parsed.nag && (
          <span className="chip nag">
            <BellRing size={14} aria-hidden="true" />
            nhắc dai
          </span>
        )}
        {parsed.items && <span className="chip tag">{parsed.items.length} mục để tick</span>}
        {parsed.tags.map((t) => (
          <span key={t} className="chip tag">
            #{t}
          </span>
        ))}
      </div>
    </div>
  );
}
