export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

export interface Stmt {
  sql: string;
  params: SqlValue[];
}

/**
 * The one database operation the Worker needs: run statements in order, as
 * a single transaction, and hand back each statement's rows. Kept this
 * narrow so the code runs unchanged on D1 and on node:sqlite in tests.
 */
export interface Sql {
  batch(stmts: Stmt[]): Promise<Row[][]>;
}

/**
 * One person's way into the database, and the only one a signed-in
 * request's handlers get. In every statement ?1 is their user id, filled in
 * here; a statement's own parameters start at ?2. `user` sets it apart from
 * a plain Sql, so the type checker refuses a handler the whole database.
 *
 * A statement that never names ?1 is refused before it runs: it would read
 * or change everyone's notes. (Prisma once dropped a `where` on an undefined
 * user id without a word, in another of Hải's apps; here that shape cannot
 * even be written.)
 */
export interface UserSql {
  readonly user: string;
  batch(stmts: Stmt[]): Promise<Row[][]>;
}

/** ?1 and not ?10, ?11…: the user's id. */
const USER_PARAM = /\?1(?!\d)/;

export function forUser(sql: Sql, user: string): UserSql {
  if (typeof user !== "string" || !user) throw new Error("no user");
  return {
    user,
    batch(stmts) {
      for (const s of stmts) if (!USER_PARAM.test(s.sql)) return Promise.reject(new Error(`statement not bound to a user: ${s.sql.trim().slice(0, 80)}`));
      return sql.batch(stmts.map((s) => ({ sql: s.sql, params: [user, ...s.params] })));
    },
  };
}
