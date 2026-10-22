import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isIOS } from "../lib/pwa";
import { Dictation, voiceSupported, type DictationState, type VoiceProblem } from "../lib/voice";

const IDLE: DictationState = { listening: false, recording: false, heard: "", final: null, problem: null };
const noSubscribe = () => () => {};
const idle = () => IDLE;

/** What went wrong and what to do, on the phone in hand; the keyboard's own microphone always the way round. */
export function voiceProblemText(problem: VoiceProblem): string {
  switch (problem) {
    case "denied":
      return isIOS()
        ? "Micro đang bị chặn. Vào Cài đặt của iPhone → Safari → Micrô → Cho phép, rồi mở lại app. Hoặc bấm phím micro trên bàn phím để nói."
        : "Micro đang bị chặn. Bấm biểu tượng bên trái thanh địa chỉ → Quyền → Micrô → Cho phép. Hoặc bấm phím micro trên bàn phím để nói.";
    case "nomic":
      return "Máy không mở được micro, có thể app khác đang dùng. Tắt app đó rồi bấm micro lại, hoặc gõ.";
    case "silence":
      return "Chưa nghe thấy gì. Bấm micro, đợi chữ “Mời nói” rồi nói gần máy.";
    case "network":
      return "Nói cần có mạng. Lúc mất mạng thì gõ bằng bàn phím.";
    case "error":
      return "Chưa nghe được. Bấm micro nói lại, hoặc gõ.";
  }
}

/**
 * The composer's microphone. `toggle` must be called from the tap itself:
 * iPhone only opens the microphone inside a user gesture.
 */
export function useDictation(onFinal: (text: string) => void) {
  const [session, setSession] = useState<Dictation | null>(null);
  const state = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getState ?? idle);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  useEffect(() => {
    if (state.final) cb.current(state.final);
  }, [state.final]);
  useEffect(() => () => session?.cancel(), [session]);

  return {
    supported: voiceSupported(),
    listening: session !== null && state.listening,
    recording: session !== null && state.recording,
    heard: state.heard,
    problem: state.problem,
    toggle() {
      if (session && state.listening) return session.stop();
      setSession(new Dictation());
    },
  };
}
