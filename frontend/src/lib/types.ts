/** Shared types. These mirror the JSON the backend produces. */

export type Category = "personal" | "project" | "foundation";
export type Visibility = "public" | "private";
export type ViewName = "day" | "week" | "month" | "year" | "agenda";
export type SortName = "start" | "-start" | "title" | "-title";

export const CATEGORIES: readonly Category[] = ["personal", "project", "foundation"];
export const VIEWS: readonly ViewName[] = ["day", "week", "month", "year", "agenda"];

export interface CalendarEvent {
  id: number;
  shortlink: string;
  shortlink_url: string;
  title: string;
  category: Category;
  visibility: Visibility;
  /** ISO 8601 UTC, e.g. 2026-01-01T10:00:00Z */
  start: string;
  end: string;
  all_day: boolean;
  description: string;
  location: string;
  url: string;
  project: string | null;
  /** The IANA zone the organiser entered the times in, e.g. "Europe/Berlin". */
  timezone: string;
  owner: string;
  created_at: string;
  updated_at: string;
}

/** The shape POSTed or PUT to /api/events. */
export interface EventDraft {
  title: string;
  category: Category;
  visibility: Visibility;
  start: string;
  end: string;
  all_day: boolean;
  description: string;
  location: string;
  url: string;
  project: string | null;
  timezone: string;
}

export interface SessionInfo {
  authenticated: boolean;
  uid?: string | null;
  fullname?: string | null;
  email?: string | null;
  is_member?: boolean;
  is_chair?: boolean;
  projects?: string[];
  committees?: string[];
  login_url?: string;
  logout_url?: string;
}

export interface Calendars {
  uid: string | null;
  authenticated: boolean;
  is_member: boolean;
  projects: string[];
  committees: string[];
  can_create: {
    personal: boolean;
    project: string[];
    project_private: string[];
    foundation: boolean;
  };
  title: string;
  /** "local", or an IANA zone name such as "UTC" or "Europe/Berlin". */
  default_display_zone: string;
}

export interface Filters {
  categories: Set<Category>;
  /** Empty means "every project the events happen to belong to". */
  projects: Set<string>;
  visibility: Visibility | "all";
  search: string;
  sort: SortName;
}
