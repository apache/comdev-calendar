/**
 * Component tests. These render the real Svelte components into jsdom and
 * interact with them the way a user would.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/svelte";

import AgendaView from "../components/AgendaView.svelte";
import EventChip from "../components/EventChip.svelte";
import FilterPanel from "../components/FilterPanel.svelte";
import Header from "../components/Header.svelte";
import MonthView from "../components/MonthView.svelte";
import WeekView from "../components/WeekView.svelte";
import YearView from "../components/YearView.svelte";

import { defaultFilters } from "../lib/filters";
import { makeCalendars, makeEvent } from "./factories";

const MARCH_2026 = new Date(2026, 2, 10);

const noop = () => {};

describe("EventChip", () => {
  it("shows the time and title", () => {
    render(EventChip, {
      props: { event: makeEvent({ title: "Release party" }), onselect: noop },
    });
    expect(screen.getByText("Release party")).toBeInTheDocument();
    expect(screen.getByText("09:00")).toBeInTheDocument();
  });

  it("says All day for an all-day event", () => {
    render(EventChip, {
      props: {
        event: makeEvent({ all_day: true, start: "2026-03-10T00:00:00Z", end: "2026-03-11T00:00:00Z" }),
        onselect: noop,
      },
    });
    expect(screen.getByText("All day")).toBeInTheDocument();
  });

  it("marks private events", () => {
    render(EventChip, {
      props: { event: makeEvent({ visibility: "private" }), onselect: noop },
    });
    expect(screen.getByLabelText("Private event")).toBeInTheDocument();
  });

  it("calls back with the event when clicked", async () => {
    const onselect = vi.fn();
    const event = makeEvent({ title: "Clickable" });
    render(EventChip, { props: { event, onselect } });
    await fireEvent.click(screen.getByRole("button"));
    expect(onselect).toHaveBeenCalledWith(event);
  });

  it("can hide the time", () => {
    render(EventChip, { props: { event: makeEvent(), showTime: false, onselect: noop } });
    expect(screen.queryByText("09:00")).not.toBeInTheDocument();
  });
});

describe("MonthView", () => {
  const props = {
    cursor: MARCH_2026,
    events: [] as ReturnType<typeof makeEvent>[],
    onselect: noop,
    onpickday: noop,
  };

  it("draws a 42-cell grid with weekday headers", () => {
    const { container } = render(MonthView, { props });
    expect(container.querySelectorAll(".cell")).toHaveLength(42);
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    expect(screen.getByText("Mon")).toBeInTheDocument();
  });

  it("greys out days from the neighbouring months", () => {
    const { container } = render(MonthView, { props });
    // March 2026 starts on a Sunday, so the grid opens with six February days.
    expect(container.querySelectorAll(".cell.other-month").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".cell:not(.other-month)")).toHaveLength(31);
  });

  it("places an event in its own day cell", () => {
    const event = makeEvent({ title: "Standup", start: "2026-03-10T09:00:00Z", end: "2026-03-10T09:30:00Z" });
    const { container } = render(MonthView, { props: { ...props, events: [event] } });
    const cells = [...container.querySelectorAll<HTMLElement>(".cell")];
    const withEvent = cells.filter((cell) => cell.textContent?.includes("Standup"));
    expect(withEvent).toHaveLength(1);
    expect(within(withEvent[0]).getByText("10")).toBeInTheDocument();
  });

  it("collapses a busy day into a +n more link", async () => {
    const events = [1, 2, 3, 4, 5].map((index) =>
      makeEvent({ id: index, title: `Event ${index}`, start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" }),
    );
    const onpickday = vi.fn();
    render(MonthView, { props: { ...props, events, onpickday } });
    const more = screen.getByText("+2 more");
    await fireEvent.click(more);
    expect(onpickday).toHaveBeenCalled();
  });

  it("marks the first of the month with its name", () => {
    render(MonthView, { props });
    expect(screen.getByText("Mar")).toBeInTheDocument();
  });

  it("clicking a day number asks to open that day", async () => {
    const onpickday = vi.fn();
    render(MonthView, { props: { ...props, onpickday } });
    await fireEvent.click(screen.getByText("15"));
    expect(onpickday).toHaveBeenCalledOnce();
    expect(onpickday.mock.calls[0][0].getDate()).toBe(15);
  });
});

describe("WeekView", () => {
  const props = {
    cursor: MARCH_2026,
    events: [] as ReturnType<typeof makeEvent>[],
    onselect: noop,
    onpickday: noop,
  };

  it("shows seven day columns and 24 hour rows", () => {
    const { container } = render(WeekView, { props });
    expect(container.querySelectorAll(".daycol")).toHaveLength(7);
    expect(container.querySelectorAll(".hours .hour")).toHaveLength(24);
  });

  it("shows a single column in day mode", () => {
    const { container } = render(WeekView, { props: { ...props, days: 1 } });
    expect(container.querySelectorAll(".daycol")).toHaveLength(1);
  });

  it("positions a timed event by its start and length", () => {
    const event = makeEvent({ start: "2026-03-10T06:00:00Z", end: "2026-03-10T12:00:00Z" });
    const { container } = render(WeekView, { props: { ...props, events: [event] } });
    const block = container.querySelector<HTMLElement>(".timed");
    expect(block).not.toBeNull();
    expect(block!.style.top).toBe("25%");
    expect(block!.style.height).toBe("25%");
  });

  it("only shows the all-day row when there is something in it", () => {
    const { container: without } = render(WeekView, { props });
    expect(without.querySelector(".allday")).toBeNull();

    const allDay = makeEvent({
      all_day: true,
      title: "Conference",
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-11T00:00:00Z",
    });
    const { container: with_ } = render(WeekView, { props: { ...props, events: [allDay] } });
    expect(with_.querySelector(".allday")).not.toBeNull();
    expect(screen.getByText("Conference")).toBeInTheDocument();
  });

  it("selects an event when its block is clicked", async () => {
    const onselect = vi.fn();
    const event = makeEvent({ title: "Sync" });
    const { container } = render(WeekView, { props: { ...props, events: [event], onselect } });
    await fireEvent.click(container.querySelector(".timed")!);
    expect(onselect).toHaveBeenCalledWith(event);
  });
});

describe("YearView", () => {
  const props = {
    cursor: MARCH_2026,
    events: [] as ReturnType<typeof makeEvent>[],
    onpickday: noop,
    onpickmonth: noop,
  };

  it("draws twelve mini months", () => {
    const { container } = render(YearView, { props });
    expect(container.querySelectorAll("section.month")).toHaveLength(12);
    expect(screen.getByText("January")).toBeInTheDocument();
    expect(screen.getByText("December")).toBeInTheDocument();
  });

  it("puts a dot on a day that has events", () => {
    const event = makeEvent({ start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" });
    const { container } = render(YearView, { props: { ...props, events: [event] } });
    expect(container.querySelectorAll(".dots i").length).toBe(1);
  });

  it("caps the dots so a busy day does not overflow", () => {
    const events = [1, 2, 3, 4, 5].map((index) =>
      makeEvent({ id: index, start: "2026-03-10T09:00:00Z", end: "2026-03-10T10:00:00Z" }),
    );
    const { container } = render(YearView, { props: { ...props, events } });
    expect(container.querySelectorAll(".dots i").length).toBe(3);
  });

  it("clicking a month name opens that month", async () => {
    const onpickmonth = vi.fn();
    render(YearView, { props: { ...props, onpickmonth } });
    await fireEvent.click(screen.getByText("July"));
    expect(onpickmonth.mock.calls[0][0].getMonth()).toBe(6);
  });
});

describe("AgendaView", () => {
  it("groups events under a heading per day", () => {
    const events = [
      makeEvent({ id: 1, title: "Standup", start: "2026-03-10T09:00:00Z", end: "2026-03-10T09:15:00Z" }),
      makeEvent({ id: 2, title: "Retro", start: "2026-03-10T15:00:00Z", end: "2026-03-10T16:00:00Z" }),
      makeEvent({ id: 3, title: "Board", start: "2026-03-12T15:00:00Z", end: "2026-03-12T16:00:00Z" }),
    ];
    const { container } = render(AgendaView, { props: { events, onselect: noop } });
    expect(container.querySelectorAll("h3")).toHaveLength(2);
    expect(screen.getByText("10 March 2026")).toBeInTheDocument();
    expect(screen.getByText("09:00 - 09:15")).toBeInTheDocument();
  });

  it("says so when there is nothing to show", () => {
    render(AgendaView, { props: { events: [], onselect: noop } });
    expect(screen.getByText(/No events match/)).toBeInTheDocument();
  });

  it("shows the calendar and privacy of each row", () => {
    const event = makeEvent({ project: "httpd", visibility: "private" });
    render(AgendaView, { props: { events: [event], onselect: noop } });
    expect(screen.getByText("httpd")).toBeInTheDocument();
    expect(screen.getByText("private")).toBeInTheDocument();
  });

  it("selects a row when clicked", async () => {
    const onselect = vi.fn();
    const event = makeEvent({ title: "Retro" });
    render(AgendaView, { props: { events: [event], onselect } });
    await fireEvent.click(screen.getByText("Retro"));
    expect(onselect).toHaveBeenCalledWith(event);
  });
});

describe("FilterPanel", () => {
  const calendars = makeCalendars();

  function panelProps(overrides: Record<string, unknown> = {}) {
    return {
      filters: defaultFilters(calendars),
      calendars,
      projects: ["httpd", "tomcat"],
      view: "month" as const,
      feedUrl: "/api/events.ics",
      onchange: noop,
      ...overrides,
    };
  }

  it("lists the three calendars and the user's projects", () => {
    render(FilterPanel, { props: panelProps() });
    for (const label of ["Personal", "Project", "Foundation", "httpd", "tomcat"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks the projects the user is on the committee of", () => {
    render(FilterPanel, { props: panelProps() });
    expect(screen.getByTitle("You are on this committee")).toBeInTheDocument();
  });

  it("reports a category being switched off", async () => {
    const onchange = vi.fn();
    render(FilterPanel, { props: panelProps({ onchange }) });
    const checkbox = screen.getByText("Personal").closest("label")!.querySelector("input")!;
    await fireEvent.click(checkbox);
    expect(onchange).toHaveBeenCalledOnce();
    expect([...onchange.mock.calls[0][0].categories]).not.toContain("personal");
  });

  it("has bulk controls for the project list", async () => {
    const onchange = vi.fn();
    render(FilterPanel, { props: panelProps({ onchange }) });
    await fireEvent.click(screen.getByText("none"));
    expect(onchange.mock.calls[0][0].projects.size).toBe(0);
    await fireEvent.click(screen.getByText("all"));
    expect(onchange.mock.calls[1][0].projects.size).toBe(2);
  });

  it("reports typing in the search box", async () => {
    const onchange = vi.fn();
    render(FilterPanel, { props: panelProps({ onchange }) });
    await fireEvent.input(screen.getByPlaceholderText("Search events..."), {
      target: { value: "release" },
    });
    expect(onchange.mock.calls[0][0].search).toBe("release");
  });

  it("only offers sorting in the agenda view", () => {
    render(FilterPanel, { props: panelProps() });
    expect(screen.queryByText("Sort")).not.toBeInTheDocument();
  });

  it("offers sorting in the agenda view", () => {
    render(FilterPanel, { props: panelProps({ view: "agenda" }) });
    expect(screen.getByText("Sort")).toBeInTheDocument();
  });

  it("links to the iCalendar feed", () => {
    render(FilterPanel, { props: panelProps({ feedUrl: "/api/events.ics?category=project" }) });
    expect(screen.getByText("Download .ics")).toHaveAttribute(
      "href",
      "/api/events.ics?category=project",
    );
  });

  it("hides the project section when there are no projects", () => {
    render(FilterPanel, { props: panelProps({ projects: [] }) });
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
  });
});

describe("Header", () => {
  function headerProps(overrides: Record<string, unknown> = {}) {
    return {
      title: "ASF Community Calendar",
      view: "month" as const,
      cursor: MARCH_2026,
      session: { authenticated: false, login_url: "/auth?login=/" },
      loading: false,
      canCreate: false,
      zone: "local" as const,
      helpOpen: false,
      onview: noop,
      onstep: noop,
      ontoday: noop,
      oncreate: noop,
      ontogglefilters: noop,
      onzone: noop,
      onhelp: noop,
      ...overrides,
    };
  }

  it("shows the title and the current period", () => {
    render(Header, { props: headerProps() });
    expect(screen.getByText("ASF Community Calendar")).toBeInTheDocument();
    expect(screen.getByText("March 2026")).toBeInTheDocument();
  });

  it("offers a log in link when signed out", () => {
    render(Header, { props: headerProps() });
    expect(screen.getByText("Log in")).toHaveAttribute("href", "/auth?login=/");
    expect(screen.queryByText("New event")).not.toBeInTheDocument();
  });

  it("falls back to a sensible login URL before the session has loaded", () => {
    render(Header, { props: headerProps({ session: null }) });
    expect(screen.getByText("Log in")).toHaveAttribute("href", "/auth?login=/");
  });

  it("puts the mount point in the fallback login URL", () => {
    const tag = document.createElement("base");
    tag.setAttribute("href", "/calendar/");
    document.head.appendChild(tag);
    try {
      render(Header, { props: headerProps({ session: null }) });
      expect(screen.getByText("Log in")).toHaveAttribute("href", "/calendar/auth?login=/calendar/");
    } finally {
      tag.remove();
    }
  });

  it("prefers the URL the backend handed it over the fallback", () => {
    const tag = document.createElement("base");
    tag.setAttribute("href", "/calendar/");
    document.head.appendChild(tag);
    try {
      render(Header, {
        props: headerProps({
          session: { authenticated: false, login_url: "/calendar/session?login=/calendar/" },
        }),
      });
      expect(screen.getByText("Log in")).toHaveAttribute(
        "href",
        "/calendar/session?login=/calendar/",
      );
    } finally {
      tag.remove();
    }
  });

  it("shows who is signed in, and how to leave", () => {
    render(Header, {
      props: headerProps({
        session: { authenticated: true, uid: "alice", fullname: "Alice", logout_url: "/auth?logout=/" },
        canCreate: true,
      }),
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Log out")).toHaveAttribute("href", "/auth?logout=/");
    expect(screen.getByText("New event")).toBeInTheDocument();
  });

  it("marks the active view", () => {
    render(Header, { props: headerProps({ view: "week" }) });
    expect(screen.getByRole("tab", { name: "week" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "month" })).toHaveAttribute("aria-selected", "false");
  });

  it("reports view changes and stepping", async () => {
    const onview = vi.fn();
    const onstep = vi.fn();
    const ontoday = vi.fn();
    render(Header, { props: headerProps({ onview, onstep, ontoday }) });
    await fireEvent.click(screen.getByRole("tab", { name: "year" }));
    expect(onview).toHaveBeenCalledWith("year");
    await fireEvent.click(screen.getByLabelText("Next"));
    expect(onstep).toHaveBeenCalledWith(1);
    await fireEvent.click(screen.getByLabelText("Previous"));
    expect(onstep).toHaveBeenCalledWith(-1);
    await fireEvent.click(screen.getByText("Today"));
    expect(ontoday).toHaveBeenCalledOnce();
  });

  it("shows a spinner while loading", () => {
    render(Header, { props: headerProps({ loading: true }) });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("offers a switch between the local timezone and UTC", () => {
    render(Header, { props: headerProps() });
    const group = screen.getByRole("group", { name: "Display timezone" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toHaveTextContent("UTC");
  });

  it("marks the timezone currently in use", () => {
    render(Header, { props: headerProps({ zone: "utc" }) });
    const group = screen.getByRole("group", { name: "Display timezone" });
    const [local, utc] = within(group).getAllByRole("button");
    expect(utc).toHaveAttribute("aria-pressed", "true");
    expect(local).toHaveAttribute("aria-pressed", "false");
  });

  it("reports a timezone change", async () => {
    const onzone = vi.fn();
    render(Header, { props: headerProps({ onzone }) });
    const group = screen.getByRole("group", { name: "Display timezone" });
    await fireEvent.click(within(group).getAllByRole("button")[1]);
    expect(onzone).toHaveBeenCalledWith("utc");
  });

  it("has a help button that reports being pressed", async () => {
    const onhelp = vi.fn();
    render(Header, { props: headerProps({ onhelp }) });
    await fireEvent.click(screen.getByText("Help"));
    expect(onhelp).toHaveBeenCalledOnce();
  });
});
