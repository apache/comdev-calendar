import { describe, expect, it } from "vitest";
import { anonymousCalendars, makeCalendars, makeEvent } from "../tests/factories";
import type { Filters } from "./types";
import {
  applyFilters,
  defaultFilters,
  isUnfiltered,
  matches,
  projectsInPlay,
  sortEvents,
  toggle,
} from "./filters";

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...defaultFilters(makeCalendars()), ...overrides };
}

describe("defaults", () => {
  it("turns everything the user belongs to on", () => {
    const state = defaultFilters(makeCalendars({ projects: ["httpd", "tomcat"] }));
    expect([...state.categories].sort()).toEqual(["foundation", "personal", "project"]);
    expect([...state.projects].sort()).toEqual(["httpd", "tomcat"]);
    expect(state.visibility).toBe("all");
    expect(state.search).toBe("");
  });

  it("copes with an anonymous visitor", () => {
    const state = defaultFilters(anonymousCalendars);
    expect(state.projects.size).toBe(0);
    expect(state.categories.size).toBe(3);
  });

  it("copes with no calendars loaded yet", () => {
    expect(defaultFilters(null).projects.size).toBe(0);
  });

  it("isUnfiltered recognises the default state", () => {
    const calendars = makeCalendars();
    expect(isUnfiltered(defaultFilters(calendars), calendars)).toBe(true);
    expect(isUnfiltered(filters({ search: "x" }), calendars)).toBe(false);
    expect(isUnfiltered(filters({ visibility: "private" }), calendars)).toBe(false);
  });
});

describe("category filter", () => {
  it("hides categories that are switched off", () => {
    const state = filters({ categories: new Set(["project"]) });
    expect(matches(makeEvent({ category: "project" }), state)).toBe(true);
    expect(matches(makeEvent({ category: "personal", project: null }), state)).toBe(false);
    expect(matches(makeEvent({ category: "foundation", project: null }), state)).toBe(false);
  });
});

describe("project filter", () => {
  const known = ["httpd", "tomcat"];

  it("hides a project that is switched off", () => {
    const state = filters({ projects: new Set(["tomcat"]) });
    expect(matches(makeEvent({ project: "httpd" }), state, known)).toBe(false);
    expect(matches(makeEvent({ project: "tomcat" }), state, known)).toBe(true);
  });

  it("does not apply to other categories", () => {
    const state = filters({ projects: new Set() });
    expect(matches(makeEvent({ category: "foundation", project: null }), state, known)).toBe(true);
    expect(matches(makeEvent({ category: "personal", project: null }), state, known)).toBe(true);
  });

  it("leaves unknown projects visible", () => {
    // A public event from a project the user has never heard of should not
    // vanish just because it has no checkbox.
    const state = filters({ projects: new Set(["httpd"]) });
    expect(matches(makeEvent({ project: "kafka" }), state, known)).toBe(true);
  });
});

describe("visibility filter", () => {
  it("all lets both through", () => {
    const state = filters({ visibility: "all" });
    expect(matches(makeEvent({ visibility: "public" }), state)).toBe(true);
    expect(matches(makeEvent({ visibility: "private" }), state)).toBe(true);
  });

  it("narrowing works both ways", () => {
    expect(matches(makeEvent({ visibility: "private" }), filters({ visibility: "public" }))).toBe(false);
    expect(matches(makeEvent({ visibility: "private" }), filters({ visibility: "private" }))).toBe(true);
  });
});

describe("search", () => {
  const event = makeEvent({
    title: "Release party",
    description: "Cake in the atrium",
    location: "Berlin",
    project: "httpd",
  });

  it("matches the title, description, location and project", () => {
    for (const needle of ["release", "CAKE", "berlin", "httpd"]) {
      expect(matches(event, filters({ search: needle }))).toBe(true);
    }
  });

  it("does not match unrelated text", () => {
    expect(matches(event, filters({ search: "kafka" }))).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(matches(event, filters({ search: "  release  " }))).toBe(true);
  });

  it("an empty search matches everything", () => {
    expect(matches(event, filters({ search: "   " }))).toBe(true);
  });
});

describe("applyFilters", () => {
  it("combines every filter", () => {
    const events = [
      makeEvent({ id: 1, title: "httpd public", project: "httpd", visibility: "public" }),
      makeEvent({ id: 2, title: "httpd private", project: "httpd", visibility: "private" }),
      makeEvent({ id: 3, title: "tomcat public", project: "tomcat" }),
      makeEvent({ id: 4, title: "board", category: "foundation", project: null }),
    ];
    const state = filters({
      categories: new Set(["project"]),
      projects: new Set(["httpd"]),
      visibility: "private",
    });
    expect(applyFilters(events, state, ["httpd", "tomcat"]).map((event) => event.id)).toEqual([2]);
  });

  it("returns everything when nothing is narrowed", () => {
    const events = [makeEvent({ id: 1 }), makeEvent({ id: 2, category: "foundation", project: null })];
    expect(applyFilters(events, filters(), ["httpd"])).toHaveLength(2);
  });
});

describe("sorting", () => {
  const early = makeEvent({ id: 1, title: "Zebra", start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" });
  const late = makeEvent({ id: 2, title: "Apple", start: "2026-03-12T09:00:00Z", end: "2026-03-12T10:00:00Z" });

  it("by start", () => {
    expect(sortEvents([late, early], "start").map((event) => event.id)).toEqual([1, 2]);
    expect(sortEvents([early, late], "-start").map((event) => event.id)).toEqual([2, 1]);
  });

  it("by title", () => {
    expect(sortEvents([early, late], "title").map((event) => event.title)).toEqual(["Apple", "Zebra"]);
    expect(sortEvents([late, early], "-title").map((event) => event.title)).toEqual(["Zebra", "Apple"]);
  });

  it("does not modify the input", () => {
    const input = [late, early];
    sortEvents(input, "start");
    expect(input.map((event) => event.id)).toEqual([2, 1]);
  });
});

describe("projectsInPlay", () => {
  it("merges the user's projects with any seen in the events", () => {
    const events = [makeEvent({ project: "kafka" }), makeEvent({ category: "foundation", project: null })];
    expect(projectsInPlay(events, makeCalendars({ projects: ["httpd"] }))).toEqual(["httpd", "kafka"]);
  });

  it("deduplicates and sorts", () => {
    const events = [makeEvent({ project: "httpd" }), makeEvent({ project: "httpd" })];
    expect(projectsInPlay(events, makeCalendars({ projects: ["tomcat", "httpd"] }))).toEqual([
      "httpd",
      "tomcat",
    ]);
  });

  it("works with no session", () => {
    expect(projectsInPlay([makeEvent({ project: "httpd" })], null)).toEqual(["httpd"]);
  });
});

describe("toggle", () => {
  it("adds and removes without mutating", () => {
    const original = new Set(["a"]);
    const added = toggle(original, "b");
    expect([...added].sort()).toEqual(["a", "b"]);
    expect([...original]).toEqual(["a"]);
    expect([...toggle(added, "a")]).toEqual(["b"]);
  });
});
