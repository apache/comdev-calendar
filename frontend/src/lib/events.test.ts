import { describe, expect, it } from "vitest";
import { makeEvent } from "../tests/factories";
import { dayKey } from "./dates";
import {
  agendaSections,
  allDayEvents,
  calendarLabel,
  categoryLabel,
  compareForDisplay,
  durationMs,
  eventEnd,
  eventHue,
  eventStart,
  groupByDay,
  isMultiDay,
  layoutDay,
  occursOnDay,
  overlaps,
  projectHue,
} from "./events";

const MARCH_10 = new Date(2026, 2, 10);

describe("reading times off an event", () => {
  it("a timed event is a plain instant", () => {
    const event = makeEvent({ start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:30:00Z" });
    expect(eventStart(event).toISOString()).toBe("2026-03-10T09:00:00.000Z");
    expect(durationMs(event)).toBe(90 * 60_000);
  });

  it("an all-day event is read from its UTC date parts", () => {
    const event = makeEvent({
      all_day: true,
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-11T00:00:00Z",
    });
    expect(eventStart(event).getDate()).toBe(10);
    expect(eventStart(event).getHours()).toBe(0);
    expect(eventEnd(event).getDate()).toBe(11);
  });
});

describe("overlap", () => {
  const event = makeEvent({ start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" });

  it("is half open", () => {
    expect(overlaps(event, new Date("2026-03-10T10:00:00Z"), new Date("2026-03-10T11:00:00Z"))).toBe(false);
    expect(overlaps(event, new Date("2026-03-10T08:00:00Z"), new Date("2026-03-10T09:00:00Z"))).toBe(false);
    expect(overlaps(event, new Date("2026-03-10T09:30:00Z"), new Date("2026-03-10T09:45:00Z"))).toBe(true);
  });

  it("occursOnDay finds the right day", () => {
    expect(occursOnDay(event, MARCH_10)).toBe(true);
    expect(occursOnDay(event, new Date(2026, 2, 11))).toBe(false);
  });

  it("a multi-day event occurs on every day it spans", () => {
    const long = makeEvent({ start: "2026-03-10T09:00:00Z", end: "2026-03-12T09:00:00Z" });
    expect(occursOnDay(long, new Date(2026, 2, 10))).toBe(true);
    expect(occursOnDay(long, new Date(2026, 2, 11))).toBe(true);
    expect(occursOnDay(long, new Date(2026, 2, 12))).toBe(true);
    expect(occursOnDay(long, new Date(2026, 2, 13))).toBe(false);
  });

  it("isMultiDay", () => {
    expect(isMultiDay(makeEvent())).toBe(false);
    expect(isMultiDay(makeEvent({ start: "2026-03-10T09:00:00Z", end: "2026-03-12T09:00:00Z" }))).toBe(true);
  });

  it("an event ending exactly at midnight is not multi-day", () => {
    const event = makeEvent({
      all_day: true,
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-11T00:00:00Z",
    });
    expect(isMultiDay(event)).toBe(false);
  });
});

describe("grouping by day", () => {
  it("puts each event in every day it touches", () => {
    const days = [new Date(2026, 2, 9), new Date(2026, 2, 10), new Date(2026, 2, 11)];
    const single = makeEvent({ id: 1, start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" });
    const long = makeEvent({ id: 2, start: "2026-03-09T09:00:00Z", end: "2026-03-11T09:00:00Z" });
    const buckets = groupByDay([single, long], days);
    expect(buckets.get(dayKey(days[0]))!.map((event) => event.id)).toEqual([2]);
    expect(buckets.get(dayKey(days[1]))!.map((event) => event.id).sort()).toEqual([1, 2]);
    expect(buckets.get(dayKey(days[2]))!.map((event) => event.id)).toEqual([2]);
  });

  it("creates an empty bucket for every requested day", () => {
    const days = [new Date(2026, 5, 1), new Date(2026, 5, 2)];
    const buckets = groupByDay([], days);
    expect([...buckets.keys()]).toEqual(days.map(dayKey));
    expect([...buckets.values()].every((bucket) => bucket.length === 0)).toBe(true);
  });
});

describe("display order", () => {
  it("all-day events come first", () => {
    const timed = makeEvent({ id: 1, start: "2026-03-10T08:00:00Z" });
    const allDay = makeEvent({
      id: 2,
      all_day: true,
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-11T00:00:00Z",
    });
    expect([timed, allDay].sort(compareForDisplay)[0].id).toBe(2);
  });

  it("then by start time", () => {
    const later = makeEvent({ id: 1, start: "2026-03-10T14:00:00Z", end: "2026-03-10T15:00:00Z" });
    const earlier = makeEvent({ id: 2, start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" });
    expect([later, earlier].sort(compareForDisplay).map((event) => event.id)).toEqual([2, 1]);
  });

  it("then longest first, so a long event forms the left column", () => {
    const short = makeEvent({ id: 1, start: "2026-03-10T09:00:00Z", end: "2026-03-10T09:30:00Z" });
    const long = makeEvent({ id: 2, start: "2026-03-10T09:00:00Z", end: "2026-03-10T12:00:00Z" });
    expect([short, long].sort(compareForDisplay).map((event) => event.id)).toEqual([2, 1]);
  });

  it("then by title, so the order is stable", () => {
    const b = makeEvent({ id: 1, title: "Beta" });
    const a = makeEvent({ id: 2, title: "Alpha" });
    expect([b, a].sort(compareForDisplay).map((event) => event.title)).toEqual(["Alpha", "Beta"]);
  });
});

describe("laying out a day", () => {
  it("positions an event as a fraction of the day", () => {
    const event = makeEvent({ start: "2026-03-10T06:00:00Z", end: "2026-03-10T12:00:00Z" });
    const [placed] = layoutDay([event], MARCH_10);
    expect(placed.top).toBeCloseTo(0.25);
    expect(placed.height).toBeCloseTo(0.25);
    expect(placed.columns).toBe(1);
  });

  it("ignores all-day events", () => {
    const allDay = makeEvent({
      all_day: true,
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-11T00:00:00Z",
    });
    expect(layoutDay([allDay], MARCH_10)).toHaveLength(0);
  });

  it("gives overlapping events their own column", () => {
    const first = makeEvent({ id: 1, start: "2026-03-10T09:00:00Z", end: "2026-03-10T11:00:00Z" });
    const second = makeEvent({ id: 2, start: "2026-03-10T10:00:00Z", end: "2026-03-10T12:00:00Z" });
    const placed = layoutDay([first, second], MARCH_10);
    expect(placed.map((item) => item.column)).toEqual([0, 1]);
    expect(placed.every((item) => item.columns === 2)).toBe(true);
  });

  it("three overlapping events need three columns", () => {
    const events = [0, 1, 2].map((offset) =>
      makeEvent({
        id: offset + 1,
        start: `2026-03-10T${String(9 + offset).padStart(2, "0")}:00:00Z`,
        end: "2026-03-10T13:00:00Z",
      }),
    );
    const placed = layoutDay(events, MARCH_10);
    expect(placed.map((item) => item.column)).toEqual([0, 1, 2]);
    expect(new Set(placed.map((item) => item.columns))).toEqual(new Set([3]));
  });

  it("events separated by a gap each get the full width", () => {
    const morning = makeEvent({ id: 1, start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" });
    const evening = makeEvent({ id: 2, start: "2026-03-10T18:00:00Z", end: "2026-03-10T19:00:00Z" });
    const placed = layoutDay([morning, evening], MARCH_10);
    expect(placed.every((item) => item.columns === 1 && item.column === 0)).toBe(true);
  });

  it("reuses a column once the earlier event has finished", () => {
    const long = makeEvent({ id: 1, start: "2026-03-10T09:00:00Z", end: "2026-03-10T17:00:00Z" });
    const early = makeEvent({ id: 2, start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" });
    const late = makeEvent({ id: 3, start: "2026-03-10T11:00:00Z", end: "2026-03-10T12:00:00Z" });
    const placed = layoutDay([long, early, late], MARCH_10);
    const byId = new Map(placed.map((item) => [item.event.id, item]));
    expect(byId.get(2)!.column).toBe(1);
    expect(byId.get(3)!.column).toBe(1);
    expect(byId.get(1)!.columns).toBe(2);
  });

  it("clips an event that started the day before", () => {
    const event = makeEvent({ start: "2026-03-09T22:00:00Z", end: "2026-03-10T02:00:00Z" });
    const [placed] = layoutDay([event], MARCH_10);
    expect(placed.top).toBe(0);
    expect(placed.height).toBeCloseTo(2 / 24);
  });

  it("gives a very short event a usable minimum height", () => {
    const event = makeEvent({ start: "2026-03-10T09:00:00Z", end: "2026-03-10T09:01:00Z" });
    const [placed] = layoutDay([event], MARCH_10);
    expect(placed.height).toBeGreaterThan(1 / (24 * 60));
  });
});

describe("all-day row", () => {
  it("only returns all-day events for that day", () => {
    const allDay = makeEvent({
      id: 1,
      all_day: true,
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-11T00:00:00Z",
    });
    const timed = makeEvent({ id: 2 });
    expect(allDayEvents([allDay, timed], MARCH_10).map((event) => event.id)).toEqual([1]);
    expect(allDayEvents([allDay, timed], new Date(2026, 2, 12))).toHaveLength(0);
  });
});

describe("agenda sections", () => {
  it("groups consecutive events by their start day", () => {
    const events = [
      makeEvent({ id: 1, start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" }),
      makeEvent({ id: 2, start: "2026-03-10T14:00:00Z", end: "2026-03-10T15:00:00Z" }),
      makeEvent({ id: 3, start: "2026-03-12T09:00:00Z", end: "2026-03-12T10:00:00Z" }),
    ];
    const sections = agendaSections(events);
    expect(sections).toHaveLength(2);
    expect(sections[0].events.map((event) => event.id)).toEqual([1, 2]);
    expect(sections[1].key).toBe("2026-03-12");
  });

  it("keeps the order it was given", () => {
    const events = [
      makeEvent({ id: 1, start: "2026-03-12T09:00:00Z", end: "2026-03-12T10:00:00Z" }),
      makeEvent({ id: 2, start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" }),
    ];
    expect(agendaSections(events).map((section) => section.key)).toEqual(["2026-03-12", "2026-03-10"]);
  });

  it("handles an empty list", () => {
    expect(agendaSections([])).toEqual([]);
  });
});

describe("labels and colours", () => {
  it("labels a calendar", () => {
    expect(calendarLabel(makeEvent({ category: "project", project: "httpd" }))).toBe("httpd");
    expect(calendarLabel(makeEvent({ category: "foundation", project: null }))).toBe("foundation");
    expect(calendarLabel(makeEvent({ category: "personal", project: null }))).toBe("personal");
  });

  it("labels a category", () => {
    expect(categoryLabel("personal")).toBe("Personal");
    expect(categoryLabel("project")).toBe("Project");
    expect(categoryLabel("foundation")).toBe("Foundation");
  });

  it("a project keeps the same colour every time", () => {
    expect(projectHue("httpd")).toBe(projectHue("httpd"));
    expect(projectHue("httpd")).not.toBe(projectHue("tomcat"));
  });

  it("hues stay inside the colour wheel", () => {
    for (const name of ["httpd", "tomcat", "maven", "kafka", "", "a-very-long-project-name"]) {
      expect(projectHue(name)).toBeGreaterThanOrEqual(0);
      expect(projectHue(name)).toBeLessThan(360);
    }
  });

  it("personal and foundation events have fixed hues", () => {
    expect(eventHue(makeEvent({ category: "personal", project: null }))).toBe(265);
    expect(eventHue(makeEvent({ category: "foundation", project: null }))).toBe(0);
    expect(eventHue(makeEvent({ category: "project", project: "httpd" }))).toBe(projectHue("httpd"));
  });
});
