/**
 * The API client.
 *
 * Paths here are given relative to /api; apiUrl() puts the deployment's mount
 * point in front, so the client works whether the app is served from the root
 * of a host or from a sub-directory.
 *
 * Every request carries X-No-Redirect so asfquart answers an unauthenticated
 * API call with a 401 instead of bouncing the fetch to the OAuth provider.
 */

import type { CalendarEvent, Calendars, EventDraft, SessionInfo } from "./types";
import type { ImportPreview, ImportResult, ResolvedImportSettings } from "./importing";
import { apiUrl } from "./base";

export class ApiError extends Error {
  readonly status: number;
  readonly field: string | null;

  constructor(message: string, status: number, field: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }

  /** True when logging in might fix it. */
  get needsLogin(): boolean {
    return this.status === 401;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // FormData carries its own multipart boundary, so the browser has to set the
  // content type; naming it ourselves would produce a body nothing can parse.
  const isUpload = typeof FormData !== "undefined" && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-No-Redirect": "1",
        ...(body === undefined || isUpload ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: isUpload ? (body as FormData) : JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("Could not reach the calendar service.", 0);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const details = (parsed ?? {}) as { error?: string; field?: string };
    throw new ApiError(
      details.error ?? `Request failed with status ${response.status}`,
      response.status,
      details.field ?? null,
    );
  }

  return parsed as T;
}

export interface EventQuery {
  start?: Date | string;
  end?: Date | string;
  categories?: readonly string[];
  projects?: readonly string[];
  visibility?: string;
  owner?: string;
  q?: string;
  sort?: string;
  limit?: number;
}

export function buildQuery(query: EventQuery): string {
  const params = new URLSearchParams();
  const stamp = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);
  if (query.start) params.set("start", stamp(query.start));
  if (query.end) params.set("end", stamp(query.end));
  for (const category of query.categories ?? []) params.append("category", category);
  for (const project of query.projects ?? []) params.append("project", project);
  if (query.visibility && query.visibility !== "all") params.set("visibility", query.visibility);
  if (query.owner) params.set("owner", query.owner);
  if (query.q) params.set("q", query.q);
  if (query.sort) params.set("sort", query.sort);
  if (query.limit) params.set("limit", String(query.limit));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export const api = {
  session: () => request<SessionInfo>("GET", "/session"),

  calendars: () => request<Calendars>("GET", "/calendars"),

  events: async (query: EventQuery = {}): Promise<CalendarEvent[]> => {
    const body = await request<{ events: CalendarEvent[] }>("GET", `/events${buildQuery(query)}`);
    return body.events;
  },

  event: async (id: number): Promise<CalendarEvent> => {
    const body = await request<{ event: CalendarEvent }>("GET", `/events/${id}`);
    return body.event;
  },

  byShortlink: async (token: string): Promise<CalendarEvent> => {
    const body = await request<{ event: CalendarEvent }>("GET", `/shortlink/${encodeURIComponent(token)}`);
    return body.event;
  },

  create: async (draft: EventDraft): Promise<CalendarEvent> => {
    const body = await request<{ event: CalendarEvent }>("POST", "/events", draft);
    return body.event;
  },

  update: async (id: number, draft: EventDraft): Promise<CalendarEvent> => {
    const body = await request<{ event: CalendarEvent }>("PUT", `/events/${id}`, draft);
    return body.event;
  },

  remove: (id: number) => request<{ deleted: number }>("DELETE", `/events/${id}`),

  /** Reads an .ics file and says what is in it, without saving anything. */
  previewImport: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<ImportPreview>("POST", "/import/preview", body);
  },

  /** Turns an .ics file into events on the chosen calendar. */
  runImport: (file: File, settings: ResolvedImportSettings) => {
    const body = new FormData();
    body.append("file", file);
    body.append("category", settings.category);
    if (settings.visibility) body.append("visibility", settings.visibility);
    if (settings.project) body.append("project", settings.project);
    return request<ImportResult>("POST", "/import", body);
  },

  icsUrl: (id: number) => apiUrl(`/events/${id}.ics`),

  feedUrl: (query: EventQuery = {}) => apiUrl(`/events.ics${buildQuery(query)}`),
};
