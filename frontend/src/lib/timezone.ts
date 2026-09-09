/**
 * Timezone handling.
 *
 * There are three separate ideas here, and it helps to keep them apart:
 *
 * - The **event timezone** is what the organiser meant when they typed the
 *   times in: "15:00 in Berlin". It is stored with the event.
 * - The **display timezone** is the clock the reader wants the calendar drawn
 *   on. A grid has one time axis, so there is exactly one of these.
 * - **Comparison timezones** are extra clocks shown alongside, so you can see
 *   at a glance what 15:00 in Berlin is where you are.
 *
 * The instant itself is always the same; only the wall clock changes.
 *
 * Everything below works with "wall dates". A wall date is an ordinary `Date`
 * whose *local* getters (getHours, getDate, ...) read as the wall clock in some
 * other zone. That means the existing calendar-grid arithmetic keeps working
 * unchanged - it just operates on wall dates rather than on instants - and only
 * the edges of the app have to convert.
 */

import { formatTime } from "./dates";

/**
 * A zone to display in: an IANA name such as "Europe/Berlin", or the sentinel
 * "local" meaning whatever the browser's own zone happens to be. The sentinel
 * is kept rather than resolved once, so a laptop that moves keeps up.
 */
export type DisplayZone = string;

export const LOCAL: DisplayZone = "local";
export const UTC = "UTC";

export function isLocal(zone: DisplayZone): boolean {
  return zone === LOCAL;
}

/** The IANA name a display zone refers to. */
export function resolveZone(zone: DisplayZone): string {
  return isLocal(zone) ? browserZone() : zone;
}

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
  // The browser's own zone needs no conversion, and taking the short cut keeps
  // it exact even if Intl does not recognise the name the browser reports.
  return isLocal(zone) ? new Date(instant.getTime()) : toWallInZone(instant, zone);
}

/** A wall date in the chosen display zone, back to the instant it names. */
export function fromWall(wall: Date, zone: DisplayZone): Date {
  return isLocal(zone) ? new Date(wall.getTime()) : fromWallInZone(wall, zone);
}

/** Right now, as a wall date in the chosen display zone. */
export function nowInZone(zone: DisplayZone): Date {
  return toWall(new Date(), zone);
}

/** The browser's own IANA zone name, or UTC if it will not say. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || UTC;
  } catch {
    return UTC;
  }
}

/** Formats an offset in milliseconds as "UTC+02:00". */
export function offsetLabel(offsetMs: number): string {
  if (offsetMs === 0) return UTC;
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

// ---- naming ---------------------------------------------------------------

/**
 * The place an IANA zone is named after: "Europe/Copenhagen" is Copenhagen,
 * "America/Argentina/Buenos_Aires" is Buenos Aires.
 *
 * These names are how the tz database identifies a zone, not a claim about
 * where the reader is, but they are a good deal more meaningful than "UTC+2"
 * on its own.
 */
export function zoneCity(timeZone: string): string {
  if (timeZone === UTC) return UTC;
  const segments = timeZone.split("/");
  return (segments[segments.length - 1] ?? timeZone).replace(/_/g, " ");
}

/** The part of the world a zone is filed under: "Europe", "America". */
export function zoneRegion(timeZone: string): string {
  if (timeZone === UTC) return UTC;
  return timeZone.split("/")[0] ?? "";
}

/** "Copenhagen (CEST, UTC+02:00)" - the city, and why that clock. */
export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  const offset = offsetLabel(zoneOffsetMs(at, timeZone));
  const abbreviation = zoneAbbreviation(at, timeZone);
  if (timeZone === UTC) return UTC;
  // Intl falls back to "GMT+2" when a zone has no letter abbreviation, which
  // would just repeat the offset.
  if (abbreviation.startsWith("GMT") || abbreviation === offset) {
    return `${zoneCity(timeZone)} (${offset})`;
  }
  return `${zoneCity(timeZone)} (${abbreviation}, ${offset})`;
}

/** How a display zone is named in the UI, spelling out what "local" resolves to. */
export function describeDisplayZone(zone: DisplayZone, at: Date = new Date()): string {
  const resolved = resolveZone(zone);
  return isLocal(zone) ? `Local - ${zoneLabel(resolved, at)}` : zoneLabel(resolved, at);
}

/** The compact form used where there is no room, such as a column heading. */
export function shortZoneLabel(zone: DisplayZone, at: Date = new Date()): string {
  const resolved = resolveZone(zone);
  if (resolved === UTC) return UTC;
  const abbreviation = zoneAbbreviation(at, resolved);
  if (abbreviation.startsWith("GMT")) return zoneCity(resolved);
  return abbreviation;
}

/** A longer description, for tooltips and the help page. */
export function explainDisplayZone(zone: DisplayZone, at: Date = new Date()): string {
  const resolved = resolveZone(zone);
  if (isLocal(zone)) {
    return `Times are shown in ${resolved}, your browser's timezone (${zoneLabel(resolved, at)}).`;
  }
  return `Times are shown in ${resolved} (${zoneLabel(resolved, at)}).`;
}

// ---- the zones on offer ---------------------------------------------------

/**
 * The zones the display picker offers, grouped for an <optgroup>.
 *
 * This is a deliberately short list of well-known zones rather than all ~400
 * the tz database knows, because it is a "show me this calendar in Tokyo time"
 * control, not a data-entry field. The event form uses the full list, since an
 * organiser really might be anywhere.
 */
export const MAJOR_ZONES: { region: string; zones: string[] }[] = [
  { region: "Coordinated", zones: [UTC] },
  {
    region: "Americas",
    zones: [
      "Pacific/Honolulu",
      "America/Anchorage",
      "America/Los_Angeles",
      "America/Denver",
      "America/Chicago",
      "America/New_York",
      "America/Halifax",
      "America/Bogota",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
    ],
  },
  {
    region: "Europe and Africa",
    zones: [
      "Europe/London",
      "Europe/Lisbon",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Madrid",
      "Europe/Rome",
      "Europe/Stockholm",
      "Europe/Warsaw",
      "Europe/Athens",
      "Europe/Kyiv",
      "Europe/Moscow",
      "Africa/Casablanca",
      "Africa/Lagos",
      "Africa/Cairo",
      "Africa/Nairobi",
      "Africa/Johannesburg",
    ],
  },
  {
    region: "Asia",
    zones: [
      "Asia/Jerusalem",
      "Asia/Dubai",
      "Asia/Karachi",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Asia/Dhaka",
      "Asia/Bangkok",
      "Asia/Jakarta",
      "Asia/Shanghai",
      "Asia/Hong_Kong",
      "Asia/Singapore",
      "Asia/Seoul",
      "Asia/Tokyo",
    ],
  },
  {
    region: "Oceania",
    zones: [
      "Australia/Perth",
      "Australia/Adelaide",
      "Australia/Brisbane",
      "Australia/Sydney",
      "Pacific/Auckland",
    ],
  },
];

/** Every zone in MAJOR_ZONES, flattened. */
export function majorZones(): string[] {
  return MAJOR_ZONES.flatMap((group) => group.zones);
}

/** True if the string names a zone this browser can actually work with. */
export function isKnownZone(timeZone: string): boolean {
  if (!timeZone || timeZone === LOCAL) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zones to offer in the event form.
 *
 * Modern browsers can list every zone they know. Where they cannot, fall back
 * to the major list, with the browser's own zone added so it is always
 * selectable.
 */
export function zoneList(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  let names: string[];
  try {
    names = supported ? supported("timeZone") : majorZones();
  } catch {
    names = majorZones();
  }
  const all = new Set<string>([UTC, browserZone(), ...names]);
  return [...all].sort();
}

/**
 * Tidies a stored or configured display zone into one we can use.
 *
 * Accepts the "local"/"utc" spellings the two-way switch used to store, so an
 * existing preference survives the upgrade.
 */
export function normaliseZone(value: string | null | undefined, fallback: DisplayZone = UTC): DisplayZone {
  const text = (value ?? "").trim();
  if (!text) return fallback;
  if (text.toLowerCase() === LOCAL) return LOCAL;
  if (text.toLowerCase() === "utc") return UTC;
  return isKnownZone(text) ? text : fallback;
}

/**
 * Drops duplicates and anything already shown as the primary zone.
 *
 * "local" and the IANA name it resolves to are the same clock, so only one of
 * them is worth a column.
 */
export function uniqueZones(zones: DisplayZone[], primary?: DisplayZone): DisplayZone[] {
  const seen = new Set<string>(primary === undefined ? [] : [resolveZone(primary)]);
  const kept: DisplayZone[] = [];
  for (const zone of zones) {
    const resolved = resolveZone(zone);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    kept.push(zone);
  }
  return kept;
}

/**
 * The clock reading in `other` for each hour of `day` as measured in `primary`.
 *
 * This is what fills the extra hour gutters in the week and day views: row 9 of
 * the grid is 09:00 in the primary zone, and this says what that same instant
 * reads as somewhere else.
 *
 * A week view shares one gutter across all seven columns, so the caller passes
 * a single reference day. The offset between two zones almost never changes
 * mid-week; when it does, because one of them shifts for daylight saving, the
 * labels are right for the reference day and an hour out for the rest.
 */
export function hourLabels(day: Date, primary: DisplayZone, other: DisplayZone, hours = 24): string[] {
  return Array.from({ length: hours }, (_unused, hour) => {
    const wall = new Date(day);
    wall.setHours(hour, 0, 0, 0);
    return formatTime(toWall(fromWall(wall, primary), other));
  });
}
