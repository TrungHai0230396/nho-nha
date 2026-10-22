-- Counting installs (worker/devices.ts, scripts/dem-may.sh). Hải asked on
-- 15/10/2026 how many people have installed the app, which a phone never
-- tells a server by itself.
--
-- One row a device: a random id the app keeps for counting alone (never the
-- one push subscriptions carry), and no user id, address or user agent, so
-- no row leads to an account. `standalone`: seen running as the installed
-- app (home screen, Dock, a window of its own) at least once. `first_seen`,
-- `last_seen`: the day (ms at its start, Vietnam time), never the moment,
-- which could be matched to a sign-in. Forgotten 90 days after `last_seen`.
--
-- No index on last_seen, on purpose: every daily report would write the
-- index as well as the row, and D1's free plan counts rows written for the
-- whole account. Only the 03:00 sweep and scripts/dem-may.sh read by it.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  standalone INTEGER NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
