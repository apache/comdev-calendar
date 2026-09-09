/**
 * Timezone conversions.
 *
 * The suite runs with TZ=UTC (see src/tests/setup.ts), so "local" and UTC
 * coincide here. To exercise the interesting cases the tests use explicit IANA
 * zones, which do not depend on the machine's own setting.
 */

import { describe, expect, it } from "vitest";
import {
  DISPLAY_ZONES,
  browserZone,
  describeDisplayZone,
  explainDisplayZone,
  fromWall,
  fromWallInZone,
  localOffsetMs,
  nowInZone,
  offsetLabel,
  toWall,
  toWallInZone,
  zoneAbbreviation,
  zoneList,
  zoneOffsetMs,
} from "./timezone";

const HOUR = 3_600_000;
// 10 March 2026, 12:00 UTC. Still winter time in Europe: EU clocks change on
// the last Sunday of March. The US has already sprung forward by then, so the
// American cases use a January date instead.
const WINTER = new Date("2026-03-10T12:00:00Z");
const DEEP_WINTER = new Date("2026-01-10T12:00:00Z");
// 10 July 2026, 12:00 UTC. Summer time in Europe.
const SUMMER = new Date("2026-07-10T12:00:00Z");

describe("zone offsets", () => {
  it("UTC is always zero", () => {
    expect(zoneOffsetMs(WINTER, "UTC")).toBe(0);
    expect(zoneOffsetMs(SUMMER, "UTC")).toBe(0);
  });

  it("follows daylight saving", () => {
    expect(zoneOffsetMs(WINTER, "Europe/Berlin")).toBe(HOUR);
    expect(zoneOffsetMs(SUMMER, "Europe/Berlin")).toBe(2 * HOUR);
  });

  it("handles zones west of Greenwich", () => {
    expect(zoneOffsetMs(DEEP_WINTER, "America/New_York")).toBe(-5 * HOUR);
    expect(zoneOffsetMs(SUMMER, "America/New_York")).toBe(-4 * HOUR);
  });

  it("the EU and the US change their clocks on different dates", () => {
    // 10 March 2026: the US is already on summer time, the EU is not.
    expect(zoneOffsetMs(WINTER, "America/New_York")).toBe(-4 * HOUR);
    expect(zoneOffsetMs(WINTER, "Europe/Berlin")).toBe(HOUR);
  });

  it("handles half-hour and three-quarter-hour offsets", () => {
    expect(zoneOffsetMs(WINTER, "Asia/Kolkata")).toBe(5.5 * HOUR);
    expect(zoneOffsetMs(WINTER, "Asia/Kathmandu")).toBe(5.75 * HOUR);
  });

  it("does not throw on a zone it has never heard of", () => {
    expect(zoneOffsetMs(WINTER, "Mars/Olympus")).toBe(0);
  });

  it("localOffsetMs agrees with the Date it is given", () => {
    expect(localOffsetMs(WINTER)).toBe(-WINTER.getTimezoneOffset() * 60_000);
  });
});

describe("instants to wall clocks", () => {
  it("reads an instant on a Berlin clock", () => {
    const wall = toWallInZone(SUMMER, "Europe/Berlin");
    expect(wall.getHours()).toBe(14); // 12:00 UTC is 14:00 CEST
    expect(wall.getDate()).toBe(10);
  });

  it("can push an instant onto the previous day", () => {
    const wall = toWallInZone(new Date("2026-01-10T02:00:00Z"), "America/New_York");
    expect(wall.getDate()).toBe(9);
    expect(wall.getHours()).toBe(21);
  });

  it("can push an instant onto the next day", () => {
    const wall = toWallInZone(new Date("2026-03-10T22:00:00Z"), "Asia/Tokyo");
    expect(wall.getDate()).toBe(11);
    expect(wall.getHours()).toBe(7);
  });

  it("round-trips", () => {
    for (const timeZone of ["UTC", "Europe/Berlin", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"]) {
      for (const instant of [WINTER, DEEP_WINTER, SUMMER]) {
        const wall = toWallInZone(instant, timeZone);
        expect(fromWallInZone(wall, timeZone).getTime()).toBe(instant.getTime());
      }
    }
  });

  it("turns a wall clock into the instant it names", () => {
    // 15:00 in Berlin in July is 13:00 UTC.
    const wall = new Date(2026, 6, 10, 15, 0);
    expect(fromWallInZone(wall, "Europe/Berlin").toISOString()).toBe("2026-07-10T13:00:00.000Z");
  });

  it("the same wall clock is a different instant in a different zone", () => {
    const wall = new Date(2026, 6, 10, 15, 0);
    const berlin = fromWallInZone(wall, "Europe/Berlin");
    const tokyo = fromWallInZone(wall, "Asia/Tokyo");
    expect(tokyo.getTime()).toBeLessThan(berlin.getTime());
    expect(berlin.getTime() - tokyo.getTime()).toBe(7 * HOUR);
  });
});

describe("the display zone", () => {
  it("has exactly two settings", () => {
    expect([...DISPLAY_ZONES]).toEqual(["local", "utc"]);
  });

  it("local leaves an instant alone", () => {
    expect(toWall(SUMMER, "local").getTime()).toBe(SUMMER.getTime());
    expect(fromWall(SUMMER, "local").getTime()).toBe(SUMMER.getTime());
  });

  it("utc reads an instant on the UTC clock", () => {
    const wall = toWall(SUMMER, "utc");
    expect(wall.getUTCHours()).toBe(SUMMER.getUTCHours());
  });

  it("round-trips through the display zone", () => {
    for (const zone of DISPLAY_ZONES) {
      expect(fromWall(toWall(SUMMER, zone), zone).getTime()).toBe(SUMMER.getTime());
    }
  });

  it("nowInZone returns something close to now", () => {
    expect(Math.abs(nowInZone("local").getTime() - Date.now())).toBeLessThan(2000);
  });
});

describe("labels", () => {
  it("formats offsets", () => {
    expect(offsetLabel(0)).toBe("UTC");
    expect(offsetLabel(2 * HOUR)).toBe("UTC+02:00");
    expect(offsetLabel(-5 * HOUR)).toBe("UTC-05:00");
    expect(offsetLabel(5.5 * HOUR)).toBe("UTC+05:30");
    expect(offsetLabel(-3.5 * HOUR)).toBe("UTC-03:30");
  });

  it("names a zone", () => {
    expect(zoneAbbreviation(SUMMER, "Europe/Berlin")).toBe("GMT+2");
    expect(zoneAbbreviation(SUMMER, "UTC")).toBe("UTC");
  });

  it("falls back to the zone name it was given", () => {
    expect(zoneAbbreviation(SUMMER, "Mars/Olympus")).toBe("Mars/Olympus");
  });

  it("describes the display zone", () => {
    expect(describeDisplayZone("utc")).toBe("UTC");
    expect(describeDisplayZone("local", SUMMER)).toContain("UTC");
  });

  it("explains the display zone in words", () => {
    expect(explainDisplayZone("utc")).toContain("UTC");
    expect(explainDisplayZone("local")).toContain("browser");
  });
});

describe("the zone list offered in the form", () => {
  const zones = zoneList();

  it("includes UTC and the browser's own zone", () => {
    expect(zones).toContain("UTC");
    expect(zones).toContain(browserZone());
  });

  it("is sorted and free of duplicates", () => {
    expect(zones).toEqual([...zones].sort());
    expect(new Set(zones).size).toBe(zones.length);
  });

  it("covers the places people actually are", () => {
    for (const name of ["Europe/Berlin", "America/New_York", "Asia/Tokyo"]) {
      expect(zones).toContain(name);
    }
  });
});
