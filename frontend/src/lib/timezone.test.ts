/**
 * Timezone conversions.
 *
 * The suite runs with TZ=UTC (see src/tests/setup.ts), so "local" and UTC
 * coincide here. To exercise the interesting cases the tests use explicit IANA
 * zones, which do not depend on the machine's own setting.
 */

import { describe, expect, it } from "vitest";
import {
  LOCAL,
  UTC,
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
import {
  hourLabels,
  isKnownZone,
  majorZones,
  normaliseZone,
  resolveZone,
  shortZoneLabel,
  uniqueZones,
  zoneCity,
  zoneLabel,
  zoneRegion,
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
  it("local leaves an instant alone", () => {
    expect(toWall(SUMMER, LOCAL).getTime()).toBe(SUMMER.getTime());
    expect(fromWall(SUMMER, LOCAL).getTime()).toBe(SUMMER.getTime());
  });

  it("UTC reads an instant on the UTC clock", () => {
    const wall = toWall(SUMMER, UTC);
    expect(wall.getUTCHours()).toBe(SUMMER.getUTCHours());
  });

  it("any IANA zone can be the display zone", () => {
    expect(toWall(SUMMER, "Asia/Tokyo").getHours()).toBe(21);
    expect(toWall(SUMMER, "America/New_York").getHours()).toBe(8);
  });

  it("round-trips through every display zone", () => {
    for (const zone of [LOCAL, UTC, "Europe/Berlin", "Pacific/Auckland"]) {
      expect(fromWall(toWall(SUMMER, zone), zone).getTime()).toBe(SUMMER.getTime());
    }
  });

  it("resolves the local sentinel to a real zone name", () => {
    expect(resolveZone(LOCAL)).toBe(browserZone());
    expect(resolveZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("nowInZone returns something close to now", () => {
    expect(Math.abs(nowInZone(LOCAL).getTime() - Date.now())).toBeLessThan(2000);
  });
});

describe("naming a zone so it is obvious why that clock", () => {
  it("uses the place the zone is named after", () => {
    expect(zoneCity("Europe/Copenhagen")).toBe("Copenhagen");
    expect(zoneCity("America/New_York")).toBe("New York");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneCity(UTC)).toBe(UTC);
  });

  it("knows which part of the world a zone is in", () => {
    expect(zoneRegion("Europe/Copenhagen")).toBe("Europe");
    expect(zoneRegion("Asia/Tokyo")).toBe("Asia");
    expect(zoneRegion(UTC)).toBe(UTC);
  });

  it("spells out the abbreviation and the offset", () => {
    expect(zoneLabel("Europe/Berlin", SUMMER)).toBe("Berlin (UTC+02:00)");
    expect(zoneLabel(UTC, SUMMER)).toBe(UTC);
  });

  it("does not repeat the offset when there is no letter abbreviation", () => {
    // Intl reports "GMT+5:45" for Kathmandu, which would just echo the offset.
    expect(zoneLabel("Asia/Kathmandu", SUMMER)).toBe("Kathmandu (UTC+05:45)");
  });

  it("says what local resolves to", () => {
    const described = describeDisplayZone(LOCAL, SUMMER);
    expect(described.startsWith("Local - ")).toBe(true);
    expect(described).toContain(zoneCity(browserZone()));
  });

  it("names a chosen zone without the local prefix", () => {
    expect(describeDisplayZone("Asia/Tokyo", SUMMER)).toBe("Tokyo (UTC+09:00)");
  });

  it("has a compact form for column headings", () => {
    expect(shortZoneLabel(UTC, SUMMER)).toBe(UTC);
    expect(shortZoneLabel("Asia/Kathmandu", SUMMER)).toBe("Kathmandu");
  });

  it("explains itself in a sentence", () => {
    expect(explainDisplayZone(LOCAL, SUMMER)).toContain("your browser's timezone");
    expect(explainDisplayZone("Asia/Tokyo", SUMMER)).toContain("Asia/Tokyo");
  });
});

describe("the zones on offer", () => {
  it("starts with UTC", () => {
    expect(majorZones()[0]).toBe(UTC);
  });

  it("covers every inhabited continent", () => {
    const zones = majorZones();
    for (const name of [
      "America/New_York",
      "Europe/London",
      "Africa/Nairobi",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Pacific/Auckland",
    ]) {
      expect(zones).toContain(name);
    }
  });

  it("only lists zones the browser understands", () => {
    for (const name of majorZones()) expect(isKnownZone(name)).toBe(true);
  });

  it("has no duplicates", () => {
    const zones = majorZones();
    expect(new Set(zones).size).toBe(zones.length);
  });

  it("rejects things that are not zones", () => {
    expect(isKnownZone("Mars/Olympus")).toBe(false);
    expect(isKnownZone("")).toBe(false);
    expect(isKnownZone(LOCAL)).toBe(false);
  });
});

describe("tidying a stored or configured zone", () => {
  it("keeps the local sentinel", () => {
    expect(normaliseZone("local")).toBe(LOCAL);
    expect(normaliseZone("Local")).toBe(LOCAL);
  });

  it("accepts the old lowercase utc spelling", () => {
    // The two-way switch used to store "utc"; an existing preference should
    // survive the upgrade rather than silently resetting.
    expect(normaliseZone("utc")).toBe(UTC);
  });

  it("keeps a real IANA name", () => {
    expect(normaliseZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("falls back when the value is missing or nonsense", () => {
    expect(normaliseZone(null)).toBe(UTC);
    expect(normaliseZone("")).toBe(UTC);
    expect(normaliseZone("Mars/Olympus")).toBe(UTC);
    expect(normaliseZone("Mars/Olympus", LOCAL)).toBe(LOCAL);
  });
});

describe("keeping the comparison list sensible", () => {
  it("drops duplicates", () => {
    expect(uniqueZones(["Asia/Tokyo", "Asia/Tokyo", UTC])).toEqual(["Asia/Tokyo", UTC]);
  });

  it("drops whichever clock is already the primary one", () => {
    expect(uniqueZones([UTC, "Asia/Tokyo"], UTC)).toEqual(["Asia/Tokyo"]);
  });

  it("treats local and the zone it resolves to as the same clock", () => {
    // The suite runs in UTC, so "local" and "UTC" are one and the same here.
    expect(uniqueZones([LOCAL], UTC)).toEqual([]);
    expect(uniqueZones([UTC, LOCAL])).toEqual([UTC]);
  });

  it("keeps the order they were added in", () => {
    expect(uniqueZones(["Asia/Tokyo", "Europe/Berlin"])).toEqual(["Asia/Tokyo", "Europe/Berlin"]);
  });
});

describe("hour labels for a comparison gutter", () => {
  const day = new Date(2026, 6, 10);

  it("gives one label per hour", () => {
    expect(hourLabels(day, UTC, "Asia/Tokyo")).toHaveLength(24);
  });

  it("shifts by the difference between the two zones", () => {
    const labels = hourLabels(day, UTC, "Asia/Tokyo");
    expect(labels[0]).toBe("09:00");
    expect(labels[9]).toBe("18:00");
    // ...and wraps round midnight rather than running past 23:00.
    expect(labels[23]).toBe("08:00");
  });

  it("handles a zone behind the primary one", () => {
    expect(hourLabels(day, UTC, "America/New_York")[12]).toBe("08:00");
  });

  it("handles a half-hour offset", () => {
    expect(hourLabels(day, UTC, "Asia/Kolkata")[0]).toBe("05:30");
  });

  it("is the identity when both zones are the same", () => {
    expect(hourLabels(day, UTC, UTC)[13]).toBe("13:00");
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
    expect(describeDisplayZone(UTC)).toBe(UTC);
    expect(describeDisplayZone(LOCAL, SUMMER)).toContain(UTC);
  });

  it("explains the display zone in words", () => {
    expect(explainDisplayZone(UTC)).toContain(UTC);
    expect(explainDisplayZone(LOCAL)).toContain("browser");
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
