-- The Worker's own daily cap on D1 writes (worker/budget.ts), for Workers
-- Paid, which bills past its included rows instead of refusing them as the
-- free plan did. A row a UTC day: the rows written that day, as Cloudflare
-- counts them, added once at the end of each request that wrote. Past
-- DAILY_WRITE_BUDGET nothing more is written until the next day. One small
-- row a day, kept: it is also the record of what each day wrote.
CREATE TABLE daily_writes (
  -- Days since 1970-01-01, UTC.
  day INTEGER PRIMARY KEY,
  n INTEGER NOT NULL
);
