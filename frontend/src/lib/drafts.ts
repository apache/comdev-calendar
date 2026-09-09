/**
 * Building and checking event drafts.
 *
 * `canEdit` mirrors the backend's permission rules. It only decides whether to
 * show an Edit button; the backend is still the authority and will refuse a
 * request the rules do not allow.
 */

import type { CalendarEvent, Calendars, Category, EventDraft, Visibility } from "./types";
import { HOUR, startOfDay, toISO } from "./dates";
import { browserZone } from "./timezone";

/** The default length of a new timed event. */
export const DEFAULT_LENGTH_MS = HOUR;

/** The first calendar the user can actually write to. */
export function defaultCategory(calendars: Calendars | null): Category | null {
  const can = calendars?.can_create;
  if (!can) return null;
  if (can.project.length > 0) return "project";
  if (can.personal) return "personal";
  if (can.foundation) return "foundation";
  return null;
}

export function canCreateAnything(calendars: Calendars | null): boolean {
  return defaultCategory(calendars) !== null;
}

/**
 * A blank draft starting at `when`.
 *
 * If `when` is midnight (the user clicked a day rather than a time slot) the
 * event is nudged to 09:00, which is a more useful default than "all day at
 * the stroke of midnight".
 */
export function newDraft(when: Date, calendars: Calendars | null, timezone?: string): EventDraft {
  const category = defaultCategory(calendars) ?? "personal";
  const start = new Date(when);
  if (start.getTime() === startOfDay(when).getTime()) start.setHours(9, 0, 0, 0);

  return {
    title: "",
    category,
    visibility: category === "personal" ? "private" : "public",
    start: toISO(start),
    end: toISO(new Date(start.getTime() + DEFAULT_LENGTH_MS)),
    all_day: false,
    description: "",
    location: "",
    url: "",
    project: category === "project" ? (calendars?.can_create.project[0] ?? null) : null,
    // New events are entered in the organiser's own timezone by default.
    timezone: timezone ?? browserZone(),
  };
}

export function draftFromEvent(event: CalendarEvent): EventDraft {
  return {
    title: event.title,
    category: event.category,
    visibility: event.visibility,
    start: event.start,
    end: event.end,
    all_day: event.all_day,
    description: event.description,
    location: event.location,
    url: event.url,
    project: event.project,
    timezone: event.timezone || "UTC",
  };
}

/** Whether the signed-in user may edit or delete this event. */
export function canEdit(event: CalendarEvent, calendars: Calendars | null): boolean {
  if (!calendars?.authenticated) return false;

  switch (event.category) {
    case "personal":
      return event.owner === calendars.uid;
    case "foundation":
      return calendars.is_member;
    case "project": {
      const project = event.project ?? "";
      if (!project) return false;
      if (event.visibility === "private") return calendars.committees.includes(project);
      return calendars.projects.includes(project);
    }
  }
}

/** Whether the visibility can be offered for a category the user may write. */
export function allowedVisibilities(category: Category, calendars: Calendars | null): Visibility[] {
  if (category === "personal") return ["private"];
  if (category === "foundation") return calendars?.can_create.foundation ? ["public", "private"] : [];
  return (calendars?.can_create.project_private.length ?? 0) > 0 ? ["public", "private"] : ["public"];
}
