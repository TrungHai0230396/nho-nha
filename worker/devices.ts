// Counting installs, with nothing personal kept (migrations/0006). At most
// once a day each device says whether it runs as the installed app (home
// screen, Dock, a window of its own) or in a browser tab, and what kind of
// device it is (src/lib/count.ts). One row a device, under a random id kept
// for counting alone: no user id, no address, no user agent, and not the id
// its push subscription carries, so no join leads from a row to an account.
// No session either: the app sends no cookie with it, and none is read.
// scripts/dem-may.sh reads the rows; the 03:00 sweep forgets a device unseen
// for 90 days.
//
// D1's free plan allows 100,000 rows written a day, for every app on the
// account together. So a device already counted today writes nothing, the
// next day one row, and the limits below are counted only for devices never
// seen: new ids are all a flood could add.
import { PLATFORMS, type DeviceReport, type Platform } from "../src/shared/protocol";
import { DAY, MINUTE, startOfDay, VN_OFFSET } from "../src/shared/wall";
import { hmacHex } from "./crypto";
import { clientBucket } from "./google";
import { isObject, json, readJson } from "./http";
import type { Sql } from "./sql";

/**
 * New devices per address per ten minutes, and everyone's together. Low on
 * purpose: one refused is only counted later, the next time its app comes to
 * the front, while each one let in costs rows written. Past the limits a
 * report writes nothing at all.
 */
export const DEVICE_LIMITS = { perClient: 10, all: 30 };
const WINDOW_MS = 10 * MINUTE;
/** Unseen this long, a device is forgotten (/rieng-tu says so). */
export const DEVICE_IDLE_MS = 90 * DAY;
/** The id src/lib/count.ts makes (newId): 22 characters. */
const ID = /^[A-Za-z0-9_-]{22}$/;

export interface DeviceDeps {
  sql: Sql;
  now: number;
  /** Keys the address hash, so the counters never hold an address. */
  secret: string;
  limits?: typeof DEVICE_LIMITS;
}

/** A report and nothing more: any other field, or one not as the app sends it, and it is refused, so nothing else is ever kept. */
export function readReport(v: unknown): DeviceReport | null {
  if (!isObject(v) || Object.keys(v).sort().join() !== "device,platform,standalone") return null;
  const { device, platform, standalone } = v;
  if (typeof device !== "string" || !ID.test(device) || typeof standalone !== "boolean") return null;
  if (!PLATFORMS.includes(platform as Platform)) return null;
  return { device, platform: platform as Platform, standalone };
}

// In each statement: ?1 this address's counter, ?2 the window, ?3 the device, ?4 and ?5 the
// limits per address and for everyone. A counter stops at its limit plus one, so a flood
// past it writes nothing.
const SEEN = "EXISTS (SELECT 1 FROM devices WHERE id = ?3)";
// This address's new devices, while everyone's still has room: past that, a crowd of new addresses writes no rows.
const COUNT_CLIENT_SQL = `INSERT INTO counters (kind, win, n) SELECT ?1, ?2, 1
    WHERE NOT ${SEEN} AND COALESCE((SELECT n FROM counters WHERE kind = 'device' AND win = ?2), 0) < ?5
  ON CONFLICT (kind, win) DO UPDATE SET n = n + 1 WHERE counters.n <= ?4`;
// Everyone's, only for a device this address still has room for: one address cannot use up the rest's.
const COUNT_ALL_SQL = `INSERT INTO counters (kind, win, n) SELECT 'device', ?2, 1
    WHERE NOT ${SEEN} AND (SELECT n FROM counters WHERE kind = ?1 AND win = ?2) <= ?4
  ON CONFLICT (kind, win) DO UPDATE SET n = n + 1 WHERE counters.n <= ?5`;
// A device seen before always gets in, a new one within both limits. Seen is kept as the day
// (?8: its start, Vietnam time), never the moment, so no row can be matched to a sign-in by
// its time. Written once a day at most, and once more the day it first runs as the app:
// `standalone` only ever goes from 0 to 1, so a device that has run as the app counts as
// installed whichever way it was opened on its last day (Android and Chrome on a computer
// open it both ways, as one device). A same-day repeat matches nothing and writes no row.
const UPSERT_SQL = `INSERT INTO devices (id, platform, standalone, first_seen, last_seen)
  SELECT ?3, ?6, ?7, ?8, ?8
    WHERE ${SEEN} OR ((SELECT n FROM counters WHERE kind = ?1 AND win = ?2) <= ?4
      AND (SELECT n FROM counters WHERE kind = 'device' AND win = ?2) <= ?5)
  ON CONFLICT (id) DO UPDATE SET platform = excluded.platform,
    standalone = MAX(devices.standalone, excluded.standalone), last_seen = excluded.last_seen
  WHERE devices.last_seen < excluded.last_seen OR excluded.standalone > devices.standalone`;

export async function handleDevice(req: Request, url: URL, d: DeviceDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  // Another site's page cannot add to the count.
  if (req.headers.get("origin") !== url.origin) return json({ error: "origin" }, 403);
  const r = readReport(await readJson(req, 200));
  if (!r) return json({ error: "bad report" }, 400);
  const limits = d.limits ?? DEVICE_LIMITS;
  const win = Math.floor(d.now / WINDOW_MS);
  const client = `device:${await hmacHex(d.secret, clientBucket(req))}`;
  const keys = [client, win, r.device, limits.perClient, limits.all];
  const [, , , , seen = []] = await d.sql.batch([
    { sql: "DELETE FROM counters WHERE win < ?1", params: [win - 1] },
    { sql: COUNT_CLIENT_SQL, params: keys },
    { sql: COUNT_ALL_SQL, params: keys },
    { sql: UPSERT_SQL, params: [...keys, r.platform, r.standalone ? 1 : 0, startOfDay(d.now, VN_OFFSET)] },
    { sql: "SELECT 1 AS ok FROM devices WHERE id = ?1", params: [r.device] },
  ]);
  // Not there: a new device past a limit, counted when it next reports.
  return seen.length ? json({ ok: true }) : json({ error: "too many" }, 429);
}

/** Every night at 03:00 (worker/cron.ts): devices unseen for 90 days. */
export async function sweepDevices(sql: Sql, now: number): Promise<void> {
  await sql.batch([{ sql: "DELETE FROM devices WHERE last_seen < ?1", params: [now - DEVICE_IDLE_MS] }]);
}
