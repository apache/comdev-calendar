/** The embeddable agenda, rendered. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/svelte";

import EmbedAgenda from "../components/EmbedAgenda.svelte";
import { HEIGHT_MESSAGE } from "../lib/embed";
import { makeEvent } from "./factories";

const fetchMock = vi.fn();

function respondWith(events: ReturnType<typeof makeEvent>[]) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ events, count: events.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/** Two events on the same day, one on another, all comfortably in the future. */
function sampleEvents() {
  const year = new Date().getUTCFullYear() + 1;
  return [
    makeEvent({
      id: 1,
      title: "httpd community call",
      start: `${year}-03-10T14:00:00Z`,
      end: `${year}-03-10T15:00:00Z`,
      project: "httpd",
      location: "Online",
    }),
    makeEvent({
      id: 2,
      title: "Release vote closes",
      start: `${year}-03-10T18:00:00Z`,
      end: `${year}-03-10T19:00:00Z`,
      project: "httpd",
    }),
    makeEvent({
      id: 3,
      title: "Board meeting",
      category: "foundation",
      project: null,
      start: `${year}-03-12T18:00:00Z`,
      end: `${year}-03-12T20:00:00Z`,
    }),
  ];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what it shows", () => {
  it("lists upcoming events grouped by day", async () => {
    respondWith(sampleEvents());
    const { container } = render(EmbedAgenda, { props: { search: "" } });
    await waitFor(() => expect(screen.getByText("httpd community call")).toBeInTheDocument());
    expect(container.querySelectorAll("section h2")).toHaveLength(2);
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("links each event to its shortlink, opening outside the frame", async () => {
    const events = sampleEvents();
    respondWith(events);
    render(EmbedAgenda, { props: { search: "" } });
    const link = await screen.findByText("httpd community call");
    const anchor = link.closest("a")!;
    expect(anchor).toHaveAttribute("href", events[0].shortlink_url);
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the time and where the event is", async () => {
    respondWith(sampleEvents());
    render(EmbedAgenda, { props: { search: "" } });
    expect(await screen.findByText("14:00 - 15:00")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("says which clock the times are on", async () => {
    respondWith(sampleEvents());
    render(EmbedAgenda, { props: { search: "?zone=Asia/Tokyo" } });
    expect(await screen.findByText(/Times shown in Tokyo/)).toBeInTheDocument();
    expect(screen.getByText("23:00 - 00:00")).toBeInTheDocument();
  });

  it("can be told not to mention the timezone", async () => {
    respondWith(sampleEvents());
    render(EmbedAgenda, { props: { search: "?showzone=0" } });
    await screen.findByText("Board meeting");
    expect(screen.queryByText(/Times shown in/)).not.toBeInTheDocument();
  });

  it("takes a heading", async () => {
    respondWith(sampleEvents());
    render(EmbedAgenda, { props: { search: "?title=Upcoming+httpd+events" } });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Upcoming httpd events",
    );
  });

  it("has no heading unless asked for one", async () => {
    respondWith(sampleEvents());
    render(EmbedAgenda, { props: { search: "" } });
    await screen.findByText("Board meeting");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("credits the calendar, and can be told not to", async () => {
    respondWith(sampleEvents());
    const { unmount } = render(EmbedAgenda, { props: { search: "" } });
    expect(await screen.findByText("ASF Community Calendar")).toBeInTheDocument();
    unmount();

    respondWith(sampleEvents());
    render(EmbedAgenda, { props: { search: "?credit=0" } });
    await screen.findByText("Board meeting");
    expect(screen.queryByText("ASF Community Calendar")).not.toBeInTheDocument();
  });
});

describe("what it asks the API for", () => {
  it("passes the filters through", async () => {
    respondWith([]);
    render(EmbedAgenda, { props: { search: "?project=httpd&category=project&limit=5&days=7&q=call" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith("/api/events?")).toBe(true);
    expect(url).toContain("project=httpd");
    expect(url).toContain("category=project");
    expect(url).toContain("limit=5");
    expect(url).toContain("q=call");
    expect(url).toContain("sort=start");
  });

  it("asks for a window starting today", async () => {
    respondWith([]);
    render(EmbedAgenda, { props: { search: "?days=7" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    const start = new Date(url.searchParams.get("start")!);
    const end = new Date(url.searchParams.get("end")!);
    expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(7);
    expect(start.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("does not ask for the session or the calendar list", async () => {
    respondWith([]);
    render(EmbedAgenda, { props: { search: "" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const called = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(called.some((url) => url.includes("/api/session"))).toBe(false);
    expect(called.some((url) => url.includes("/api/calendars"))).toBe(false);
  });
});

describe("when there is nothing to show", () => {
  it("says so", async () => {
    respondWith([]);
    render(EmbedAgenda, { props: { search: "" } });
    expect(await screen.findByText("No events coming up.")).toBeInTheDocument();
  });

  it("reports a failure rather than sitting blank", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(EmbedAgenda, { props: { search: "" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found");
  });

  it("survives the calendar being unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(EmbedAgenda, { props: { search: "" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach");
  });
});

describe("fitting into the host page", () => {
  it("tells whoever is framing it how tall it is", async () => {
    respondWith(sampleEvents());
    const posted: unknown[] = [];
    vi.stubGlobal("parent", { postMessage: (message: unknown) => posted.push(message) });
    render(EmbedAgenda, { props: { search: "" } });
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const message = posted[0] as { type: string; height: number };
    expect(message.type).toBe(HEIGHT_MESSAGE);
    expect(typeof message.height).toBe("number");
  });

  it("can drop its background so the host page shows through", async () => {
    respondWith(sampleEvents());
    const { container } = render(EmbedAgenda, { props: { search: "?transparent=1" } });
    await screen.findByText("Board meeting");
    expect(container.querySelector(".embed")).toHaveClass("transparent");
  });

  it("can be pinned to a theme", async () => {
    respondWith(sampleEvents());
    const { container } = render(EmbedAgenda, { props: { search: "?theme=dark" } });
    await screen.findByText("Board meeting");
    expect(container.querySelector(".embed")).toHaveAttribute("data-theme", "dark");
  });

  it("follows the host's theme by default", async () => {
    respondWith(sampleEvents());
    const { container } = render(EmbedAgenda, { props: { search: "" } });
    await screen.findByText("Board meeting");
    expect(container.querySelector(".embed")).not.toHaveAttribute("data-theme");
  });
});

describe("all-day events", () => {
  it("say so rather than showing a time", async () => {
    const year = new Date().getUTCFullYear() + 1;
    respondWith([
      makeEvent({
        id: 9,
        title: "ApacheCon",
        all_day: true,
        start: `${year}-03-10T00:00:00Z`,
        end: `${year}-03-13T00:00:00Z`,
      }),
    ]);
    const { container } = render(EmbedAgenda, { props: { search: "" } });
    await screen.findByText("ApacheCon");
    expect(within(container).getByText("All day")).toBeInTheDocument();
  });
});
