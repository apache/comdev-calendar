/**
 * The display-zone switch, exercised from a browser that is not in UTC.
 *
 * The rest of the suite runs with TZ=UTC, where "local" and "utc" agree and
 * the switch cannot be seen to do anything. Here the browser is put in Tokyo
 * so that the two settings genuinely differ.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeEvent } from "../tests/factories";
import { dayKey } from "./dates";
import {
  agendaSections,
  allDayEvents,
  compareForDisplay,
  durationMs,
  eventEnd,
  eventStart,
  groupByDay,
  isMultiDay,
  layoutDay,
  occursOnDay,
} from "./events";

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Asia/Tokyo"; // UTC+9, no daylight saving
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

// 22:00 UTC on 10 March is 07:00 on 11 March in Tokyo.
const LATE = makeEvent({
  title: "Late call",
  start: "2026-03-10T22:00:00Z",
  end: "2026-03-10T23:00:00Z",
});

describe("reading an event in each display zone", () => {
  it("local uses the browser's clock", () => {
    const start = eventStart(LATE, "local");
    expect(start.getHours()).toBe(7);
    expect(start.getDate()).toBe(11);
  });

  it("utc uses the UTC clock", () => {
    const start = eventStart(LATE, "utc");
    expect(start.getHours()).toBe(22);
    expect(start.getDate()).toBe(10);
  });

  it("the end moves with the start", () => {
    expect(eventEnd(LATE, "local").getHours()).toBe(8);
    expect(eventEnd(LATE, "utc").getHours()).toBe(23);
  });

  it("the length of an event does not depend on the zone", () => {
    expect(durationMs(LATE)).toBe(3_600_000);
  });

  it("defaults to local when no zone is given", () => {
    expect(eventStart(LATE).getTime()).toBe(eventStart(LATE, "local").getTime());
  });
});

describe("which day an event lands on", () => {
  const march10 = new Date(2026, 2, 10);
  const march11 = new Date(2026, 2, 11);

  it("depends on the display zone", () => {
    expect(occursOnDay(LATE, march10, "utc")).toBe(true);
    expect(occursOnDay(LATE, march11, "utc")).toBe(false);

    expect(occursOnDay(LATE, march10, "local")).toBe(false);
    expect(occursOnDay(LATE, march11, "local")).toBe(true);
  });

  it("so does the day it is bucketed into", () => {
    const days = [march10, march11];
    expect(groupByDay([LATE], days, "utc").get(dayKey(march10))).toHaveLength(1);
    expect(groupByDay([LATE], days, "utc").get(dayKey(march11))).toHaveLength(0);
    expect(groupByDay([LATE], days, "local").get(dayKey(march11))).toHaveLength(1);
  });

  it("and which day the agenda files it under", () => {
    expect(agendaSections([LATE], "utc")[0].key).toBe("2026-03-10");
    expect(agendaSections([LATE], "local")[0].key).toBe("2026-03-11");
  });

  it("an event can become multi-day in one zone and not the other", () => {
    const overnight = makeEvent({ start: "2026-03-10T14:00:00Z", end: "2026-03-10T16:00:00Z" });
    // 23:00-01:00 in Tokyo, so it straddles midnight there but not in UTC.
    expect(isMultiDay(overnight, "utc")).toBe(false);
    expect(isMultiDay(overnight, "local")).toBe(true);
  });
});

describe("positioning within a day", () => {
  it("places an event at the right height for the zone", () => {
    const noonUtc = makeEvent({ start: "2026-03-10T12:00:00Z", end: "2026-03-10T13:00:00Z" });
    const [inUtc] = layoutDay([noonUtc], new Date(2026, 2, 10), "utc");
    expect(inUtc.top).toBeCloseTo(0.5);

    const [inTokyo] = layoutDay([noonUtc], new Date(2026, 2, 10), "local");
    expect(inTokyo.top).toBeCloseTo(21 / 24);
  });

  it("clips an event that has spilled over midnight", () => {
    // 22:00 UTC is 07:00 the next day in Tokyo, so nothing lands on the 10th.
    expect(layoutDay([LATE], new Date(2026, 2, 10), "local")).toHaveLength(0);
    expect(layoutDay([LATE], new Date(2026, 2, 11), "local")).toHaveLength(1);
  });
});

describe("all-day events", () => {
  const conference = makeEvent({
    title: "ApacheCon",
    all_day: true,
    start: "2026-03-10T00:00:00Z",
    end: "2026-03-12T00:00:00Z",
  });

  it("stay on the same dates whichever zone is displayed", () => {
    for (const zone of ["local", "utc"] as const) {
      expect(eventStart(conference, zone).getDate()).toBe(10);
      expect(occursOnDay(conference, new Date(2026, 2, 10), zone)).toBe(true);
      expect(occursOnDay(conference, new Date(2026, 2, 11), zone)).toBe(true);
      expect(occursOnDay(conference, new Date(2026, 2, 12), zone)).toBe(false);
    }
  });

  it("show up in the all-day row in both zones", () => {
    expect(allDayEvents([conference], new Date(2026, 2, 10), "utc")).toHaveLength(1);
    expect(allDayEvents([conference], new Date(2026, 2, 10), "local")).toHaveLength(1);
  });
});

describe("ordering", () => {
  it("two events can swap order between zones only if they really differ", () => {
    const earlier = makeEvent({ id: 1, start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" });
    const later = makeEvent({ id: 2, start: "2026-03-10T11:00:00Z", end: "2026-03-10T12:00:00Z" });
    for (const zone of ["local", "utc"] as const) {
      expect([later, earlier].sort((a, b) => compareForDisplay(a, b, zone)).map((e) => e.id)).toEqual([1, 2]);
    }
  });
});
