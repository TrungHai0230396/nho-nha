-- Keeping a group from becoming noise, and "Báo cho tôi nếu chưa xong"
-- (worker/cron.ts). Hải asked, 13/10/2026, what stops it from spamming.

-- "Tắt tiếng nhóm này": nothing from this group reaches this member's phones.
-- Its notes still show in the app.
ALTER TABLE group_members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;

-- How many times the group rang its members this hour (ring_win: the hour,
-- as ms / 3600000): past a cap, the rest of the hour is one notification.
ALTER TABLE groups ADD COLUMN ring_win INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN ring_n INTEGER NOT NULL DEFAULT 0;

-- A group's note for one member (their key): only they are rung.
ALTER TABLE notes ADD COLUMN assignee TEXT;
-- Who asked to be told when it is not done in time: {"<user id>": {"on": 1, "t": when
-- they last changed it}}, each person their own entry only, the later change winning,
-- as `ticks` is kept (migrations/0004).
ALTER TABLE notes ADD COLUMN watch TEXT;
-- The Worker's own: when to look whether the occurrence `alert_occ` was left
-- undone, and, for those asleep then, when each is told ({"<user id>": time}).
ALTER TABLE notes ADD COLUMN alert_at INTEGER;
ALTER TABLE notes ADD COLUMN alert_occ INTEGER;
ALTER TABLE notes ADD COLUMN alert_wait TEXT;
CREATE INDEX notes_alert ON notes (alert_at) WHERE alert_at IS NOT NULL;

-- Hours of sleep (0–23, from–to on their clock; quiet_from NULL: none): news
-- about others waits for the morning. Their own reminders still ring on time.
ALTER TABLE users ADD COLUMN quiet_from INTEGER DEFAULT 22;
ALTER TABLE users ADD COLUMN quiet_to INTEGER DEFAULT 6;
