// The phone's copy of a person's notes. A change applies here at once, is
// kept on the phone, and waits in an outbox until the server has it; sync
// sends the outbox and takes in what other phones changed. With no signal
// everything still works: the outbox simply waits.
import { LIMITS, type GroupInfo, type Note, type SyncRequest, type SyncResponse } from "../shared/protocol";

export type SyncStatus = "idle" | "syncing" | "offline" | "signedOut";

export interface Snapshot {
  /** Keeps its identity until something changes, so views can memo on it. */
  notes: ReadonlyMap<string, Note>;
  /** Changes made here the server does not have yet. */
  pending: number;
  status: SyncStatus;
  lastSync: number | null;
  /** Had the server's notes at least once: an empty list is really empty. */
  ready: boolean;
  /** The groups this person is in ("Nhắc chung"), as the last sync told. */
  groups: readonly GroupInfo[];
}

export interface Persist {
  load(): Promise<{ notes: Note[]; meta: Map<string, unknown> }>;
  save(notes: Note[], meta: Record<string, unknown>): Promise<void>;
  wipe(): Promise<void>;
  /** Notes gone from this phone with nothing to tell the server: a group's, once this person is out of it. */
  drop(ids: string[]): Promise<void>;
  /** Values that go only if still no newer than given: an outbox entry another window may have renewed. */
  settle(entries: [key: string, upTo: number][]): Promise<void>;
}

/**
 * Each waiting change is kept under a key of its own, not in one list: two
 * windows of the app (the installed one and a tab, on Android) each wrote
 * its whole list over the other's, and a change only one of them held
 * could stay on the phone for ever, never sent.
 */
const OUTBOX = "outbox:";
const outboxKey = (id: string) => `${OUTBOX}${id}`;
const GONE = Number.MAX_SAFE_INTEGER;

export interface Transport {
  sync(req: SyncRequest): Promise<SyncResponse & { rejected: string[] }>;
}

/** Thrown by the transport when the server says signed out. */
export interface Options {
  persist: Persist;
  transport: Transport;
  offset(): number;
  now?(): number;
  isSignedOut(e: unknown): boolean;
  /** A change the server will never take (malformed, or the account is full). */
  onRejected?(ids: string[]): void;
}

export class NotesStore {
  private notes = new Map<string, Note>();
  /** id → the `updated` of the version waiting to be sent. */
  private outbox = new Map<string, number>();
  private rev = 0;
  /** Each group's rev this phone has everything up to. */
  private grev = new Map<string, number>();
  private groups: GroupInfo[] = [];
  private owner: string | null = null;
  private status: SyncStatus = "idle";
  private lastSync: number | null = null;
  private ready = false;
  private snap: Snapshot;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private o: Options) {
    this.snap = this.build();
  }

  async load(): Promise<string | null> {
    const { notes, meta } = await this.o.persist.load();
    // Kept by an older version: one's own, ticked by nobody named, for everyone, watched by nobody.
    this.notes = new Map(
      notes.map((n) => [n.id, { ...n, group: n.group ?? null, by: n.by ?? null, each: n.each ?? false, ticks: n.ticks ?? [], mine: n.mine ?? null, assignee: n.assignee ?? null, watch: n.watch ?? null, watchers: n.watchers ?? [] }]),
    );
    // One list, as kept before: each under its own key from now on.
    const listed = (meta.get("outbox") as [string, number][] | undefined) ?? [];
    this.outbox = new Map(listed);
    for (const [k, v] of meta) {
      if (k.startsWith(OUTBOX) && typeof v === "number") this.outbox.set(k.slice(OUTBOX.length), Math.max(v, this.outbox.get(k.slice(OUTBOX.length)) ?? 0));
    }
    if (listed.length) await this.o.persist.save([], { outbox: undefined, ...Object.fromEntries(listed.map(([id, v]) => [outboxKey(id), v])) });
    this.rev = Number(meta.get("rev") ?? 0);
    this.grev = new Map((meta.get("grev") as [string, number][] | undefined) ?? []);
    // Kept before a group said whether it was muted, or who has notifications on: not muted, and nobody warned about.
    this.groups = ((meta.get("groups") as GroupInfo[] | undefined) ?? []).map((g) => ({ ...g, muted: g.muted ?? false, members: g.members.map((m) => ({ ...m, push: m.push ?? true })) }));
    this.owner = (meta.get("owner") as string | undefined) ?? null;
    this.lastSync = (meta.get("lastSync") as number | undefined) ?? null;
    this.ready = this.lastSync !== null;
    this.emit();
    return this.owner;
  }

  /**
   * Whose notes these are. Another account signing in on this phone gets a
   * clean copy: one person's waiting changes must never go up as another's.
   */
  async claim(owner: string): Promise<void> {
    // No id is no owner: claiming it would wipe this phone's notes for nobody.
    if (typeof owner !== "string" || !owner) throw new Error("no owner to claim for");
    if (this.owner === owner) return;
    if (this.owner !== null || this.notes.size) await this.clear();
    this.owner = owner;
    await this.o.persist.save([], { owner });
  }

  async clear(): Promise<void> {
    await this.o.persist.wipe();
    this.notes = new Map();
    this.outbox = new Map();
    this.rev = 0;
    this.grev = new Map();
    this.groups = [];
    this.owner = null;
    this.lastSync = null;
    this.ready = false;
    this.emit();
  }

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };

  getSnapshot = () => this.snap;

  get(id: string): Note | undefined {
    return this.notes.get(id);
  }

  /** A change made on this phone: kept now, sent when it can be. */
  async put(n: Note): Promise<void> {
    this.notes.set(n.id, n);
    this.outbox.set(n.id, n.updated);
    this.emit();
    await this.o.persist.save([n], { [outboxKey(n.id)]: n.updated });
  }

  /** Sends what waits and takes in the rest. One at a time; a call meanwhile runs once more after. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.round();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async round(): Promise<void> {
    this.setStatus("syncing");
    try {
      // Turns, until nothing waits and nothing more is coming.
      for (let guard = 0; guard < 50; guard++) {
        const sending = [...this.outbox.keys()]
          .slice(0, LIMITS.changesPerSync)
          .map((id) => this.notes.get(id))
          .filter((n): n is Note => !!n);
        const res = await this.o.transport.sync({ since: this.rev, changes: sending, offset: this.o.offset(), groups: Object.fromEntries(this.grev) });
        await this.take(res, sending);
        if (!res.more && this.outbox.size === 0) break;
        if (!res.more && sending.length === 0) break;
      }
      this.lastSync = this.o.now?.() ?? Date.now();
      this.ready = true;
      await this.o.persist.save([], { lastSync: this.lastSync });
      this.setStatus("idle");
    } catch (e) {
      this.setStatus(this.o.isSignedOut(e) ? "signedOut" : "offline");
    }
  }

  private async take(res: SyncResponse & { rejected: string[] }, sent: Note[]) {
    const changed: Note[] = [];
    const groups = res.groups ?? [];
    const answered = new Set<string>();
    const sentAt = new Map(sent.map((n) => [n.id, n.updated]));
    // What left the outbox, and up to which version: settled on the phone only if no newer one waits there.
    const settled: [string, number][] = [];
    const letGo = (id: string, upTo: number) => {
      this.outbox.delete(id);
      settled.push([outboxKey(id), upTo]);
    };
    for (const s of [...res.notes, ...groups.flatMap((g) => g.notes)]) {
      answered.add(s.id);
      const local = this.notes.get(s.id);
      const waiting = this.outbox.get(s.id);
      // The very version sent, back with an earlier time: the server clamps a clock that runs
      // ahead (worker/notes.ts). That is its answer to it, or it would go again, 50 times a sync.
      const acked = waiting !== undefined && sentAt.get(s.id) === waiting;
      // Edited here again since: ours is newer, and still to go.
      if (waiting !== undefined && local && local.updated > s.updated && !acked) continue;
      this.notes.set(s.id, s);
      changed.push(s);
      if (waiting !== undefined && (s.updated >= waiting || acked)) letGo(s.id, waiting);
    }
    // Sent and not answered with a newer version: the server has it (or refused it for good).
    for (const n of sent) {
      if (this.outbox.get(n.id) === n.updated && !answered.has(n.id)) letGo(n.id, n.updated);
    }
    if (res.rejected.length) {
      for (const id of res.rejected) letGo(id, GONE);
      this.o.onRejected?.(res.rejected);
    }
    this.rev = res.rev;
    // Every group this person is in comes in every answer: a group missing is one they left, or
    // were taken out of, or that is gone. Its notes go from this phone too, without a word to the
    // server. (No list at all is a server from before groups, mid-update: nothing is dropped then.)
    const gone: string[] = [];
    if (res.groups !== undefined) {
      const inGroups = new Set(groups.map((g) => g.id));
      this.grev = new Map(groups.map((g) => [g.id, g.rev]));
      this.groups = groups.map(({ id, name, owner, code, muted, members, offset }) => ({ id, name, owner, code, muted, members, offset }));
      for (const n of this.notes.values()) if (n.group !== null && !inGroups.has(n.group)) gone.push(n.id);
      for (const id of gone) {
        this.notes.delete(id);
        if (this.outbox.has(id)) letGo(id, GONE);
      }
    }
    await this.o.persist.save(changed, { rev: this.rev, grev: [...this.grev], groups: this.groups });
    await this.o.persist.settle(settled);
    if (gone.length) await this.o.persist.drop(gone);
    this.emit();
  }

  private setStatus(s: SyncStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit();
  }

  private build(): Snapshot {
    return { notes: new Map(this.notes), pending: this.outbox.size, status: this.status, lastSync: this.lastSync, ready: this.ready, groups: this.groups };
  }

  private emit() {
    this.snap = this.build();
    for (const f of this.listeners) f();
  }
}
