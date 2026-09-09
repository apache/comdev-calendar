/**
 * Timezone handling.
 *
 * There are two separate ideas here, and it helps to keep them apart:
 *
 * - The **event timezone** is what the organiser meant when they typed the
 *   times in: "15:00 in Berlin". It is stored with the event.
 * - The **display timezone** is what the person looking at the calendar wants
 *   to read it in, and is either their browser's own zone or UTC.
 *
 * The instant itself is always the same; only the wall clock changes.
 *
 * Everything below works with "wall dates". A wall date is an ordinary `Date`
 * whose *local* getters (getHours, getDate, ...) read as the wall clock in some
 * other zone. That means the existing calendar-grid arithmetic keeps working
 * unchanged - it just operates on wall dates rather than on instants - and only
 * the edges of the app have to convert.
 */

export type DisplayZone = "local" | "utc";

export const DISPLAY_ZONES: readonly DisplayZone[] = ["local", "utc"];

/** Offset of the browser's own zone at an instant, in ms east of UTC. */
export function localOffsetMs(instant: Date): number {
  return -instant.getTimezoneOffset() * 60_000;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Offset of an IANA zone at an instant, in ms east of UTC.
 *
 * There is no direct API for this, so we ask Intl what the wall clock is in
 * that zone and compare it with the wall clock in UTC.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = partsFormatter(timeZone).formatToParts(instant);
  } catch {
    // An unknown zone should not take the page down with it.
    return 0;
  }
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  // Compare whole seconds; Intl has no milliseconds to give us.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * An instant, as a wall date in `timeZone`.
 *
 * The browser offset used for the conversion depends on the result, so we
 * solve for it: one correction is enough except for instants an hour either
 * side of a daylight-saving change, where a second settles it.
 */
export function toWallInZone(instant: Date, timeZone: string): Date {
  const target = instant.getTime() + zoneOffsetMs(instant, timeZone);
  let wall = new Date(target - localOffsetMs(instant));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const corrected = new Date(target - localOffsetMs(wall));
    if (corrected.getTime() === wall.getTime()) return wall;
    wall = corrected;
  }
  return wall;
}

/** A wall date in `timeZone`, back to the instant it names. */
export function fromWallInZone(wall: Date, timeZone: string): Date {
  const target = wall.getTime() + localOffsetMs(wall);
  let instant = new Date(target - zoneOffsetMs(wall, timeZone));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const corrected = new Date(target - zoneOffsetMs(instant, timeZone));
    if (corrected.getTime() === instant.getTime()) return instant;
    instant = corrected;
  }
  return instant;
}

/** An instant, as a wall date in the chosen display zone. */
export function toWall(instant: Date, zone: DisplayZone): Date {
  return zone === "local" ? new Date(instant.getTime()) : toWallInZone(instant, "UTC");
}

/** A wall date in the chosen display zone, back to the instant it names. */
export function fromWall(wall: Date, zone: DisplayZone): Date {
  return zone === "local" ? new Date(wall.getTime()) : fromWallInZone(wall, "UTC");
}

/** Right now, as a wall date in the chosen display zone. */
export function nowInZone(zone: DisplayZone): Date {
  return toWall(new Date(), zone);
}

/** The browser's own IANA zone name, or UTC if it will not say. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Formats an offset in milliseconds as "UTC+02:00". */
export function offsetLabel(offsetMs: number): string {
  if (offsetMs === 0) return "UTC";
  const sign = offsetMs < 0 ? "-" : "+";
  const total = Math.abs(Math.round(offsetMs / 60_000));
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

/** The short name a zone goes by right now, such as "CEST" or "GMT+5:30". */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(instant);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** What to put on the display-zone switch, e.g. "Local (CEST)". */
export function describeDisplayZone(zone: DisplayZone, at: Date = new Date()): string {
  if (zone === "utc") return "UTC";
  const name = browserZone();
  return `${zoneAbbreviation(at, name)} (${offsetLabel(localOffsetMs(at))})`;
}

/** A longer description, for tooltips and the help page. */
export function explainDisplayZone(zone: DisplayZone): string {
  if (zone === "utc") return "Times are shown in UTC.";
  return `Times are shown in ${browserZone()}, your browser's timezone.`;
}

/**
 * The zones to offer in the event form.
 *
 * Modern browsers can list every zone they know. Where they cannot, fall back
 * to a short list that covers the places ASF contributors tend to be, with the
 * browser's own zone added so it is always selectable.
 */
const FALLBACK_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function zoneList(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  let names: string[];
  try {
    names = supported ? supported("timeZone") : [...FALLBACK_ZONES];
  } catch {
    names = [...FALLBACK_ZONES];
  }
  const all = new Set<string>(["UTC", browserZone(), ...names]);
  return [...all].sort();
}
