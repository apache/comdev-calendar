/** Builders for the fixtures the tests share. */

import type { CalendarEvent, Calendars, Category, Visibility } from "../lib/types";

let nextId = 1;

export function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const id = overrides.id ?? nextId++;
  const shortlink = overrides.shortlink ?? `Ev${String(id).padStart(6, "2")}`;
  return {
    id,
    shortlink,
    shortlink_url: `https://calendar.example.org/e/${shortlink}`,
    title: `Event ${id}`,
    category: "project" as Category,
    visibility: "public" as Visibility,
    start: "2026-03-10T09:00:00Z",
    end: "2026-03-10T10:00:00Z",
    all_day: false,
    description: "",
    location: "",
    url: "",
    project: "httpd",
    timezone: "UTC",
    owner: "alice",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeCalendars(overrides: Partial<Calendars> = {}): Calendars {
  const projects = overrides.projects ?? ["httpd", "tomcat"];
  const committees = overrides.committees ?? ["httpd"];
  return {
    uid: "alice",
    authenticated: true,
    is_member: false,
    projects,
    committees,
    can_create: {
      personal: true,
      project: projects,
      project_private: committees,
      foundation: false,
    },
    title: "ASF Community Calendar",
    default_display_zone: "local",
    ...overrides,
  };
}

export const anonymousCalendars: Calendars = {
  uid: null,
  authenticated: false,
  is_member: false,
  projects: [],
  committees: [],
  can_create: { personal: false, project: [], project_private: [], foundation: false },
  title: "ASF Community Calendar",
  default_display_zone: "local",
};
