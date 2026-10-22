import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One row of a settings list: what it is, how it stands now on the right,
 * and a chevron, the whole row the button. Read down like iPhone's own
 * Settings, which is what Hải's phone has taught him to expect.
 */
export function MenuRow({
  icon,
  label,
  value,
  sub,
  tone,
  page,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  /** How it stands, short: "Đang bật", "2 nhóm". */
  value?: string;
  /** A second line under the label, for what a short value cannot say. */
  sub?: string;
  /** Wants attention: notifications off, say. */
  tone?: "warn";
  /** The page it opens: focus comes back to this row from there. */
  page?: string;
  onClick(): void;
}) {
  return (
    <button type="button" className="menu-row" onClick={onClick} data-page={page}>
      {icon && (
        <span className="menu-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="menu-label">
        {label}
        {sub && <small>{sub}</small>}
      </span>
      {value && <span className={`menu-value${tone ? ` ${tone}` : ""}`}>{value}</span>}
      <ChevronRight size={18} className="menu-chevron" aria-hidden="true" />
    </button>
  );
}

/** On or off, as a switch: a button with role="switch", the whole of it 44px tall to tap. */
export function Switch({ on, label, busy, onChange }: { on: boolean; label: string; busy?: boolean; onChange(on: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" disabled={busy} onClick={() => onChange(!on)}>
      <span className="knob" aria-hidden="true" />
    </button>
  );
}
