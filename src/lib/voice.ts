import { commaAtPauses, normalizeSpoken } from "../shared/spoken";

// Saying a note instead of typing it, through the Web Speech API, with
// timings learned on Hải's phones. It keeps listening across pauses, since
// a list said aloud has one between each thing, and turns those pauses into
// the commas the parser needs.

// Not in TypeScript's DOM library yet: the slice of it used here.
interface Alternative {
  transcript: string;
}
interface Result {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: Alternative;
}
interface ResultEvent {
  resultIndex: number;
  results: { readonly length: number; [index: number]: Result };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = globalThis as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Chrome on Android has it; iPhone in Safari, but not in every home-screen
 * app. Where it is missing the keyboard's own microphone still works, so
 * the button says so rather than going away.
 */
export function voiceSupported(): boolean {
  return recognitionCtor() !== null;
}

export type VoiceProblem = "denied" | "nomic" | "silence" | "network" | "error";

export interface DictationState {
  listening: boolean;
  /** The microphone is taking sound. Before this, words are lost: the screen says "Mời nói" only from here. */
  recording: boolean;
  /** What has been heard so far, while the person is still talking. */
  heard: string;
  /** The whole of it once done, in digits and with its commas. */
  final: string | null;
  problem: VoiceProblem | null;
}

/** No word from the recognizer by then: it is not coming. Permission prompts take a while. */
export const START_TIMEOUT_MS = 12_000;
/** A note, or a list of a dozen things; not a speech. */
export const MAX_LISTEN_MS = 45_000;
/** After a tap on stop, how long its last words may take to arrive. */
export const STOP_GRACE_MS = 1_500;
/** Words heard, then quiet this long: done. iPhone's recognizer does not end on a pause by itself. */
export const PAUSE_MS = 2_500;
/** Started, and not a word after this long: nothing is coming. */
export const NO_SPEECH_MS = 8_000;
/** Quiet this long between words: where a list said aloud has its comma. */
export const COMMA_GAP_MS = 900;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// A second recognizer silently kills the first, which then looks as if it is still listening.
let active: Dictation | null = null;

/**
 * One go at listening. Create it inside the tap handler: iPhone only lets
 * the microphone start from a user gesture. It never waits on the
 * recognizer to end: some go quiet without a word (seen on iPhone
 * home-screen apps), and a stop button that cannot stop is worse than a
 * microphone that did not hear.
 */
export class Dictation {
  #state: DictationState = { listening: true, recording: false, heard: "", final: null, problem: null };
  #listeners = new Set<() => void>();
  #rec: Recognition | null = null;
  #timers: ReturnType<typeof setTimeout>[] = [];
  #pause: ReturnType<typeof setTimeout> | undefined;
  #heardAny = false;
  #done = false;
  /** Word counts at which a pause came, for commaAtPauses. */
  #pauses: number[] = [];
  #lastAt = 0;
  #lastWords = 0;

  constructor() {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      this.#state = { ...this.#state, listening: false, problem: "error" };
      this.#done = true;
      return;
    }
    active?.cancel();
    active = this;
    const rec = new Ctor();
    rec.lang = "vi-VN";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    // Across pauses: Chrome would end at the first one, between "cá" and "đường".
    rec.continuous = true;
    let alive = false;
    rec.onstart = () => {
      alive = true;
      if (!this.#done) this.#set({ recording: true });
      this.#later(NO_SPEECH_MS, () => {
        if (!this.#heardAny) this.stop();
      });
    };
    rec.onresult = (e) => {
      alive = true;
      this.#heardAny = true;
      // All of it each time: the parts already settled (Chrome settles one at each pause,
      // which is a comma already) and the words still forming.
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i]?.[0]?.transcript.trim();
        if (t) parts.push(t);
      }
      const heard = parts.join(", ");
      const n = words(heard);
      const now = Date.now();
      if (this.#lastWords > 0 && n > this.#lastWords && now - this.#lastAt >= COMMA_GAP_MS) this.#pauses.push(this.#lastWords);
      if (n !== this.#lastWords) {
        this.#lastAt = now;
        this.#lastWords = n;
      }
      if (this.#done) return;
      this.#set({ recording: true, heard });
      clearTimeout(this.#pause);
      this.#pause = setTimeout(() => this.stop(), PAUSE_MS);
    };
    // Aborted from outside (another app took the microphone): over, and no fault of anyone's.
    rec.onerror = (e) => this.#settle(e.error === "aborted" ? (this.#soFar() ?? {}) : { problem: problemOf(e.error) });
    // Ended with words heard: those are the answer, not silence.
    rec.onend = () => this.#settle(this.#soFar() ?? { problem: "silence" });
    this.#rec = rec;
    try {
      rec.start();
    } catch {
      this.#settle({ problem: "error" });
      return;
    }
    this.#later(START_TIMEOUT_MS, () => {
      if (!alive) this.#settle({ problem: "error" });
    });
    this.#later(MAX_LISTEN_MS, () => this.stop());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): DictationState => this.#state;

  /** The stop button: the screen stops listening at once; the last words still count if they come soon. */
  stop() {
    if (this.#done || !this.#state.listening) return;
    this.#set({ listening: false, recording: false });
    try {
      this.#rec?.stop();
    } catch {
      // Already stopped: the grace timer settles it all the same.
    }
    this.#later(STOP_GRACE_MS, () => this.#settle(this.#soFar() ?? { problem: "silence" }));
  }

  /** Stop and throw away what was heard. */
  cancel() {
    if (this.#done) return;
    this.#done = true;
    this.#release();
    if (this.#state.listening) this.#set({ listening: false, recording: false });
  }

  #soFar(): Partial<DictationState> | null {
    const heard = this.#state.heard.trim();
    return heard ? { final: normalizeSpoken(commaAtPauses(heard, this.#pauses)), heard } : null;
  }

  #settle(patch: Partial<DictationState>) {
    if (this.#done) return;
    this.#done = true;
    this.#release();
    this.#set({ ...patch, listening: false, recording: false });
  }

  #release() {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers = [];
    clearTimeout(this.#pause);
    const rec = this.#rec;
    this.#rec = null;
    if (active === this) active = null;
    if (!rec) return;
    rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
    try {
      rec.abort();
    } catch {
      // Nothing left to abort.
    }
  }

  #later(ms: number, fn: () => void) {
    this.#timers.push(setTimeout(fn, ms));
  }

  #set(patch: Partial<DictationState>) {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }
}

function problemOf(error: string): VoiceProblem {
  if (error === "not-allowed" || error === "service-not-allowed") return "denied";
  if (error === "audio-capture") return "nomic";
  if (error === "no-speech") return "silence";
  if (error === "network") return "network";
  return "error";
}
