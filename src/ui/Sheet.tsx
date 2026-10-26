import { ChevronLeft, Pencil, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Sheets open at once share one scroll lock: each saved and restored the
 * page's overflow, so closing them out of order left the list unable to
 * scroll until a reload.
 */
let lockedBy = 0;
let pageOverflow = "";
/** Open sheets, the last on top: only it answers Escape and keeps Tab, or one press closed both. */
const open: object[] = [];

/**
 * A sheet that rises from the bottom (a dialog in the middle on a wide
 * screen). Escape, the close button and a tap outside all close it; focus
 * moves in when it opens and back to where it was when it closes, unless
 * closing handed it on (a picked suggestion fills the composer and focuses
 * it, inside the tap, so the iPhone keyboard comes up).
 */
export function Sheet({ title, onClose, children, head, onTitle, onBack }: { title: string; onClose(): void; children: ReactNode; head?: ReactNode; onTitle?(): void; onBack?(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const me = {};
    open.push(me);
    const node = ref.current;
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>("button, [href], input, select, textarea");
    first?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (open.at(-1) !== me) return;
      if (e.key === "Escape") close.current();
      if (e.key !== "Tab" || !ref.current) return;
      // Focus stays inside while it is open: among what can be seen, or a field inside a closed
      // <details> was the last stop and Tab went on behind the backdrop.
      const all = [...ref.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, select, textarea, summary")].filter((el) => el.getClientRects().length > 0);
      if (!all.length) return;
      const [a, z] = [all[0]!, all.at(-1)!];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", key);
    if (lockedBy++ === 0) {
      pageOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      open.splice(open.indexOf(me), 1);
      document.removeEventListener("keydown", key);
      if (--lockedBy === 0) document.body.style.overflow = pageOverflow;
      const now = document.activeElement;
      if (!now || now === document.body || node?.contains(now)) before?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <div className="grabber" aria-hidden="true" />
        <div className="sheet-head">
          {/* A page inside the sheet (Settings → Thông báo): back to the one it came from. */}
          {onBack && (
            <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="Quay lại">
              <ChevronLeft size={24} aria-hidden="true" />
            </button>
          )}
          <h2 id={labelId}>
            {onTitle ? (
              // The name itself is where a wrong name is fixed: a pencil says so.
              <button type="button" className="title-btn" onClick={onTitle} aria-label={`${title}. Bấm để đổi tên`}>
                {title}
                <Pencil size={16} aria-hidden="true" />
              </button>
            ) : (
              title
            )}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        {head}
        {children}
      </div>
    </div>
  );
}
