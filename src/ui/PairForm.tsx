import { KeyRound } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { isStandalone } from "../lib/pwa";
import type { Me } from "../shared/protocol";

/**
 * The 8-character code from a signed-in device's Settings. For a guest it
 * also moves what they wrote here into that account, so it says so.
 */
export function PairForm({ onPaired, guestNotes = false }: { onPaired(me: Me): void; guestNotes?: boolean }) {
  const id = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.replace(/[\s-]/g, "").length !== 8) return setError("Mã ghép có 8 ký tự.");
    setBusy(true);
    setError(null);
    try {
      await api.pairRedeem(code.trim(), isStandalone());
      onPaired(await api.me());
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "Thử sai nhiều lần quá. Đợi 10 phút rồi thử lại."
          : err instanceof ApiError
            ? "Mã không đúng hoặc đã hết hạn. Lấy mã mới ở máy kia."
            : "Cần có mạng để ghép máy.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <label htmlFor={id} className="small">
        Mã ghép (8 ký tự, lấy ở Cài đặt của máy đã đăng nhập Google)
        {guestNotes && ". Ghi chú trên máy này sẽ gộp vào tài khoản đó: chỉ nhập mã lấy từ máy của chính bạn."}
      </label>
      <div className="row">
        <input
          id={id}
          className="grow pair-input"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          spellCheck={false}
          value={code}
          onChange={(e) => (setCode(e.target.value), setError(null))}
          placeholder="K7QF 29XM"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button className="btn teal" type="submit" disabled={busy}>
          <KeyRound size={18} aria-hidden="true" />
          Ghép
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
