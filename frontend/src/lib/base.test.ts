/**
 * The mount point.
 *
 * jsdom resolves document.baseURI through any <base> tag in the document, the
 * same as a browser, so these tests can put the app in a sub-directory by
 * adding one.
 */

import { afterEach, describe, expect, it } from "vitest";
import { apiUrl, appPath, basePath, baseUrl, loginUrl, logoutUrl, withoutBase } from "./base";

function mountAt(href: string): void {
  const tag = document.createElement("base");
  tag.setAttribute("href", href);
  document.head.appendChild(tag);
}

afterEach(() => {
  for (const tag of [...document.head.querySelectorAll("base")]) tag.remove();
});

describe("at the root of a host", () => {
  it("has an empty prefix", () => {
    expect(basePath()).toBe("");
  });

  it("builds app paths", () => {
    expect(appPath("/help")).toBe("/help");
    expect(appPath("help")).toBe("/help");
    expect(appPath("/")).toBe("/");
  });

  it("builds API paths", () => {
    expect(apiUrl("/events")).toBe("/api/events");
    expect(apiUrl("events/3.ics")).toBe("/api/events/3.ics");
  });

  it("passes route paths through unchanged", () => {
    expect(withoutBase("/help")).toBe("/help");
    expect(withoutBase("/e/AbCd2345")).toBe("/e/AbCd2345");
    expect(withoutBase("/")).toBe("/");
  });
});

describe("the OAuth fallback URLs", () => {
  it("point at the root when the app is served there", () => {
    expect(loginUrl()).toBe("/auth?login=/");
    expect(logoutUrl()).toBe("/auth?logout=/");
  });

  it("carry the mount point when the app is in a sub-directory", () => {
    mountAt("/calendar/");
    expect(loginUrl()).toBe("/calendar/auth?login=/calendar/");
    expect(logoutUrl()).toBe("/calendar/auth?logout=/calendar/");
  });

  it("can be pointed back at a specific page", () => {
    mountAt("/calendar/");
    expect(loginUrl(appPath("/help"))).toBe("/calendar/auth?login=/calendar/help");
  });
});

describe("in a sub-directory", () => {
  it("reads the prefix off the base tag", () => {
    mountAt("/calendar/");
    expect(basePath()).toBe("/calendar");
    expect(baseUrl().pathname).toBe("/calendar/");
  });

  it("copes with a base href that has no trailing slash", () => {
    mountAt("/calendar");
    expect(basePath()).toBe("/calendar");
  });

  it("copes with an absolute base href", () => {
    mountAt("https://calendar.apache.org/calendar/");
    expect(basePath()).toBe("/calendar");
  });

  it("handles a prefix more than one segment deep", () => {
    mountAt("/tools/calendar/");
    expect(basePath()).toBe("/tools/calendar");
    expect(apiUrl("/events")).toBe("/tools/calendar/api/events");
  });

  it("prefixes app paths", () => {
    mountAt("/calendar/");
    expect(appPath("/help")).toBe("/calendar/help");
    expect(appPath("/")).toBe("/calendar/");
  });

  it("prefixes API paths", () => {
    mountAt("/calendar/");
    expect(apiUrl("/events")).toBe("/calendar/api/events");
    expect(apiUrl("/shortlink/AbCd2345")).toBe("/calendar/api/shortlink/AbCd2345");
  });

  it("strips the prefix off a browser path for route matching", () => {
    mountAt("/calendar/");
    expect(withoutBase("/calendar/help")).toBe("/help");
    expect(withoutBase("/calendar/e/AbCd2345")).toBe("/e/AbCd2345");
    expect(withoutBase("/calendar/")).toBe("/");
    expect(withoutBase("/calendar")).toBe("/");
  });

  it("reports a path outside the app rather than guessing", () => {
    mountAt("/calendar/");
    expect(withoutBase("/")).toBeNull();
    expect(withoutBase("/help")).toBeNull();
    // A sibling directory that merely starts with the same letters.
    expect(withoutBase("/calendarium/help")).toBeNull();
  });
});
