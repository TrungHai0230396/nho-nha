// The phone's own copy, in IndexedDB: notes one by one (so saving one does
// not rewrite them all), and a few values beside them.
import type { Note } from "../shared/protocol";

const NAME = "nhonha";
const VERSION = 1;

let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => {
      const db = req.result;
      // iOS drops a connection now and then, and another tab's upgrade asks it to close: the next
      // call opens a new one. Kept for ever, every save failed and "Chờ mạng" never went away.
      db.onclose = () => void (opened = null);
      db.onversionchange = () => {
        db.close();
        opened = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opened = null;
      reject(req.error);
    };
    // Another tab holds the old version open: say so instead of hanging, and try again next time.
    req.onblocked = () => {
      opened = null;
      reject(new Error("database blocked"));
    };
  });
  return opened;
}

/** `f` on the open database, once more on a fresh one if the connection died under it. */
async function withDb<T>(f: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    return await f(await open());
  } catch (e) {
    if (!(e instanceof DOMException) || !["InvalidStateError", "UnknownError", "TransactionInactiveError"].includes(e.name)) throw e;
    opened = null;
    return f(await open());
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
}

export function loadAll(): Promise<{ notes: Note[]; meta: Map<string, unknown> }> {
  return withDb(async (db) => {
    const tx = db.transaction(["notes", "meta"], "readonly");
    const notes = new Promise<Note[]>((resolve, reject) => {
      const r = tx.objectStore("notes").getAll();
      r.onsuccess = () => resolve(r.result as Note[]);
      r.onerror = () => reject(r.error);
    });
    const meta = new Promise<Map<string, unknown>>((resolve, reject) => {
      const out = new Map<string, unknown>();
      const r = tx.objectStore("meta").openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return resolve(out);
        out.set(String(c.key), c.value);
        c.continue();
      };
      r.onerror = () => reject(r.error);
    });
    const [n, m] = await Promise.all([notes, meta, done(tx)]);
    return { notes: n, meta: m };
  });
}

/** Notes and values written together, all or nothing. */
export function save(notes: Note[], meta: Record<string, unknown>): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(["notes", "meta"], "readwrite");
    const ns = tx.objectStore("notes");
    for (const n of notes) ns.put(n);
    const ms = tx.objectStore("meta");
    for (const [k, v] of Object.entries(meta)) ms.put(v, k);
    await done(tx);
  });
}

/**
 * Values that may go only if they are still no newer than `upTo`: a change
 * the server has, under its own key ("outbox:<id>"), which another window
 * of the app may have made newer since (lib/store).
 */
export function settle(entries: [key: string, upTo: number][]): Promise<void> {
  if (!entries.length) return Promise.resolve();
  return withDb(async (db) => {
    const tx = db.transaction(["meta"], "readwrite");
    const ms = tx.objectStore("meta");
    for (const [k, upTo] of entries) {
      const r = ms.get(k);
      r.onsuccess = () => {
        if (typeof r.result === "number" && r.result <= upTo) ms.delete(k);
      };
    }
    await done(tx);
  });
}

/** Notes gone from this phone with nothing to tell the server: a group's, once this person is out of it. */
export function drop(ids: string[]): Promise<void> {
  if (!ids.length) return Promise.resolve();
  return withDb(async (db) => {
    const tx = db.transaction(["notes"], "readwrite");
    const ns = tx.objectStore("notes");
    for (const id of ids) ns.delete(id);
    await done(tx);
  });
}

export function wipe(): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(["notes", "meta"], "readwrite");
    tx.objectStore("notes").clear();
    tx.objectStore("meta").clear();
    await done(tx);
  });
}
