import { useState } from "react";
import { DOW } from "../shared/describe";
import { DAY, fromWall, toWall } from "../shared/wall";

const pad = (n: number) => String(n).padStart(2, "0");

export interface DayPick {
  y: number;
  m: number;
  d: number;
}

/** A day and a time being picked, starting from `start`; `at()` is the moment, or null until a time is set. */
export function useWhen(start: number, offset: number) {
  const [day, setDay] = useState<DayPick>(() => {
    const w = toWall(start, offset);
    return { y: w.y, m: w.mo, d: w.d };
  });
  const [clock, setClock] = useState(() => {
    const w = toWall(start, offset);
    return `${pad(w.h)}:${pad(w.mi)}`;
  });
  const at = () => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
    return m ? fromWall(day.y, day.m, day.d, +m[1]!, +m[2]!, offset) : null;
  };
  return { day, setDay, clock, setClock, at };
}

/**
 * The day as Hôm nay / Mai / Ngày kia, or the phone's own date picker, and
 * the time: the three days nearly every reminder is set for, one tap each.
 */
export function WhenFields({ now, offset, when, label = "Lúc" }: { now: number; offset: number; when: ReturnType<typeof useWhen>; label?: string }) {
  const { day, setDay, clock, setClock } = when;
  const dayOf = (k: number): DayPick => {
    const w = toWall(now + k * DAY, offset);
    return { y: w.y, m: w.mo, d: w.d };
  };
  const same = (a: DayPick, b: DayPick) => a.y === b.y && a.m === b.m && a.d === b.d;
  const quick = [
    { label: "Hôm nay", day: dayOf(0) },
    { label: "Mai", day: dayOf(1) },
    { label: "Ngày kia", day: dayOf(2) },
  ];
  const other = !quick.some((q) => same(q.day, day));
  return (
    <div className="picker">
      <div className="pills" role="group" aria-label="Ngày">
        {quick.map((q) => (
          <button key={q.label} type="button" className={`pill${same(q.day, day) ? " on" : ""}`} onClick={() => setDay(q.day)} aria-pressed={same(q.day, day)}>
            {q.label}
          </button>
        ))}
        {/* The phone's own date picker, under a pill that says the day picked. */}
        <label className={`pill date${other ? " on" : ""}`}>
          {other ? `${DOW[new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay()]} ${day.d}/${day.m}` : "Ngày khác"}
          <input
            type="date"
            aria-label="Ngày khác"
            value={`${day.y}-${pad(day.m)}-${pad(day.d)}`}
            onChange={(e) => {
              const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value);
              if (m) setDay({ y: +m[1]!, m: +m[2]!, d: +m[3]! });
            }}
          />
        </label>
      </div>
      <label className="field inline">
        <span>{label}</span>
        <input type="time" value={clock} onChange={(e) => setClock(e.target.value)} />
      </label>
    </div>
  );
}
