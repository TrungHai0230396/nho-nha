-- Nhớ Nha: notes with reminders, for anyone who signs in with Google.

-- A person. Found by Google's account id ('sub'), which never changes
-- hands; the email is only shown to its owner (and checked for admins).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL,
  -- Bumped by every write to this person's notes: the sync cursor.
  rev INTEGER NOT NULL DEFAULT 0,
  -- Minutes east of UTC, as their phone last said: repeats and the morning list are reckoned by it.
  tz_offset INTEGER NOT NULL DEFAULT 420,
  -- The morning list: its hour (NULL: off) and the next time it is due (ms).
  digest_hour INTEGER DEFAULT 7,
  digest_next INTEGER
);
CREATE INDEX users_digest ON users (digest_next) WHERE digest_next IS NOT NULL;

-- Signed in: a cookie holding a random token, of which only the SHA-256 is kept.
CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- One row per Google sign-in begun, used once and kept ten minutes, so a
-- client's rows are its starts in the last ten minutes. `client`: a keyed
-- hash of the address that began it, never the address.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  client TEXT,
  used_at INTEGER
);
CREATE INDEX oauth_states_created ON oauth_states (created_at);
CREATE INDEX oauth_states_client ON oauth_states (client, created_at);

-- Attempts per ten-minute window: sign-ins begun (kind 'signin', everyone
-- together) and pairing codes tried (kind 'pair:<keyed hash of address>').
CREATE TABLE counters (
  kind TEXT NOT NULL,
  win INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (kind, win)
);

-- Signing a phone in without Google on it: an iPhone's home-screen app
-- keeps cookies apart from Safari's, and Google's page opened from it
-- finishes in Safari. 'install' codes ride in the installed app's start
-- address; 'manual' ones are typed from one screen into another. Used once.
CREATE TABLE pair_codes (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX pair_codes_user ON pair_codes (user_id);
CREATE INDEX pair_codes_expires ON pair_codes (expires_at);

CREATE TABLE notes (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  text TEXT NOT NULL,
  title TEXT NOT NULL,
  items TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  due INTEGER,
  rule TEXT,
  nag INTEGER NOT NULL DEFAULT 0,
  done INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  -- The Worker's own, never sent to phones: when to push next, for which
  -- occurrence, and how many more times to ring it for "nhắc dai".
  fire_at INTEGER,
  occ INTEGER,
  nags_left INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX notes_rev ON notes (user_id, rev);
CREATE INDEX notes_fire ON notes (fire_at) WHERE fire_at IS NOT NULL;

-- Phones that turned notifications on. One row per browser subscription;
-- the endpoint is that browser's address at its push service, p256dh and
-- auth what each message is encrypted with, so only that browser reads it.
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX push_subs_user ON push_subs (user_id);

-- iPhone shortcuts that add notes (Siri, the share sheet, tapping the back
-- of the phone). Only the token's SHA-256 is kept; it is shown once.
CREATE TABLE api_tokens (
  hash TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);
CREATE INDEX api_tokens_user ON api_tokens (user_id);
