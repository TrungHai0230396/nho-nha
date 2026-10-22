-- "Nhắc chung": groups whose notes every member sees, changes and is
-- reminded of (worker/groups.ts). A group owns its notes as a person owns
-- theirs: they are rows of `notes` with the group's id where a user id
-- would be ('g_' and 22 characters, never the length of a user id), synced
-- with the group's own rev. So sync, planning and ringing stay one code path.
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  -- Bumped by every write to the group's notes: the group's sync cursor.
  rev INTEGER NOT NULL DEFAULT 0,
  -- Minutes east of UTC of whoever last wrote a note here: repeats are reckoned by it.
  tz_offset INTEGER NOT NULL DEFAULT 420,
  -- The invite link is an HMAC of the id and this, never stored: a new link is this plus one.
  invite_v INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX groups_owner ON groups (owner_id);

-- Who is in a group, under the name the others see. `key`: how the owner
-- names a member to remove, so no account's id leaves the server.
CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user ON group_members (user_id);

-- Who last ticked a note off, and when: shown on a group's notes ("Xong bởi
-- Lan"). The name is stamped by the server from the writer's membership,
-- never taken from the phone.
ALTER TABLE notes ADD COLUMN by_name TEXT;
ALTER TABLE notes ADD COLUMN by_at INTEGER;
