import { metered, rowsWritten, spentFlag, type CountedSql, type MeteredSql } from "./budget";
import type { Row } from "./sql";

/** This isolate's memory that the day's writes are spent (worker/budget.ts), for every request it serves. */
const spent = spentFlag();

/**
 * The Worker's one way into D1, a new one for each request or alarm: every
 * statement goes through the day's write budget (worker/budget.ts). Call
 * flush() once the request is done, so what it wrote is counted.
 */
export function d1Sql(db: D1Database): MeteredSql {
  return metered(counted(db), spent, Date.now);
}

function counted(db: D1Database): CountedSql {
  return {
    async batch(stmts) {
      // D1 runs a batch as one transaction; a failure rolls every statement back.
      const results = await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params)));
      return { rows: results.map((r) => (r.results ?? []) as Row[]), written: rowsWritten(results) };
    },
  };
}
