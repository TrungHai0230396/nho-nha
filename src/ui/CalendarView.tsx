import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { dayKey, dayKeyOf, dayName, lunarShort, monthGrid, monthName, occurrences, pageBounds, quocKhanhPlus, yearName, type Cell } from "../shared/calendar";
import { clockRange, DOW } from "../shared/describe";
import type { Note } from "../shared/protocol";
import { durationAt } from "../shared/recur";
import { toWall } from "../shared/wall";
import { Sheet } from "./Sheet";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DOW_FULL = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const lunarMonthWord = (m: number) => (m === 1 ? "Giêng" : m === 12 ? "Chạp" : String(m));

interface Day {
  y: number;
  m: number;
  d: number;
}
const same = (a: Day, b: Day) => a.y === b.y && a.m === b.m && a.d === b.d;

/**
 * The calendar book: a month a page, each day with its lunar date, and the
 * picked day as a leaf of a wall calendar, solar on the left and lunar on
 * the right, with its holidays and its notes. The grid carries only what
 * reads at a glance (red for days off, one dot for a day people keep, one
 * for a day with notes); the names are on the leaf, so no legend is needed.
 */
export function CalendarView({ notes, now, offset, onClose, onOpen, onAdd }: { notes: ReadonlyMap<string, Note>; now: number; offset: number; onClose(): void; onOpen(id: string): void; onAdd(prefix: string): void }) {
  const w = toWall(now, offset);
  const today: Day = { y: w.y, m: w.mo, d: w.d };
  const [page, setPage] = useState({ y: today.y, m: today.m });
  const [picked, setPicked] = useState<Day>(today);
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Only the weeks the month touches: a sixth row of next month's days was noise.
  const cells = useMemo(() => {
    const all = monthGrid(page.y, page.m);
    const lead = all.findIndex((c) => c.inMonth);
    const days = all.filter((c) => c.inMonth).length;
    return all.slice(0, Math.ceil((lead + days) / 7) * 7);
  }, [page]);
  const byDay = useMemo(() => {
    const { from, to } = pageBounds(cells, offset);
    const map = new Map<string, { note: Note; at: number }[]>();
    for (const o of occurrences(notes.values(), from, to, offset)) {
      const k = dayKeyOf(o.at, offset);
      map.set(k, [...(map.get(k) ?? []), o]);
    }
    return map;
  }, [cells, notes, offset]);

  // A new page picks its 1st, or today on today's month: the leaf never shows a day the grid does not.
  const move = (n: number) => {
    const z = page.y * 12 + (page.m - 1) + n;
    const next = { y: Math.floor(z / 12), m: (z % 12) + 1 };
    setPage(next);
    setPicked(next.y === today.y && next.m === today.m ? today : { ...next, d: 1 });
  };
  const goToday = () => {
    setPage({ y: today.y, m: today.m });
    setPicked(today);
  };
  const atToday = page.y === today.y && page.m === today.m && same(picked, today);

  const sel: Cell = cells.find((c) => c.inMonth && same(c, picked)) ?? cells.find((c) => c.inMonth)!;
  const selNotes = byDay.get(dayKey(sel.y, sel.m, sel.d)) ?? [];
  const selRed = sel.wd === 0 || sel.holidays.some((h) => h.off);
  const quocKhanh = sel.holidays.some((h) => h.name.includes("Quốc khánh"));
  const plus = quocKhanhPlus(sel.y);
  const fine = quocKhanh
    ? `Quốc khánh nghỉ 2 ngày: 2/9 và ${plus ? `${plus}/9 (lịch của cơ quan nhà nước; doanh nghiệp có thể chọn ngày liền kề kia)` : "1 ngày liền kề, 1/9 hoặc 3/9, theo thông báo của Nhà nước"}.`
    : sel.holidays.some((h) => h.off && (h.name.includes("Tết") || h.name.includes("Giao thừa") || h.name.includes("Văn hóa")))
      ? "Nghỉ bù và hoán đổi ngày làm việc theo thông báo của Nhà nước từng năm."
      : null;

  return (
    <Sheet title="Lịch âm dương" onClose={onClose}>
      <div className="cal-nav">
        <p className="cal-month" aria-live="polite">
          Tháng {page.m}, {page.y}
        </p>
        <button className="btn ghost cal-today" onClick={goToday} style={atToday ? { visibility: "hidden" } : undefined}>
          Hôm nay
        </button>
        <button className="icon-btn" onClick={() => move(-1)} aria-label="Tháng trước">
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <button className="icon-btn" onClick={() => move(1)} aria-label="Tháng sau">
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </div>

      <div className="cal-week" aria-hidden="true">
        {WEEK.map((wd) => (
          <span key={wd} className={wd === 0 ? "sun" : undefined}>
            {DOW[wd]}
          </span>
        ))}
      </div>
      <div
        key={`${page.y}-${page.m}`}
        className="cal-grid"
        role="group"
        aria-label={`Tháng ${page.m} năm ${page.y}`}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const s = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          // Sideways, clearly: a page turn. Anything steeper is the sheet scrolling.
          if (Math.abs(dx) > 48 && Math.abs(dx) > 2 * Math.abs(t.clientY - s.y)) move(dx < 0 ? 1 : -1);
        }}
      >
        {cells.map((c, i) => {
          if (!c.inMonth) return <span key={i} aria-hidden="true" />;
          const n = byDay.get(dayKey(c.y, c.m, c.d))?.length ?? 0;
          const keep = c.holidays.some((h) => !h.off);
          const red = c.wd === 0 || c.holidays.some((h) => h.off);
          const isToday = same(c, today);
          const chosen = same(c, sel);
          const cls = ["cal-cell", red && "red", isToday && "today", chosen && "sel"].filter(Boolean).join(" ");
          const label = `${DOW_FULL[c.wd]} ${c.d} tháng ${c.m}${c.lunar ? `, âm lịch ${c.lunar.day} tháng ${c.lunar.month}` : ""}${c.holidays.length ? `, ${c.holidays.map((h) => h.name).join(", ")}` : ""}${n ? `, ${n} việc` : ""}`;
          return (
            <button key={i} className={cls} onClick={() => setPicked(c)} aria-label={label} aria-pressed={chosen} aria-current={isToday ? "date" : undefined}>
              <span className="sd">{c.d}</span>
              <span className={`ld${c.lunar?.day === 1 ? " first" : ""}`}>{c.lunar ? lunarShort(c.lunar) : ""}</span>
              <span className="marks" aria-hidden="true">
                {keep && <i className="keep" />}
                {n > 0 && <i className="busy" />}
              </span>
            </button>
          );
        })}
      </div>

      <section className="cal-page" aria-label="Ngày đã chọn">
        <div className="cal-leaf">
          <div>
            <span className="cap">{DOW_FULL[sel.wd]}</span>
            <span className={`big${selRed ? " red" : ""}`}>{sel.d}</span>
            <span className="sub">
              Tháng {sel.m}, {sel.y}
            </span>
          </div>
          {sel.lunar && (
            <div className="lunar">
              <span className="cap">Âm lịch</span>
              <span className="big">{sel.lunar.day}</span>
              <span className="sub">
                Tháng {lunarMonthWord(sel.lunar.month)}
                {sel.lunar.leap ? " nhuận" : ""} · {yearName(sel.lunar.year)}
              </span>
            </div>
          )}
        </div>
        {sel.lunar && (
          <p className="cal-canchi">
            Ngày {dayName(sel.y, sel.m, sel.d)} · Tháng {monthName(sel.lunar.month, sel.lunar.year)}
          </p>
        )}
        {sel.holidays.length > 0 && (
          <ul className="cal-holidays">
            {sel.holidays.map((h) => (
              <li key={h.name}>
                <i className={h.off ? "off" : "keep"} aria-hidden="true" />
                <span>{h.name}</span>
                {h.off && <span className="tag">Nghỉ lễ</span>}
              </li>
            ))}
          </ul>
        )}
        {fine && <p className="small cal-fine">{fine}</p>}
      </section>

      <h3>Việc trong ngày</h3>
      {selNotes.length > 0 ? (
        <ul className="cal-items">
          {selNotes.map(({ note, at }) => (
            <li key={`${note.id}-${at}`}>
              <button
                onClick={() => {
                  onClose();
                  onOpen(note.id);
                }}
              >
                <span className="time">{clockRange(at, durationAt(note.rule, at, offset), offset)}</span>
                <span className="title">{note.title}</span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small cal-none">Chưa có việc nào.</p>
      )}
      <button className="btn ghost wide cal-add" onClick={() => (onClose(), onAdd(`${sel.d}/${sel.m} `))}>
        <Plus size={18} aria-hidden="true" />
        Thêm việc ngày {sel.d}/{sel.m}
      </button>
    </Sheet>
  );
}
