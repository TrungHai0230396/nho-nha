import type { Row, Sql } from "./sql";

export function d1Sql(db: D1Database): Sql {
  return {
    async batch(stmts) {
      // D1 runs a batch as one transaction; a failure rolls every statement back.
      const results = await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params)));
      return results.map((r) => (r.results ?? []) as Row[]);
    },
  };
}
