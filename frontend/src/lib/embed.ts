/**
 * The embeddable agenda.
 *
 * A stripped-down list of upcoming events, meant to be dropped into another
 * site in an iframe: no header, no filter panel, no editing. Everything it
 * shows is driven by query parameters, so a site can ask for "the next ten
 * httpd events" without any JavaScript of its own.
 *
 * Session cookies are SameSite=Strict, so a cross-site iframe never carries
 * one. An embed is always an anonymous view, which means public events only.
 * That is the intended behaviour rather than a limitation to work around: a
 * page on someone else's site should not be able to show private events.
 */

import type { Category } from "./types";
import { CATEGORIES } from "./types";
import { LOCAL, isKnownZone, normaliseZone } from "./timezone";
import type { DisplayZone } from "./timezone";
import { withoutBase } from "./base";

/** The route the embed is served from, relative to the app's mount point. */
export const EMBED_PATH = "/embed/agenda";

export const DEFAULT_DAYS = 60;
export const DEFAULT_LIMIT = 20;
const MAX_DAYS = 366;
const MAX_LIMIT = 100;

export type EmbedTheme = "auto" | "light" | "dark";

export interface EmbedOptions {
  /** Categories to include. Empty means all of them. */
  categories: Category[];
  /** Projects to include. Empty means all the viewer can see. */
  projects: string[];
  /** How far ahead to look, in days. */
  days: number;
  /** How many events to show at most. */
  limit: number;
  search: string;
  zone: DisplayZone;
  /** Heading above the list, or null for none. */
  title: string | null;
  /** Whether to say which clock the times are on. */
  showZone: boolean;
  /** Drop the panel background so the host page shows through. */
  transparent: boolean;
  theme: EmbedTheme;
  /** Whether to show the "ASF Community Calendar" link at the foot. */
  showCredit: boolean;
}

export function isEmbedRoute(pathname: string): boolean {
  const route = withoutBase(pathname);
  return route === EMBED_PATH || route === `${EMBED_PATH}/`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function numberParam(params: URLSearchParams, name: string, fallback: number, low: number, high: number): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.trunc(parsed), low, high);
}

function booleanParam(params: URLSearchParams, name: string, fallback: boolean): boolean {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (raw === "") return true; // ?transparent with no value means yes
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

/** Collects a filter that may be repeated or comma-separated. */
function listParam(params: URLSearchParams, ...names: string[]): string[] {
  const collected: string[] = [];
  for (const name of names) {
    for (const raw of params.getAll(name)) {
      collected.push(...raw.split(",").map((piece) => piece.trim()));
    }
  }
  return collected.filter(Boolean);
}

export function parseEmbedOptions(search: string): EmbedOptions {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  const categories = listParam(params, "category", "categories")
    .map((name) => name.toLowerCase())
    .filter((name): name is Category => (CATEGORIES as readonly string[]).includes(name));

  const themeRaw = (params.get("theme") ?? "auto").toLowerCase();
  const theme: EmbedTheme = themeRaw === "light" || themeRaw === "dark" ? themeRaw : "auto";

  const zoneRaw = params.get("zone");
  const zone = zoneRaw && (zoneRaw.toLowerCase() === LOCAL || isKnownZone(zoneRaw))
    ? normaliseZone(zoneRaw, LOCAL)
    : LOCAL;

  const title = params.get("title");

  return {
    categories,
    projects: listParam(params, "project", "projects").map((name) => name.toLowerCase()),
    days: numberParam(params, "days", DEFAULT_DAYS, 1, MAX_DAYS),
    limit: numberParam(params, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT),
    search: params.get("q")?.trim() ?? "",
    zone,
    title: title === null ? null : title.trim() || null,
    showZone: booleanParam(params, "showzone", true),
    transparent: booleanParam(params, "transparent", false),
    theme,
    showCredit: booleanParam(params, "credit", true),
  };
}

/**
 * The message the embed posts to whatever page is framing it, so the host can
 * size the iframe to its content. Sent with a "*" target origin because we do
 * not know who is embedding us; it carries nothing but a pixel height.
 */
export const HEIGHT_MESSAGE = "asf-calendar-embed:height";

export interface HeightMessage {
  type: typeof HEIGHT_MESSAGE;
  height: number;
}

export function heightMessage(height: number): HeightMessage {
  return { type: HEIGHT_MESSAGE, height: Math.ceil(height) };
}
