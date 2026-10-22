import { ChevronLeft, Pencil, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

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
    const node = ref.current;
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>("button, [href], input, select, textarea");
    first?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key !== "Tab" || !ref.current) return;
      // Focus stays inside while it is open.
      const all = [...ref.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, select, textarea")];
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
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
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
