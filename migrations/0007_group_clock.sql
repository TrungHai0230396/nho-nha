-- A group's clock was whoever synced last (a member abroad moved everyone's
-- times). From now on it is set once, by its maker, and syncs leave it:
-- start each group on its owner's clock.
UPDATE groups SET tz_offset = COALESCE((SELECT tz_offset FROM users WHERE users.id = groups.owner_id), 420);
