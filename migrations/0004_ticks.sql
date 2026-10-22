-- "Mỗi người tự bấm Xong": a group's note that each member ticks off for
-- themselves (7h đi nhậu: whoever is there taps Xong). `each` is the note's
-- mode, synced like any field. `ticks` is the server's own record, never
-- taken whole from a phone: {"<user id>": {"at": time ticked or null, "t":
-- when that person last changed it}}, each person able to change only their
-- own, the later change winning, so five people ticking at once lose nothing.
ALTER TABLE notes ADD COLUMN each INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN ticks TEXT;
-- Whose name by_name is: the member's key, so a phone can show its own nickname for them.
ALTER TABLE notes ADD COLUMN by_key TEXT;
