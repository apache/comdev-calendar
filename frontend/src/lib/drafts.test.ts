import { describe, expect, it } from "vitest";
import { anonymousCalendars, makeCalendars, makeEvent } from "../tests/factories";
import {
  allowedVisibilities,
  canCreateAnything,
  canEdit,
  defaultCategory,
  draftFromEvent,
  newDraft,
} from "./drafts";

describe("what the user can create", () => {
  it("prefers a project calendar when there is one", () => {
    expect(defaultCategory(makeCalendars())).toBe("project");
  });

  it("falls back to personal", () => {
    expect(defaultCategory(makeCalendars({ can_create: { personal: true, project: [], project_private: [], foundation: false } }))).toBe(
      "personal",
    );
  });

  it("falls back to foundation for a member with no projects", () => {
    const calendars = makeCalendars({
      is_member: true,
      can_create: { personal: false, project: [], project_private: [], foundation: true },
    });
    expect(defaultCategory(calendars)).toBe("foundation");
  });

  it("an anonymous visitor can create nothing", () => {
    expect(defaultCategory(anonymousCalendars)).toBeNull();
    expect(canCreateAnything(anonymousCalendars)).toBe(false);
    expect(canCreateAnything(null)).toBe(false);
  });
});

describe("newDraft", () => {
  it("starts an hour long", () => {
    const draft = newDraft(new Date(2026, 2, 10, 14, 0), makeCalendars());
    expect(new Date(draft.end).getTime() - new Date(draft.start).getTime()).toBe(3_600_000);
  });

  it("nudges a whole-day click to 09:00", () => {
    const draft = newDraft(new Date(2026, 2, 10, 0, 0, 0, 0), makeCalendars());
    expect(new Date(draft.start).getHours()).toBe(9);
  });

  it("keeps a time the user actually picked", () => {
    const draft = newDraft(new Date(2026, 2, 10, 16, 30), makeCalendars());
    expect(new Date(draft.start).getHours()).toBe(16);
    expect(new Date(draft.start).getMinutes()).toBe(30);
  });

  it("picks the first writable project", () => {
    const draft = newDraft(new Date(), makeCalendars({ projects: ["tomcat", "httpd"] }));
    expect(draft.category).toBe("project");
    expect(draft.project).toBe("tomcat");
  });

  it("a personal draft is private and has no project", () => {
    const calendars = makeCalendars({
      can_create: { personal: true, project: [], project_private: [], foundation: false },
    });
    const draft = newDraft(new Date(), calendars);
    expect(draft.category).toBe("personal");
    expect(draft.visibility).toBe("private");
    expect(draft.project).toBeNull();
  });
});

describe("draftFromEvent", () => {
  it("copies the editable fields and nothing else", () => {
    const event = makeEvent({ title: "Release", location: "Berlin", description: "Cake" });
    const draft = draftFromEvent(event);
    expect(draft).toEqual({
      title: "Release",
      category: "project",
      visibility: "public",
      start: event.start,
      end: event.end,
      all_day: false,
      description: "Cake",
      location: "Berlin",
      url: "",
      project: "httpd",
      timezone: "UTC",
    });
    expect(draft).not.toHaveProperty("id");
    expect(draft).not.toHaveProperty("owner");
  });
});

describe("canEdit mirrors the backend rules", () => {
  const committer = makeCalendars({ uid: "alice", projects: ["httpd", "tomcat"], committees: [] });
  const pmcMember = makeCalendars({ uid: "bob", projects: ["httpd"], committees: ["httpd"] });
  const foundationMember = makeCalendars({
    uid: "carol",
    is_member: true,
    projects: ["tomcat"],
    committees: ["tomcat"],
  });

  it("nobody can edit while logged out", () => {
    expect(canEdit(makeEvent(), anonymousCalendars)).toBe(false);
    expect(canEdit(makeEvent(), null)).toBe(false);
  });

  it("personal events belong to their owner", () => {
    const event = makeEvent({ category: "personal", project: null, owner: "alice" });
    expect(canEdit(event, committer)).toBe(true);
    expect(canEdit(event, pmcMember)).toBe(false);
  });

  it("public project events are editable by any project member", () => {
    const event = makeEvent({ project: "httpd", visibility: "public", owner: "someone" });
    expect(canEdit(event, committer)).toBe(true);
    expect(canEdit(event, pmcMember)).toBe(true);
    expect(canEdit(event, foundationMember)).toBe(false);
  });

  it("private project events need the committee", () => {
    const event = makeEvent({ project: "httpd", visibility: "private" });
    expect(canEdit(event, committer)).toBe(false);
    expect(canEdit(event, pmcMember)).toBe(true);
  });

  it("foundation events need membership", () => {
    const event = makeEvent({ category: "foundation", project: null });
    expect(canEdit(event, committer)).toBe(false);
    expect(canEdit(event, foundationMember)).toBe(true);
  });

  it("a project event with no project is not editable", () => {
    expect(canEdit(makeEvent({ project: null }), pmcMember)).toBe(false);
  });
});

describe("allowedVisibilities", () => {
  it("personal is always private", () => {
    expect(allowedVisibilities("personal", makeCalendars())).toEqual(["private"]);
  });

  it("a committer with no committee can only make public project events", () => {
    const calendars = makeCalendars({
      committees: [],
      can_create: { personal: true, project: ["httpd"], project_private: [], foundation: false },
    });
    expect(allowedVisibilities("project", calendars)).toEqual(["public"]);
  });

  it("a committee member gets both", () => {
    expect(allowedVisibilities("project", makeCalendars())).toEqual(["public", "private"]);
  });

  it("foundation is members only", () => {
    expect(allowedVisibilities("foundation", makeCalendars())).toEqual([]);
    const member = makeCalendars({
      is_member: true,
      can_create: { personal: true, project: [], project_private: [], foundation: true },
    });
    expect(allowedVisibilities("foundation", member)).toEqual(["public", "private"]);
  });
});
