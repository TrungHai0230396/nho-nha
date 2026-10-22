import { Plus, Trash2, X } from "lucide-react";
import { DOW } from "../shared/describe";
import type { Slot } from "../shared/recur";

/** Monday first, the way a Vietnamese week is read. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const minutes = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? +m[1]! * 60 + +m[2]! : null;
};

/** One session as the form holds it. */
export interface SlotRow {
  wds: number[];
  start: string;
  /** Empty: a time, not a span. */
  end: string;
}

export const rowsFromSlots = (slots: Slot[]): SlotRow[] => slots.map((s) => ({ wds: s.wds, start: hhmm(s.h * 60 + s.mi), end: s.dur ? hhmm(s.h * 60 + s.mi + s.dur) : "" }));

/** The rows as slots, or what is wrong with them, in words for the person. */
export function slotsFromRows(rows: SlotRow[]): Slot[] | string {
  const out: Slot[] = [];
  for (const r of rows) {
    const a = minutes(r.start);
    const b = r.end ? minutes(r.end) : null;
    if (!r.wds.length) return "Mỗi buổi chọn ít nhất một ngày.";
    if (a === null) return "Mỗi buổi cần giờ bắt đầu.";
    if (b !== null && b <= a) return "Giờ kết thúc phải sau giờ bắt đầu.";
    const h = Math.floor(a / 60);
    out.push(b !== null ? { wds: r.wds, h, mi: a % 60, dur: b - a } : { wds: r.wds, h, mi: a % 60 });
  }
  return out.length ? out : "Thêm ít nhất một buổi.";
}

/**
 * A repeating note's week, one row a session: the days it falls on, from
 * when, and until when (or only a time); sessions added and taken off.
 * Typing the sentence again was the only way before, and a week of three
 * sessions is a sentence nobody types the same twice (Hải, 13/10/2026).
 */
export function SlotRows({ rows, onChange }: { rows: SlotRow[]; onChange(update: (rows: SlotRow[]) => SlotRow[]): void }) {
  const change = (i: number, patch: Partial<SlotRow>) => onChange((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // From the latest rows, not this render's: two quick taps would otherwise undo each other.
  const toggle = (i: number, d: number) => onChange((rs) => rs.map((r, j) => (j === i ? { ...r, wds: r.wds.includes(d) ? r.wds.filter((x) => x !== d) : [...r.wds, d] } : r)));
  return (
    <div className="schedule-edit">
      {rows.map((r, i) => (
        <div key={i} className="slot-edit">
          <div className="slot-head">
            <span>{rows.length > 1 ? `Buổi ${i + 1}` : "Các ngày"}</span>
            {rows.length > 1 && (
              <button type="button" className="icon-btn" aria-label={`Bỏ buổi ${i + 1}`} onClick={() => onChange((rs) => rs.filter((_, j) => j !== i))}>
                <Trash2 size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="days" role="group" aria-label={`Buổi ${i + 1}: các ngày`}>
            {WEEK.map((d) => (
              <button key={d} type="button" className={`day${r.wds.includes(d) ? " on" : ""}`} aria-pressed={r.wds.includes(d)} onClick={() => toggle(i, d)}>
                {DOW[d]}
              </button>
            ))}
          </div>
          <div className="times">
            <div className="time-field">
              <label htmlFor={`start-${i}`}>Từ</label>
              <input id={`start-${i}`} type="time" value={r.start} onChange={(e) => change(i, { start: e.target.value })} />
            </div>
            <div className="time-field">
              <label htmlFor={`end-${i}`}>Đến (không bắt buộc)</label>
              <div className="time-wrap">
                <input id={`end-${i}`} type="time" value={r.end} onChange={(e) => change(i, { end: e.target.value })} />
                {/* iPhone's time wheel has no way back to empty: a time picked by mistake stayed (Hải, 14/10/2026). */}
                {r.end && (
                  <button type="button" className="icon-btn time-clear" aria-label={`Bỏ giờ kết thúc buổi ${i + 1}`} onClick={() => change(i, { end: "" })}>
                    <X size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn ghost wide" onClick={() => onChange((rs) => [...rs, { wds: [], start: rs.at(-1)?.start ?? "08:00", end: rs.at(-1)?.end ?? "" }])}>
        <Plus size={18} aria-hidden="true" />
        Thêm buổi
      </button>
    </div>
  );
}
