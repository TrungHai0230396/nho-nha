-- "Dùng ngay": people who use the app without signing in. Each gets an
-- account tied to its one device, with no Google behind it (google_sub is
-- 'guest:<id>', unique like a real one). The server still keeps their notes,
-- or reminders could not ring with the app closed. Signing in with Google
-- later, or pairing with a code, moves everything of theirs into that
-- account (worker/guest.ts).
ALTER TABLE users ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;
CREATE INDEX users_guest ON users (created_at) WHERE guest = 1;
