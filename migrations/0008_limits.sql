-- One account must not spend the free plan's D1 quota for everyone
-- (worker/notes.ts, worker/cron.ts): what a person changes in a day, and
-- how many times their own reminders ring in a day. A day is UTC's, as
-- Cloudflare counts its quotas.
ALTER TABLE users ADD COLUMN chg_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN chg_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN ring_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN ring_n INTEGER NOT NULL DEFAULT 0;
-- Counting the notes still kept reads those only, not every deleted one too.
CREATE INDEX notes_open ON notes (user_id) WHERE deleted = 0;
