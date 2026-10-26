import { dismissToast, holdToast, useToasts } from "../app/state";

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          onMouseEnter={() => holdToast(t.id, true)}
          onMouseLeave={() => holdToast(t.id, false)}
          onFocus={() => holdToast(t.id, true)}
          onBlur={() => holdToast(t.id, false)}
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              // What had the focus is gone (a note deleted): "Hoàn tác" takes it.
              autoFocus={t.focus}
              onClick={() => {
                holdToast(t.id, false);
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
