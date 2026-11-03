// The Worker's own daily cap on D1 writes. The Workers Free plan had one:
// past 100,000 rows written in a UTC day, for the whole account, every write
// failed until 00:00 UTC while reads went on. Workers Paid has none: past the
// 50 million rows a month it includes, it bills $1 a million, so a flood
// (guests cost nothing to make, and one 200-change sync writes about 1,000
// rows) would be paid for instead of stopped. Hải, moving the account to Paid
// (3/11/2026): it must still stop itself as on the free plan.
//
// Every statement goes through here (worker/d1.ts is the one way into D1).
// Once the day's count has reached the budget, a statement that writes
// throws WritesSpent until the next UTC day: the router answers 503, the
// reminders' clock rests. Reads go on.
import { DAY, toWall, VN_OFFSET } from "../src/shared/wall";
import type { Row, Sql, Stmt } from "./sql";

/**
 * Rows written a UTC day, as Cloudflare counts them (index entries too).
 * About 70 times the busiest real day (296 rows, 27/10 to 3/11/2026), a fifth
 * of the Free plan's 100,000 for the whole account, and far inside Paid's 50
 * million a month (31 such days are 620,000).
 *
 * A soft cap: requests already past the check when it is reached still
 * finish, so a day can end a little over.
 */
export const DAILY_WRITE_BUDGET = 20_000;
/** How long an isolate takes the budget as spent without reading the count again: a flood reads it once a minute. */
export const SPENT_FOR_MS = 60_000;

/** Thrown in place of a write once the day's budget is spent. */
export class WritesSpent extends Error {
  constructor() {
    super("today's D1 write budget is spent");
    this.name = "WritesSpent";
  }
}

/** Days since 1970-01-01 UTC: the day Cloudflare counts a write in. */
export const utcDay = (at: number) => Math.floor(at / DAY);
/** The next 00:00 UTC, 07:00 in Vietnam: when the count starts again. */
export const nextUtcDay = (at: number) => (utcDay(at) + 1) * DAY;

/** What the app and the shortcut show. Before 07:00 in Vietnam (00:00 UTC), the count starts again this morning, not tomorrow. */
export function writesSpentMessage(now: number): string {
  return toWall(now, VN_OFFSET).h < VN_OFFSET / 60
    ? "Máy chủ đã hết lượt ghi, 7 giờ sáng nay dùng lại được."
    : "Hôm nay máy chủ đã hết lượt ghi, 7 giờ sáng mai dùng lại được.";
}

/** Anything but a SELECT is taken as a write: INSERT, UPDATE, DELETE, REPLACE, and whatever else may come. */
export const writes = (sql: string) => !/^\s*SELECT\b/i.test(sql);

/** A database that says how many rows each batch wrote: D1 (worker/d1.ts), node:sqlite in tests. */
export interface CountedSql {
  batch(stmts: Stmt[]): Promise<{ rows: Row[][]; written: number }>;
}

/** Rows a D1 batch wrote: `meta.rows_written` (index entries included), else `meta.changes`. */
export function rowsWritten(results: { meta?: { rows_written?: number; changes?: number } }[]): number {
  return results.reduce((sum, r) => sum + (Number(r.meta?.rows_written ?? r.meta?.changes ?? 0) || 0), 0);
}

/** An isolate's memory that the budget is spent, shared by every request it serves. */
export interface SpentFlag {
  /** Until when writes are refused without reading the count: a minute, never past the next 00:00 UTC. */
  until: number;
}
export const spentFlag = (): SpentFlag => ({ until: 0 });

/** One request's (or one alarm's) way into the database, metered. */
export interface MeteredSql extends Sql {
  /** Rows written through it and not yet added to the day's count. */
  readonly written: number;
  /** Adds them to the day's count, in one statement; nothing when none. Once, when the request is done. */
  flush(): Promise<void>;
}

const COUNT_SQL = "SELECT n FROM daily_writes WHERE day = ?1";
const ADD_SQL = "INSERT INTO daily_writes (day, n) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET n = n + excluded.n";

/**
 * The count is read once, at the request's first write, and the request
 * counts in that UTC day; each write after it is checked against what was
 * read plus what the request itself has written since. The count itself is
 * written by flush, outside the check: it must record the rows that went
 * past the budget too, and a request refused wrote none, so it adds nothing.
 */
export function metered(db: CountedSql, flag: SpentFlag, now: () => number): MeteredSql {
  let day = -1;
  // A promise, so that two writes racing in one request still share the one read.
  let read: Promise<number> | null = null;
  let flushed = 0;
  let written = 0;

  async function check(): Promise<void> {
    const t = now();
    if (t < flag.until) throw new WritesSpent();
    if (!read) {
      day = utcDay(t);
      read = db.batch([{ sql: COUNT_SQL, params: [day] }]).then(({ rows: [found = []] }) => Number(found[0]?.n ?? 0));
    }
    if ((await read) + flushed + written >= DAILY_WRITE_BUDGET) {
      // Never past midnight UTC, when the next day's count begins at zero.
      flag.until = Math.min(t + SPENT_FOR_MS, (day + 1) * DAY);
      throw new WritesSpent();
    }
  }

  return {
    get written() {
      return written;
    },
    async batch(stmts) {
      // A SELECT writes nothing: whatever D1 says of it is not counted, so only a checked write is ever flushed.
      if (!stmts.some((s) => writes(s.sql))) return (await db.batch(stmts)).rows;
      await check();
      const r = await db.batch(stmts);
      written += r.written;
      return r.rows;
    },
    async flush() {
      if (!written) return;
      // The upsert writes a row of its own, which Cloudflare counts as well.
      const n = written + 1;
      written = 0;
      flushed += n;
      await db.batch([{ sql: ADD_SQL, params: [day, n] }]);
    },
  };
}
