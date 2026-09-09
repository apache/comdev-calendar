/**
 * Deciding where imported events should land.
 *
 * Nothing here is defaulted on purpose: an import can create dozens of events
 * at once, so the form makes the reader say which calendar, which project and
 * whether they are public before it will save anything.
 */

import { describe, expect, it } from "vitest";
import { anonymousCalendars, makeCalendars } from "../tests/factories";
import {
  emptySettings,
  importReadiness,
  importableCategories,
  importableProjects,
  importableVisibilities,
  looksLikeCalendar,
  reconcile,
  resolveSettings,
} from "./importing";
import type { ImportSettings } from "./importing";

const committer = makeCalendars({
  uid: "alice",
  projects: ["httpd", "tomcat"],
  committees: [],
  can_create: { personal: true, project: ["httpd", "tomcat"], project_private: [], foundation: false },
});

const pmcMember = makeCalendars({
  uid: "bob",
  projects: ["httpd"],
  committees: ["httpd"],
  can_create: { personal: true, project: ["httpd"], project_private: ["httpd"], foundation: false },
});

const member = makeCalendars({
  uid: "carol",
  is_member: true,
  projects: ["tomcat"],
  committees: ["tomcat"],
  can_create: { personal: true, project: ["tomcat"], project_private: ["tomcat"], foundation: true },
});

function settings(overrides: Partial<ImportSettings> = {}): ImportSettings {
  return { ...emptySettings(), ...overrides };
}

describe("nothing is chosen to begin with", () => {
  it("starts empty", () => {
    expect(emptySettings()).toEqual({ category: null, project: null, visibility: null });
  });

  it("is not ready, and says what is missing", () => {
    const readiness = importReadiness(emptySettings(), committer);
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(["which calendar these events belong to"]);
  });
});

describe("what is on offer", () => {
  it("only the calendars this session may write", () => {
    expect(importableCategories(committer)).toEqual(["personal", "project"]);
    expect(importableCategories(member)).toEqual(["personal", "project", "foundation"]);
    expect(importableCategories(anonymousCalendars)).toEqual([]);
    expect(importableCategories(null)).toEqual([]);
  });

  it("private project events need the committee", () => {
    expect(importableProjects(committer, "public")).toEqual(["httpd", "tomcat"]);
    expect(importableProjects(committer, "private")).toEqual([]);
    expect(importableProjects(pmcMember, "private")).toEqual(["httpd"]);
  });

  it("personal events have no visibility to choose", () => {
    expect(importableVisibilities("personal", committer)).toEqual([]);
  });

  it("a committer with no committee can only import public project events", () => {
    expect(importableVisibilities("project", committer)).toEqual(["public"]);
  });

  it("a committee member gets both", () => {
    expect(importableVisibilities("project", pmcMember)).toEqual(["public", "private"]);
  });

  it("foundation events are members only", () => {
    expect(importableVisibilities("foundation", committer)).toEqual([]);
    expect(importableVisibilities("foundation", member)).toEqual(["public", "private"]);
  });
});

describe("what still has to be answered", () => {
  it("a project import needs a project and a visibility", () => {
    const readiness = importReadiness(settings({ category: "project" }), committer);
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual([
      "whether they are public or private",
      "which project they belong to",
    ]);
  });

  it("choosing the visibility leaves only the project", () => {
    const readiness = importReadiness(
      settings({ category: "project", visibility: "public" }),
      committer,
    );
    expect(readiness.missing).toEqual(["which project they belong to"]);
  });

  it("a fully answered project import is ready", () => {
    const readiness = importReadiness(
      settings({ category: "project", visibility: "public", project: "httpd" }),
      committer,
    );
    expect(readiness).toEqual({ ready: true, missing: [] });
  });

  it("a personal import needs nothing more than the calendar", () => {
    expect(importReadiness(settings({ category: "personal" }), committer).ready).toBe(true);
  });

  it("a foundation import still needs a visibility", () => {
    expect(importReadiness(settings({ category: "foundation" }), member).ready).toBe(false);
    expect(
      importReadiness(settings({ category: "foundation", visibility: "private" }), member).ready,
    ).toBe(true);
  });
});

describe("it will not accept an answer the session is not allowed to give", () => {
  it("a calendar the user cannot write to", () => {
    const readiness = importReadiness(settings({ category: "foundation", visibility: "public" }), committer);
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toContain("a calendar you are allowed to add to");
  });

  it("a project the user is not a member of", () => {
    const readiness = importReadiness(
      settings({ category: "project", visibility: "public", project: "kafka" }),
      committer,
    );
    expect(readiness.missing).toContain("a project you are allowed to add to");
  });

  it("a private project event without the committee", () => {
    const readiness = importReadiness(
      settings({ category: "project", visibility: "private", project: "httpd" }),
      committer,
    );
    expect(readiness.ready).toBe(false);
  });

  it("...which the committee member may do", () => {
    const readiness = importReadiness(
      settings({ category: "project", visibility: "private", project: "httpd" }),
      pmcMember,
    );
    expect(readiness.ready).toBe(true);
  });

  it("anonymous cannot import at all", () => {
    expect(importReadiness(settings({ category: "personal" }), anonymousCalendars).ready).toBe(false);
  });
});

describe("keeping the form consistent", () => {
  it("drops the project when the calendar is not a project one", () => {
    const next = reconcile(settings({ category: "personal", project: "httpd" }), committer);
    expect(next.project).toBeNull();
  });

  it("drops the visibility for a personal calendar", () => {
    const next = reconcile(settings({ category: "personal", visibility: "public" }), committer);
    expect(next.visibility).toBeNull();
  });

  it("drops a project that switching to private has taken off the list", () => {
    const chosen = settings({ category: "project", visibility: "public", project: "tomcat" });
    const next = reconcile({ ...chosen, visibility: "private" }, committer);
    expect(next.project).toBeNull();
  });

  it("keeps a project that is still allowed", () => {
    const chosen = settings({ category: "project", visibility: "private", project: "httpd" });
    expect(reconcile(chosen, pmcMember).project).toBe("httpd");
  });

  it("drops a visibility the new calendar does not offer", () => {
    const chosen = settings({ category: "project", visibility: "private", project: "httpd" });
    // A committer switching to a calendar where private is not on offer.
    expect(reconcile(chosen, committer).visibility).toBeNull();
  });
});

describe("handing the answers to the API", () => {
  it("sends project and visibility for a project import", () => {
    expect(
      resolveSettings(settings({ category: "project", visibility: "public", project: "httpd" })),
    ).toEqual({ category: "project", visibility: "public", project: "httpd" });
  });

  it("sends neither for a personal import", () => {
    expect(resolveSettings(settings({ category: "personal" }))).toEqual({
      category: "personal",
      visibility: null,
      project: null,
    });
  });

  it("never sends a project on a foundation import", () => {
    const resolved = resolveSettings(
      settings({ category: "foundation", visibility: "public", project: "httpd" }),
    );
    expect(resolved.project).toBeNull();
  });

  it("refuses to resolve before a calendar is chosen", () => {
    expect(() => resolveSettings(emptySettings())).toThrow();
  });
});

describe("recognising a calendar file", () => {
  const asFile = (name: string, type = "") => new File(["BEGIN:VCALENDAR"], name, { type });

  it("by extension or by type", () => {
    expect(looksLikeCalendar(asFile("events.ics"))).toBe(true);
    expect(looksLikeCalendar(asFile("EVENTS.ICS"))).toBe(true);
    expect(looksLikeCalendar(asFile("export", "text/calendar"))).toBe(true);
  });

  it("and not otherwise", () => {
    expect(looksLikeCalendar(asFile("holiday.jpg", "image/jpeg"))).toBe(false);
  });
});
