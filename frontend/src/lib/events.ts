/**
 * Turning a flat list of events into something a grid can draw.
 */

import type { CalendarEvent, Category } from "./types";
import { dayKey, endOfDay, parseISO, startOfDay } from "./dates";
import type { DisplayZone } from "./timezone";
import { toWall } from "./timezone";

/**
 * The start of an event as a wall date in the display zone.
 *
 * All-day events are a date rather than an instant: the backend snaps them to
 * whole UTC days, so we rebuild them from their UTC date parts and they land on
 * the same calendar day whichever zone is being displayed.
 */
export function eventStart(event: CalendarEvent, zone: DisplayZone = "local"): Date {
  const instant = parseISO(event.start);
  if (!event.all_day) return toWall(instant, zone);
  return new Date(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
}

/**
 * The end of an event as a wall date in the display zone, exclusive.
 *
 * The backend stores an exclusive end for all-day events (midnight of the day
 * after), which is what a grid wants too.
 */
export function eventEnd(event: CalendarEvent, zone: DisplayZone = "local"): Date {
  const instant = parseISO(event.end);
  if (!event.all_day) return toWall(instant, zone);
  return new Date(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
}

export function durationMs(event: CalendarEvent): number {
  // The length of an event is the same in every zone, so read it off the
  // instants directly.
  return Math.max(0, parseISO(event.end).getTime() - parseISO(event.start).getTime());
}

/** True if the event overlaps the half-open window [from, to) of wall dates. */
export function overlaps(event: CalendarEvent, from: Date, to: Date, zone: DisplayZone = "local"): boolean {
  return eventStart(event, zone) < to && eventEnd(event, zone) > from;
}

/** True if any part of the event falls on the given day. */
export function occursOnDay(event: CalendarEvent, day: Date, zone: DisplayZone = "local"): boolean {
  return overlaps(event, startOfDay(day), endOfDay(day), zone);
}

/** True if the event covers more than a single day in the grid. */
export function isMultiDay(event: CalendarEvent, zone: DisplayZone = "local"): boolean {
  const start = eventStart(event, zone);
  const end = eventEnd(event, zone);
  if (end.getTime() <= start.getTime()) return false;
  // The end is exclusive, so an event finishing exactly at midnight still
  // belongs to the day before.
  return dayKey(start) !== dayKey(new Date(end.getTime() - 1));
}

/** The events falling on each of `days`, keyed by dayKey(). */
export function groupByDay(
  events: CalendarEvent[],
  days: Date[],
  zone: DisplayZone = "local",
): Map<string, CalendarEvent[]> {
  const buckets = new Map<string, CalendarEvent[]>();
  for (const day of days) buckets.set(dayKey(day), []);
  for (const event of events) {
    for (const day of days) {
      if (occursOnDay(event, day, zone)) buckets.get(dayKey(day))!.push(event);
    }
  }
  const order = displayComparator(zone);
  for (const bucket of buckets.values()) bucket.sort(order);
  return buckets;
}

/** All-day and longer events first, then by start time, then by title. */
export function compareForDisplay(a: CalendarEvent, b: CalendarEvent, zone: DisplayZone = "local"): number {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  const byStart = eventStart(a, zone).getTime() - eventStart(b, zone).getTime();
  if (byStart !== 0) return byStart;
  const byLength = durationMs(b) - durationMs(a);
  if (byLength !== 0) return byLength;
  return a.title.localeCompare(b.title);
}

/** compareForDisplay bound to a zone, ready to hand to Array.sort. */
export function displayComparator(zone: DisplayZone = "local") {
  return (a: CalendarEvent, b: CalendarEvent) => compareForDisplay(a, b, zone);
}

export interface PositionedEvent {
  event: CalendarEvent;
  /** Fraction of the day the event starts at, 0 to 1. */
  top: number;
  /** Fraction of the day the event occupies, greater than 0. */
  height: number;
  /** Which column of an overlapping cluster this event sits in. */
  column: number;
  /** How many columns the cluster needs. */
  columns: number;
}

const MINIMUM_HEIGHT = 20 / (24 * 60); // 20 minutes, so short events stay clickable

/**
 * Lays out one day's timed events side by side.
 *
 * Events that overlap in time are grouped into a cluster and given a column
 * each, so the caller can position them as `left: column/columns` of the
 * day's width. All-day events are not included; they belong in their own row.
 */
export function layoutDay(events: CalendarEvent[], day: Date, zone: DisplayZone = "local"): PositionedEvent[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = endOfDay(day).getTime();
  const span = dayEnd - dayStart;

  const timed = events
    .filter((event) => !event.all_day && occursOnDay(event, day, zone))
    .sort(displayComparator(zone));

  const placed: PositionedEvent[] = timed.map((event) => {
    const from = Math.max(eventStart(event, zone).getTime(), dayStart);
    const to = Math.min(eventEnd(event, zone).getTime(), dayEnd);
    return {
      event,
      top: (from - dayStart) / span,
      height: Math.max((to - from) / span, MINIMUM_HEIGHT),
      column: 0,
      columns: 1,
    };
  });

  // Walk the events in order, closing a cluster whenever a gap appears.
  let cluster: PositionedEvent[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    if (cluster.length === 0) return;
    const columns = Math.max(...cluster.map((item) => item.column)) + 1;
    for (const item of cluster) item.columns = columns;
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of placed) {
    if (item.top >= clusterEnd) closeCluster();
    // The lowest column not used by anything this event overlaps.
    const taken = new Set(
      cluster.filter((other) => other.top + other.height > item.top).map((other) => other.column),
    );
    let column = 0;
    while (taken.has(column)) column += 1;
    item.column = column;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.top + item.height);
  }
  closeCluster();

  return placed;
}

/** The all-day (or multi-day) events on a given day. */
export function allDayEvents(events: CalendarEvent[], day: Date, zone: DisplayZone = "local"): CalendarEvent[] {
  return events
    .filter((event) => event.all_day && occursOnDay(event, day, zone))
    .sort(displayComparator(zone));
}

/** Groups a sorted list into day sections, for the agenda view. */
export function agendaSections(
  events: CalendarEvent[],
  zone: DisplayZone = "local",
): { key: string; date: Date; events: CalendarEvent[] }[] {
  const sections: { key: string; date: Date; events: CalendarEvent[] }[] = [];
  const seen = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const date = eventStart(event, zone);
    const key = dayKey(date);
    let bucket = seen.get(key);
    if (!bucket) {
      bucket = [];
      seen.set(key, bucket);
      sections.push({ key, date: startOfDay(date), events: bucket });
    }
    bucket.push(event);
  }
  return sections;
}

// ---- presentation ---------------------------------------------------------

/** A short label for the calendar an event belongs to. */
export function calendarLabel(event: CalendarEvent): string {
  if (event.category === "project") return event.project ?? "project";
  if (event.category === "foundation") return "foundation";
  return "personal";
}

const PROJECT_HUES = [8, 28, 48, 96, 150, 176, 200, 220, 256, 286, 310, 335];

/**
 * A stable hue for a project, so the same project keeps its colour between
 * sessions and machines without us having to store one.
 */
export function projectHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return PROJECT_HUES[hash % PROJECT_HUES.length];
}

/** The CSS custom-property value used to tint an event chip. */
export function eventHue(event: CalendarEvent): number {
  if (event.category === "personal") return 265;
  if (event.category === "foundation") return 0;
  return projectHue(event.project ?? "");
}

export function categoryLabel(category: Category): string {
  switch (category) {
    case "personal":
      return "Personal";
    case "project":
      return "Project";
    case "foundation":
      return "Foundation";
  }
}
