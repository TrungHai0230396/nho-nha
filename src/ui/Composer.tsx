import { ArrowUp, Bell, BellOff, ChevronDown, Mic, Square, UserCheck, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { store, syncSoon, toast } from "../app/state";
import { newId } from "../lib/ids";
import { called, useNicknames } from "../lib/nicknames";
import { newNote, plainNote, remove } from "../lib/notes";
import { whenLabel } from "../shared/describe";
import { parse, partsOf } from "../shared/parse";
import type { GroupInfo } from "../shared/protocol";
import { normalizeSpoken } from "../shared/spoken";
import { Understood, unmark } from "./Chips";
import { useDictation, voiceProblemText } from "./useDictation";

/** What was there before the microphone, then what was said. */
const joined = (before: string, said: string) => (before.trim() ? `${before.trimEnd()} ${said}` : said);

/**
 * The one thing on screen that matters: type (or say), press send. What
 * the app understood shows above the box while typing, so a wrong reading
 * is seen (and undone with ×) before it is saved, not after a reminder
 * misfires. Said, it is not sent by itself: the words heard go in the box
 * to be read, and fixed, first.
 */
export function Composer({ now, offset, groups }: { now: number; offset: number; groups: readonly GroupInfo[] }) {
  const [text, setText] = useState("");
  // Where the next note goes: one's own (null), or a group's ("Nhắc chung"). Back to one's own after
  // each note: a private one must never go to the family because the last one did.
  const [target, setTarget] = useState<string | null>(null);
  const into = target ? groups.find((g) => g.id === target) : undefined;
  // A group's note each member ticks off for themselves (7h đi nhậu: whoever is there taps Xong; a
  // repeating one, each time: "9h, 18h hằng ngày uống thuốc").
  const [each, setEach] = useState(false);
  // For one member only (their key): only their phone rings ("21h bố uống thuốc").
  const [assignee, setAssignee] = useState<string | null>(null);
  // And whether to be told if they have not tapped Xong half an hour on: asked for here, by
  // whoever gives it to someone, since that is what giving it to someone is usually for.
  const [watchMe, setWatchMe] = useState(true);
  const nicks = useNicknames();
  const forWho = into && assignee ? into.members.find((m) => m.key === assignee) : undefined;
  const nextTarget = () => {
    const i = groups.findIndex((g) => g.id === target);
    setTarget(i + 1 < groups.length ? groups[i + 1]!.id : null);
    // A member is a member of one group: the next group's people are others.
    setAssignee(null);
  };
  const [off, setOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLElement>(null);
  const parsed = useMemo(() => parse(text, now, offset), [text, now, offset]);
  // "mai 9h và 15h họp": a reminder for each time, each line saying its own (Hải, 14/10/2026).
  const parts = useMemo(() => partsOf(parsed, now, offset), [parsed, now, offset]);
  // What the box held when the microphone started: the words said go after it.
  const before = useRef("");
  const voice = useDictation((said) => {
    setText(joined(before.current, said));
    box.current?.focus();
  });

  // The words show up in the box as they are heard, and with them what the app understood.
  useEffect(() => {
    if (voice.listening && voice.heard) setText(joined(before.current, normalizeSpoken(voice.heard)));
  }, [voice.listening, voice.heard]);
  useEffect(() => {
    if (voice.problem) toast(voiceProblemText(voice.problem));
  }, [voice.problem]);

  const listen = () => {
    if (!voice.supported) {
      // The keyboard's microphone works where the page's does not (some home-screen apps).
      box.current?.focus();
      toast("Ở đây app chưa nghe được. Bấm phím micro trên bàn phím để nói.");
      return;
    }
    if (!voice.listening) {
      before.current = text;
      setError(null);
    }
    voice.toggle();
  };

  // The list and the toasts sit above it: tell them how tall it is.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--composer", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Grows with what is typed, up to a few lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    // A scrollbar only once it stops growing.
    el.style.overflowY = el.scrollHeight > 140 ? "auto" : "hidden";
  }, [text]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const line = text.trim();
    if (!line) {
      setError("Gõ gì đó trước đã.");
      box.current?.focus();
      return;
    }
    const at = Date.now();
    // Read again as sent (the clock moved on since the preview): one line, or one per time.
    const split = off ? null : partsOf(parse(line, at, offset), at, offset);
    const notes = (split ? split.map((x) => x.text) : [line]).map((l) => {
      const made = off ? plainNote(newId(), l, at, offset) : newNote(newId(), l, at, offset);
      return into
        ? {
            ...made,
            group: into.id,
            each: !forWho && each,
            assignee: forWho?.key ?? null,
            watch: forWho && !forWho.me && watchMe ? { on: true, t: at } : null,
          }
        : made;
    });
    setText("");
    setOff(false);
    setTarget(null);
    setEach(false);
    setAssignee(null);
    setWatchMe(true);
    setError(null);
    box.current?.focus();
    for (const n of notes) await store.put(n);
    syncSoon();
    // Nothing to say when it went in as typed: it is in the list, and the time was read out above
    // the box before sending. "Đã lưu · Sửa" after every note was noise (Hải, 13/10/2026). A time
    // already gone is worth a word, being most likely mistyped: "Sửa" takes the line back into the box.
    const late = notes.find((n) => n.due !== null && n.due <= at);
    if (late) {
      toast(`Giờ đó (${whenLabel(late.due!, at, offset)}) đã qua.`, {
        label: "Sửa",
        run: () => {
          void Promise.all(notes.map((n) => store.put(remove(n, Math.max(Date.now(), n.updated + 1))))).then(syncSoon);
          setText((cur) => (cur.trim() ? `${line} ${cur}` : line));
          setOff(off);
          box.current?.focus();
        },
      });
    }
  };

  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter is a new line. Not while an IME is still composing (Telex on a computer).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <footer className="composer" ref={wrap}>
      <div>
        {voice.listening && (
          <p className="listening" role="status">
            <span className="rec" aria-hidden="true" />
            {voice.recording ? "Mời nói… kể nhiều món thì ngừng một chút giữa các món." : "Đợi chút…"}
          </p>
        )}
        {text.trim() && <Understood text={text} parsed={parsed} parts={parts} now={now} offset={offset} off={off} onToggle={() => setOff(!off)} onUnmark={(s, e) => setText((t) => unmark(t, s, e))} />}
        {groups.length > 0 && text.trim() && (
          <div className="target-row">
            <button type="button" className={`chip${into ? " shared" : " tag"}`} onClick={nextTarget} aria-label={into ? `Nhắc chung với nhóm ${into.name}. Bấm để đổi` : "Chỉ mình tôi. Bấm để nhắc chung với một nhóm"}>
              <Users size={14} aria-hidden="true" />
              {into ? `Nhắc chung · ${into.name}` : "Chỉ mình tôi"}
            </button>
            {into && (
              <label className={`chip select-chip${forWho ? " shared" : " tag"}`}>
                <Bell size={14} aria-hidden="true" />
                <select aria-label="Nhắc ai" value={forWho?.key ?? ""} onChange={(e) => setAssignee(e.target.value || null)}>
                  <option value="">Nhắc cả nhóm</option>
                  {into.members.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.me ? "Chỉ nhắc tôi" : `Chỉ nhắc ${called(m, nicks)}`}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>
            )}
            {into && !forWho && (
              <button type="button" className={`chip${each ? " shared" : " tag"}`} onClick={() => setEach(!each)} aria-pressed={each}>
                <UserCheck size={14} aria-hidden="true" />
                {each ? "Mỗi người tự bấm Xong" : "Một người xong là xong"}
              </button>
            )}
            {forWho && !forWho.me && (
              <button type="button" className={`chip${watchMe ? " shared" : " tag"}`} onClick={() => setWatchMe(!watchMe)} aria-pressed={watchMe}>
                {watchMe ? <Bell size={14} aria-hidden="true" /> : <BellOff size={14} aria-hidden="true" />}
                {watchMe ? `Báo tôi nếu ${called(forWho, nicks)} chưa xong` : "Không cần báo tôi"}
              </button>
            )}
            {/* Said before it is sent: a reminder for someone with notifications off reaches nobody. */}
            {forWho && !forWho.me && !forWho.push && <p className="target-warn">{called(forWho, nicks)} chưa bật thông báo nên sẽ không được nhắc.</p>}
          </div>
        )}
        <form className="write" onSubmit={submit} noValidate>
          <label htmlFor="compose" className="sr-only">
            Ghi chú mới
          </label>
          <textarea
            id="compose"
            ref={box}
            rows={1}
            value={text}
            enterKeyHint="send"
            autoComplete="off"
            // No sample sentence here (Hải, 13/10/2026): the examples live in the empty list's "Bấm thử một câu" and the ? sheet.
            placeholder="Cần nhớ gì?"
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
              if (!e.target.value.trim()) setOff(false);
            }}
            onKeyDown={key}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "compose-error" : undefined}
          />
          <button type="button" className={`mic${voice.listening ? " on" : ""}`} onClick={listen} aria-label={voice.listening ? "Nói xong" : "Nói để ghi"} aria-pressed={voice.listening}>
            {voice.listening ? <Square size={18} fill="currentColor" aria-hidden="true" /> : <Mic size={22} aria-hidden="true" />}
          </button>
          <button className="send" type="submit" aria-label="Lưu ghi chú">
            <ArrowUp size={22} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </form>
        {error && (
          <p id="compose-error" className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </footer>
  );
}
