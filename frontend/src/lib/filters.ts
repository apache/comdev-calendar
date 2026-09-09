/**
 * Client-side filtering and sorting.
 *
 * The backend already restricts what a session may see; these filters are
 * about what the user wants to look at right now.
 */

import type { CalendarEvent, Calendars, Category, Filters, SortName } from "./types";
import { CATEGORIES } from "./types";
import { displayComparator, eventStart } from "./events";
import type { DisplayZone } from "./timezone";

/**
 * The filter state a freshly loaded page starts with.
 *
 * When logged in, everything the user can reach is on: their own events, every
 * project they belong to, and the foundation calendar. That matches the way
 * people use a calendar - they want to see their week, not configure it first.
 */
export function defaultFilters(calendars: Calendars | null): Filters {
  return {
    categories: new Set<Category>(CATEGORIES),
    projects: new Set<string>(calendars?.projects ?? []),
    visibility: "all",
    search: "",
    sort: "start",
  };
}

/** True if the filters are letting everything through. */
export function isUnfiltered(filters: Filters, calendars: Calendars | null): boolean {
  const projects = calendars?.projects ?? [];
  return (
    filters.categories.size === CATEGORIES.length &&
    filters.projects.size === projects.length &&
    filters.visibility === "all" &&
    filters.search.trim() === ""
  );
}

/**
 * Whether a single event passes the current filters.
 *
 * The project filter only applies to project events; it would be surprising if
 * unticking a project also hid the foundation calendar. An event belonging to
 * a project the user is not a member of (a public one they can still see) is
 * shown whenever the project filter has not been narrowed.
 */
export function matches(event: CalendarEvent, filters: Filters, knownProjects: readonly string[] = []): boolean {
  if (!filters.categories.has(event.category)) return false;

  if (event.category === "project") {
    const project = event.project ?? "";
    const isKnown = knownProjects.includes(project);
    if (isKnown && !filters.projects.has(project)) return false;
  }

  if (filters.visibility !== "all" && event.visibility !== filters.visibility) return false;

  const needle = filters.search.trim().toLowerCase();
  if (needle) {
    const haystack = [event.title, event.description, event.location, event.project ?? ""]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

export function applyFilters(
  events: CalendarEvent[],
  filters: Filters,
  knownProjects: readonly string[] = [],
): CalendarEvent[] {
  return events.filter((event) => matches(event, filters, knownProjects));
}

export function sortEvents(
  events: CalendarEvent[],
  sort: SortName,
  zone: DisplayZone = "local",
): CalendarEvent[] {
  const sorted = [...events];
  switch (sort) {
    case "-start":
      sorted.sort((a, b) => eventStart(b, zone).getTime() - eventStart(a, zone).getTime());
      break;
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "-title":
      sorted.sort((a, b) => b.title.localeCompare(a.title));
      break;
    case "start":
    default:
      sorted.sort(displayComparator(zone));
      break;
  }
  return sorted;
}

/** Every project mentioned by the loaded events, plus the user's own. */
export function projectsInPlay(events: CalendarEvent[], calendars: Calendars | null): string[] {
  const names = new Set<string>(calendars?.projects ?? []);
  for (const event of events) {
    if (event.category === "project" && event.project) names.add(event.project);
  }
  return [...names].sort();
}

/** Toggles a value in a Set, returning a new Set so Svelte notices. */
export function toggle<T>(values: Set<T>, value: T): Set<T> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
