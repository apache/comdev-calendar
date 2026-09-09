/**
 * Importing an iCalendar file.
 *
 * The file itself is read by the backend, which knows how to cope with what
 * Google, Outlook and Thunderbird produce. What lives here is the decision the
 * backend cannot make: which calendar the events should land in.
 *
 * That decision is deliberately not defaulted. An import can create dozens of
 * events at once, and a wrong default would publish somebody's private meetings
 * or file them under the wrong project, so the form starts with nothing chosen
 * and `importReadiness` reports what is still missing.
 */

import type { Calendars, Category, Visibility } from "./types";

/** An event the backend found in the file, before it is given a calendar. */
export interface ImportCandidate {
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  description: string;
  location: string;
  url: string;
  timezone: string;
  uid: string | null;
  /** What the backend had to change to make this event importable. */
  warnings: string[];
}

export interface ImportPreview {
  events: ImportCandidate[];
  count: number;
  /** Problems with the file as a whole, such as entries that were skipped. */
  warnings: string[];
}

export interface ImportResult {
  created: import("./types").CalendarEvent[];
  count: number;
  warnings: string[];
}

/** What the form collects. Null means "not chosen yet", not "default". */
export interface ImportSettings {
  category: Category | null;
  project: string | null;
  visibility: Visibility | null;
}

/** The same thing once every required answer is in. */
export interface ResolvedImportSettings {
  category: Category;
  project: string | null;
  visibility: Visibility | null;
}

export function emptySettings(): ImportSettings {
  return { category: null, project: null, visibility: null };
}

/** The calendars this session may import into, in the order to offer them. */
export function importableCategories(calendars: Calendars | null): Category[] {
  const can = calendars?.can_create;
  if (!can) return [];
  const categories: Category[] = [];
  if (can.personal) categories.push("personal");
  if (can.project.length > 0) categories.push("project");
  if (can.foundation) categories.push("foundation");
  return categories;
}

/**
 * The projects that can take an import, which depends on the visibility: a
 * committer can add public events to their projects, but a private one needs
 * the committee.
 */
export function importableProjects(
  calendars: Calendars | null,
  visibility: Visibility | null,
): string[] {
  const can = calendars?.can_create;
  if (!can) return [];
  return visibility === "private" ? can.project_private : can.project;
}

export function importableVisibilities(
  category: Category | null,
  calendars: Calendars | null,
): Visibility[] {
  if (category === "personal") return [];
  if (category === "foundation") return calendars?.can_create.foundation ? ["public", "private"] : [];
  if (category === "project") {
    const can = calendars?.can_create;
    if (!can) return [];
    return can.project_private.length > 0 ? ["public", "private"] : ["public"];
  }
  return [];
}

export interface Readiness {
  ready: boolean;
  /** What the reader still has to answer, in words fit for a hint. */
  missing: string[];
}

/**
 * Whether the form has enough to save, and what is missing if not.
 *
 * Personal events have no project and no visibility to choose - they are
 * always private to their owner - so those are not asked for.
 */
export function importReadiness(settings: ImportSettings, calendars: Calendars | null): Readiness {
  const missing: string[] = [];

  const categories = importableCategories(calendars);
  if (settings.category === null) {
    missing.push("which calendar these events belong to");
  } else if (!categories.includes(settings.category)) {
    missing.push("a calendar you are allowed to add to");
  }

  if (settings.category !== null && settings.category !== "personal") {
    if (settings.visibility === null) {
      missing.push("whether they are public or private");
    } else if (!importableVisibilities(settings.category, calendars).includes(settings.visibility)) {
      missing.push("a visibility you are allowed to use");
    }
  }

  if (settings.category === "project") {
    const projects = importableProjects(calendars, settings.visibility);
    if (settings.project === null) {
      missing.push("which project they belong to");
    } else if (!projects.includes(settings.project)) {
      missing.push("a project you are allowed to add to");
    }
  }

  return { ready: missing.length === 0, missing };
}

/** The settings, once ready, in the shape the API takes. */
export function resolveSettings(settings: ImportSettings): ResolvedImportSettings {
  if (settings.category === null) throw new Error("resolveSettings called before a category was chosen");
  return {
    category: settings.category,
    project: settings.category === "project" ? settings.project : null,
    visibility: settings.category === "personal" ? null : settings.visibility,
  };
}

/**
 * Keeps the form consistent when the category or visibility changes: a project
 * that is no longer offered should not stay quietly selected.
 */
export function reconcile(settings: ImportSettings, calendars: Calendars | null): ImportSettings {
  const next: ImportSettings = { ...settings };
  if (next.category !== "project") next.project = null;
  if (next.category === "personal") next.visibility = null;
  if (next.category === "project" && next.project !== null) {
    if (!importableProjects(calendars, next.visibility).includes(next.project)) next.project = null;
  }
  if (next.visibility !== null && next.category !== null) {
    if (!importableVisibilities(next.category, calendars).includes(next.visibility)) {
      next.visibility = null;
    }
  }
  return next;
}

/** True if the file looks like something worth sending. */
export function looksLikeCalendar(file: File): boolean {
  return /\.ics$/i.test(file.name) || file.type === "text/calendar";
}
