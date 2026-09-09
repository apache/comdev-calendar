import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEvent } from "../tests/factories";
import { ApiError, api, buildQuery } from "./api";

function respond(body: unknown, init: ResponseInit = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildQuery", () => {
  it("is empty when there is nothing to say", () => {
    expect(buildQuery({})).toBe("");
  });

  it("serialises dates as ISO strings", () => {
    const query = buildQuery({ start: new Date(Date.UTC(2026, 2, 1)) });
    expect(query).toContain("start=2026-03-01T00%3A00%3A00.000Z");
  });

  it("repeats multi-valued filters", () => {
    const query = buildQuery({ categories: ["project", "personal"], projects: ["httpd"] });
    expect(query).toContain("category=project");
    expect(query).toContain("category=personal");
    expect(query).toContain("project=httpd");
  });

  it("leaves out a visibility of all", () => {
    expect(buildQuery({ visibility: "all" })).toBe("");
    expect(buildQuery({ visibility: "private" })).toBe("?visibility=private");
  });

  it("passes search, sort and limit through", () => {
    const query = buildQuery({ q: "release party", sort: "-start", limit: 10 });
    expect(query).toContain("q=release+party");
    expect(query).toContain("sort=-start");
    expect(query).toContain("limit=10");
  });
});

describe("request handling", () => {
  it("asks the backend not to redirect to OAuth", async () => {
    fetchMock.mockResolvedValue(respond({ authenticated: false }));
    await api.session();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-No-Redirect"]).toBe("1");
    expect(init.credentials).toBe("same-origin");
  });

  it("sends a JSON body only when there is one", async () => {
    fetchMock.mockResolvedValue(respond({ events: [] }));
    await api.events();
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();

    fetchMock.mockResolvedValue(respond({ event: makeEvent() }));
    await api.create({
      title: "x",
      category: "personal",
      visibility: "private",
      start: "2026-03-10T09:00:00Z",
      end: "2026-03-10T10:00:00Z",
      all_day: false,
      description: "",
      location: "",
      url: "",
      project: null,
      timezone: "UTC",
    });
    const [, init] = fetchMock.mock.calls[1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).title).toBe("x");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("unwraps the events array", async () => {
    fetchMock.mockResolvedValue(respond({ events: [makeEvent({ id: 7 })], count: 1 }));
    const events = await api.events();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(7);
  });

  it("unwraps a single event", async () => {
    fetchMock.mockResolvedValue(respond({ event: makeEvent({ id: 3 }) }));
    expect((await api.event(3)).id).toBe(3);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/events/3");
  });

  it("escapes a shortlink token", async () => {
    fetchMock.mockResolvedValue(respond({ event: makeEvent() }));
    await api.byShortlink("a b");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/shortlink/a%20b");
  });

  it("turns an error body into an ApiError", async () => {
    fetchMock.mockResolvedValue(
      respond({ error: "'title' is required", field: "title" }, { status: 400 }),
    );
    await expect(api.event(1)).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "'title' is required",
      field: "title",
    });
  });

  it("reports a 401 as something a login might fix", async () => {
    fetchMock.mockResolvedValue(respond({ error: "You need to be logged in" }, { status: 401 }));
    const failure = await api.event(1).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).needsLogin).toBe(true);
  });

  it("copes with an error response that is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>oh dear</html>", { status: 500 }));
    await expect(api.event(1)).rejects.toMatchObject({
      status: 500,
      message: "Request failed with status 500",
    });
  });

  it("turns a network failure into a readable message", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.session()).rejects.toMatchObject({
      status: 0,
      message: "Could not reach the calendar service.",
    });
  });

  it("handles a 204 with no body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.remove(1)).resolves.toBeUndefined();
  });

  it("deletes with the right method and path", async () => {
    fetchMock.mockResolvedValue(respond({ deleted: 5 }));
    await api.remove(5);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/events/5");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("updates with PUT", async () => {
    fetchMock.mockResolvedValue(respond({ event: makeEvent({ id: 4, title: "Edited" }) }));
    const updated = await api.update(4, draft());
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(updated.title).toBe("Edited");
  });
});

describe("when the app is mounted in a sub-directory", () => {
  function mountAt(href: string) {
    const tag = document.createElement("base");
    tag.setAttribute("href", href);
    document.head.appendChild(tag);
    return () => tag.remove();
  }

  it("puts the prefix in front of every request", async () => {
    const unmount = mountAt("/calendar/");
    try {
      fetchMock.mockResolvedValue(respond({ events: [] }));
      await api.events({ q: "release" });
      expect(fetchMock.mock.calls[0][0]).toBe("/calendar/api/events?q=release");

      fetchMock.mockResolvedValue(respond({ event: makeEvent() }));
      await api.event(3);
      expect(fetchMock.mock.calls[1][0]).toBe("/calendar/api/events/3");

      fetchMock.mockResolvedValue(respond({ deleted: 3 }));
      await api.remove(3);
      expect(fetchMock.mock.calls[2][0]).toBe("/calendar/api/events/3");
    } finally {
      unmount();
    }
  });

  it("prefixes the download URLs too", () => {
    const unmount = mountAt("/calendar/");
    try {
      expect(api.icsUrl(12)).toBe("/calendar/api/events/12.ics");
      expect(api.feedUrl({ categories: ["project"] })).toBe(
        "/calendar/api/events.ics?category=project",
      );
    } finally {
      unmount();
    }
  });
});

describe("download URLs", () => {
  it("points at the single-event export", () => {
    expect(api.icsUrl(12)).toBe("/api/events/12.ics");
  });

  it("carries the current filters into the feed", () => {
    const url = api.feedUrl({ categories: ["project"], q: "release" });
    expect(url.startsWith("/api/events.ics?")).toBe(true);
    expect(url).toContain("category=project");
    expect(url).toContain("q=release");
  });
});

function draft() {
  return {
    title: "Edited",
    category: "project" as const,
    visibility: "public" as const,
    start: "2026-03-10T09:00:00Z",
    end: "2026-03-10T10:00:00Z",
    all_day: false,
    description: "",
    location: "",
    url: "",
    project: "httpd",
    timezone: "UTC",
  };
}
