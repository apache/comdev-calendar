/**
 * Showing several timezones at once.
 *
 * One zone drives the grid - a time axis can only have one - and the rest ride
 * alongside it as extra clocks, so you can see an event in the organiser's time
 * and in your own without doing the arithmetic yourself.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/svelte";

import AgendaView from "../components/AgendaView.svelte";
import FilterPanel from "../components/FilterPanel.svelte";
import WeekView from "../components/WeekView.svelte";

import { defaultFilters } from "../lib/filters";
import { makeCalendars, makeEvent } from "./factories";

const MARCH_2026 = new Date(2026, 2, 10);
const noop = () => {};

function weekProps(overrides: Record<string, unknown> = {}) {
  return {
    cursor: MARCH_2026,
    events: [] as ReturnType<typeof makeEvent>[],
    zone: "UTC",
    compareZones: [] as string[],
    onselect: noop,
    onpickday: noop,
    ...overrides,
  };
}

function gutterLabels(container: HTMLElement): string[][] {
  return [...container.querySelectorAll(".body .hours")].map((column) =>
    [...column.querySelectorAll(".hour span")].map((cell) => cell.textContent ?? ""),
  );
}

describe("the week grid", () => {
  it("has one hour column when no comparison zones are set", () => {
    const { container } = render(WeekView, { props: weekProps() });
    expect(gutterLabels(container)).toHaveLength(1);
  });

  it("adds a column per comparison zone", () => {
    const { container } = render(
      WeekView,
      { props: weekProps({ compareZones: ["Asia/Tokyo", "America/New_York"] }) },
    );
    expect(gutterLabels(container)).toHaveLength(3);
  });

  it("keeps the primary zone next to the grid", () => {
    const { container } = render(WeekView, { props: weekProps({ compareZones: ["Asia/Tokyo"] }) });
    const columns = gutterLabels(container);
    // Comparison clocks are to the left; the last column is the one the rows
    // actually line up with, so it runs 00:00 to 23:00.
    expect(columns[1][0]).toBe("00:00");
    expect(columns[1][23]).toBe("23:00");
    expect(columns[0][0]).toBe("09:00");
  });

  it("labels each column with its zone", () => {
    const { container } = render(WeekView, { props: weekProps({ compareZones: ["Asia/Tokyo"] }) });
    const headings = [...container.querySelectorAll(".zonehead")].map((cell) =>
      (cell.textContent ?? "").trim(),
    );
    expect(headings).toEqual(["Tokyo", "UTC"]);
  });

  it("marks the comparison columns as secondary so they read quieter", () => {
    const { container } = render(WeekView, { props: weekProps({ compareZones: ["Asia/Tokyo"] }) });
    expect(container.querySelectorAll(".hours.secondary")).toHaveLength(1);
  });

  it("tells the grid how many gutters to make room for", () => {
    const { container } = render(
      WeekView,
      { props: weekProps({ compareZones: ["Asia/Tokyo", "Europe/Berlin"] }) },
    );
    expect(container.querySelector<HTMLElement>(".week")!.style.getPropertyValue("--gutters")).toBe(
      "3",
    );
  });

  it("works the same in the single-day view", () => {
    const { container } = render(
      WeekView,
      { props: weekProps({ days: 1, compareZones: ["Asia/Tokyo"] }) },
    );
    expect(container.querySelectorAll(".daycol")).toHaveLength(1);
    expect(gutterLabels(container)).toHaveLength(2);
  });

  it("still shows the all-day row label once", () => {
    const allDay = makeEvent({
      all_day: true,
      title: "Conference",
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-11T00:00:00Z",
    });
    const { container } = render(
      WeekView,
      { props: weekProps({ events: [allDay], compareZones: ["Asia/Tokyo"] }) },
    );
    const labels = [...container.querySelectorAll(".allday .gutter span")].map((s) => s.textContent);
    expect(labels).toEqual(["", "All day"]);
  });
});

describe("agenda rows", () => {
  const event = makeEvent({
    title: "Community call",
    start: "2026-03-10T13:00:00Z",
    end: "2026-03-10T14:00:00Z",
  });

  it("show only the primary time by default", () => {
    const { container } = render(AgendaView, { props: { events: [event], zone: "UTC", onselect: noop } });
    expect(container.querySelectorAll(".alsoat")).toHaveLength(0);
  });

  it("append the comparison clocks", () => {
    const { container } = render(AgendaView, {
      props: {
        events: [event],
        zone: "UTC",
        compareZones: ["Asia/Tokyo", "America/New_York"],
        onselect: noop,
      },
    });
    const extras = [...container.querySelectorAll(".alsoat")].map((node) => node.textContent);
    // A zone with a real letter abbreviation uses it; Intl only offers
    // "GMT+9" for Tokyo, so that one falls back to the city name.
    expect(extras).toEqual(["22:00 Tokyo", "09:00 EDT"]);
  });

  it("leave all-day events alone, since they are dates not moments", () => {
    const allDay = makeEvent({
      all_day: true,
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-11T00:00:00Z",
    });
    const { container } = render(AgendaView, {
      props: { events: [allDay], zone: "UTC", compareZones: ["Asia/Tokyo"], onselect: noop },
    });
    expect(container.querySelectorAll(".alsoat")).toHaveLength(0);
  });
});

describe("managing the comparison list", () => {
  const calendars = makeCalendars();

  function panelProps(overrides: Record<string, unknown> = {}) {
    return {
      filters: defaultFilters(calendars),
      calendars,
      projects: ["httpd"],
      view: "week" as const,
      feedUrl: "/api/events.ics",
      zone: "UTC",
      compareZones: [] as string[],
      onchange: noop,
      oncomparezones: noop,
      ...overrides,
    };
  }

  it("says which zone the calendar is drawn in", () => {
    render(FilterPanel, { props: panelProps() });
    const section = screen.getByText("Timezones").closest("section")!;
    expect(section).toHaveTextContent("UTC");
  });

  it("offers zones to add", () => {
    render(FilterPanel, { props: panelProps() });
    const picker = screen.getByLabelText<HTMLSelectElement>("Also show another timezone");
    const values = [...picker.querySelectorAll("option")].map((option) => option.value);
    expect(values).toContain("Asia/Tokyo");
    expect(values).toContain("Europe/Berlin");
  });

  it("offers the local clock when it is not the one driving the grid", () => {
    render(FilterPanel, { props: panelProps({ zone: "Asia/Tokyo" }) });
    const picker = screen.getByLabelText<HTMLSelectElement>("Also show another timezone");
    const values = [...picker.querySelectorAll("option")].map((option) => option.value);
    expect(values).toContain("local");
  });

  it("does not offer the local clock when the grid is already on it", () => {
    // The suite runs in UTC, so a UTC grid is already showing local time.
    render(FilterPanel, { props: panelProps({ zone: "UTC" }) });
    const picker = screen.getByLabelText<HTMLSelectElement>("Also show another timezone");
    const values = [...picker.querySelectorAll("option")].map((option) => option.value);
    expect(values).not.toContain("local");
  });

  it("does not offer the zone already driving the grid", () => {
    render(FilterPanel, { props: panelProps({ zone: "Asia/Tokyo" }) });
    const picker = screen.getByLabelText<HTMLSelectElement>("Also show another timezone");
    const values = [...picker.querySelectorAll("option")].map((option) => option.value);
    expect(values).not.toContain("Asia/Tokyo");
  });

  it("does not offer a zone already being compared", () => {
    render(FilterPanel, { props: panelProps({ compareZones: ["Asia/Tokyo"] }) });
    const picker = screen.getByLabelText<HTMLSelectElement>("Also show another timezone");
    const values = [...picker.querySelectorAll("option")].map((option) => option.value);
    expect(values).not.toContain("Asia/Tokyo");
  });

  it("reports a zone being added", async () => {
    const oncomparezones = vi.fn();
    render(FilterPanel, { props: panelProps({ oncomparezones }) });
    await fireEvent.change(screen.getByLabelText("Also show another timezone"), {
      target: { value: "Asia/Tokyo" },
    });
    expect(oncomparezones).toHaveBeenCalledWith(["Asia/Tokyo"]);
  });

  it("lists what is being compared, with a way to remove each", async () => {
    const oncomparezones = vi.fn();
    render(FilterPanel, {
      props: panelProps({ compareZones: ["Asia/Tokyo", "local"], oncomparezones }),
    });
    const section = screen.getByText("Timezones").closest("section")!;
    expect(within(section).getByText("Tokyo (UTC+09:00)")).toBeInTheDocument();
    await fireEvent.click(screen.getByLabelText("Stop showing Asia/Tokyo"));
    expect(oncomparezones).toHaveBeenCalledWith(["local"]);
  });

  it("stops offering more once the limit is reached", () => {
    render(
      FilterPanel,
      {
        props: panelProps({
          compareZones: ["Asia/Tokyo", "Europe/Berlin", "America/New_York"],
          maxCompareZones: 3,
        }),
      },
    );
    expect(screen.queryByLabelText("Also show another timezone")).not.toBeInTheDocument();
  });
});
