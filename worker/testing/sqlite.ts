// Test double for D1: the same SQLite dialect through node:sqlite, with the
// real migrations applied, so SQL mistakes show up in `pnpm test`, not in prod.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Row, Sql } from "../sql";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

export function memorySql(): Sql & { db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  return {
    db,
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => run(db, s.sql, s.params));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

// Node 22's node:sqlite fails to bind numbered parameters (?1, ?2); D1 and
// newer Node take them. Here they become named ones, which every version binds.
function run(db: DatabaseSync, sql: string, params: readonly unknown[]): Row[] {
  if (!/\?\d/.test(sql)) return db.prepare(sql).all(...(params as never[])) as Row[];
  const named = Object.fromEntries(params.map((v, i) => [`p${i + 1}`, v]));
  return db.prepare(sql.replace(/\?(\d+)/g, ":p$1")).all(named as never) as Row[];
}
