/**
 * Where the app is mounted.
 *
 * The calendar usually lives at the root of a host, but it can be mounted in a
 * sub-directory instead - `https://calendar.apache.org/calendar/` rather than
 * `https://calendar.apache.org/`. The prefix is a deployment decision, not a
 * build-time one: `frontend/dist` is committed to the repository and shared
 * between deployments, so the same build has to work either way.
 *
 * The backend therefore rewrites the `<base href>` in index.html to match
 * `server.base_path` from its config, and everything here reads the answer back
 * out of `document.baseURI`. The browser uses the same tag to resolve the
 * script, stylesheet and favicon, which is why relative URLs in the page keep
 * working on a nested route such as /calendar/e/AbCd2345.
 */

/** The mount point, with no trailing slash: "" at the root, or "/calendar". */
export function basePath(): string {
  const path = baseUrl().pathname;
  return path === "/" ? "" : path.replace(/\/+$/, "");
}

/** The absolute base URL the document resolves relative URLs against. */
export function baseUrl(): URL {
  const href = globalThis.document?.baseURI;
  try {
    return new URL(href ?? "/", globalThis.location?.href ?? "http://localhost/");
  } catch {
    return new URL("http://localhost/");
  }
}

/** An absolute path within the app: appPath("/help") -> "/calendar/help". */
export function appPath(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${basePath()}${suffix}` || "/";
}

/** An absolute path to an API endpoint. */
export function apiUrl(path: string): string {
  return appPath(`/api${path.startsWith("/") ? path : `/${path}`}`);
}

/** An absolute path to a file shipped in the build, such as the logo. */
export function assetUrl(name: string): string {
  return appPath(`/${name.replace(/^\/+/, "")}`);
}

/**
 * Strips the mount point off a browser path, so route matching does not have to
 * know about it. Returns null when the path is not inside the app at all.
 */
export function withoutBase(pathname: string): string | null {
  const prefix = basePath();
  if (!prefix) return pathname || "/";
  if (pathname === prefix) return "/";
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length) || "/";
  return null;
}

/**
 * asfquart's OAuth endpoint, as mounted by this app.
 *
 * The backend hands back the real login and logout URLs in /api/session, and
 * those always win, because a deployment can move the endpoint with the
 * `oauth.uri` config key. These are the fallbacks used before that request has
 * come back, or if it fails - which is exactly when someone is most likely to
 * be reaching for the login link.
 *
 * They are not URL-encoded, for the same reason the backend does not encode
 * them: a mount point is restricted to unreserved URL characters.
 */
const DEFAULT_OAUTH_PATH = "/auth";

export function loginUrl(returnTo: string = appPath("/")): string {
  return `${appPath(DEFAULT_OAUTH_PATH)}?login=${returnTo}`;
}

export function logoutUrl(returnTo: string = appPath("/")): string {
  return `${appPath(DEFAULT_OAUTH_PATH)}?logout=${returnTo}`;
}
