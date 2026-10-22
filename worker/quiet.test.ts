import { describe, expect, it } from "vitest";
import { fromWall, VN_OFFSET } from "../src/shared/wall";
import { asleep, quietOf, wakeAt } from "./quiet";

const at = (d: number, h: number, mi = 0) => fromWall(2026, 10, d, h, mi, VN_OFFSET);

describe("hours of sleep", () => {
  const night = { from: 22, to: 6, offset: VN_OFFSET };

  it("run over midnight, or not", () => {
    expect([21, 22, 23, 0, 5, 6, 12].map((h) => asleep(night, at(13, h, h === 21 ? 59 : 0)))).toEqual([false, true, true, true, true, false, false]);
    const late = { from: 0, to: 7, offset: VN_OFFSET };
    expect([23, 0, 6, 7].map((h) => asleep(late, at(13, h)))).toEqual([false, true, true, false]);
  });

  it("end at the next morning's hour, on their clock", () => {
    expect(wakeAt(night, at(13, 23, 30))).toBe(at(14, 6));
    expect(wakeAt(night, at(14, 1))).toBe(at(14, 6));
    // Over a month's end.
    expect(wakeAt(night, fromWall(2026, 10, 31, 23, 0, VN_OFFSET))).toBe(fromWall(2026, 11, 1, 6, 0, VN_OFFSET));
  });

  it("are none when turned off, or when they make no span", () => {
    expect(quietOf({ quiet_from: null, quiet_to: 6, tz_offset: VN_OFFSET })).toBeNull();
    expect(quietOf({ quiet_from: 6, quiet_to: 6, tz_offset: VN_OFFSET })).toBeNull();
    expect(asleep(null, at(13, 23))).toBe(false);
    expect(quietOf({ quiet_from: 22, quiet_to: 6, tz_offset: VN_OFFSET })).toEqual(night);
  });
});
