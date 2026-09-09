/** EventDialog: the details panel and the create/edit form. */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";

import EventDialog from "../components/EventDialog.svelte";
import { draftFromEvent, newDraft } from "../lib/drafts";
import { makeCalendars, makeEvent } from "./factories";

const noop = () => {};

function props(overrides: Record<string, unknown> = {}) {
  return {
    event: null,
    draft: null,
    calendars: makeCalendars(),
    saving: false,
    error: null,
    editable: false,
    onclose: noop,
    onedit: noop,
    onsave: noop,
    ondelete: noop,
    ...overrides,
  };
}

describe("viewing an event", () => {
  const event = makeEvent({
    title: "Release party",
    location: "Berlin",
    description: "Cake in the atrium",
    url: "https://apache.org",
  });

  it("shows the details", () => {
    render(EventDialog, { props: props({ event }) });
    expect(screen.getByText("Release party")).toBeInTheDocument();
    expect(screen.getByText("Berlin")).toBeInTheDocument();
    expect(screen.getByText("Cake in the atrium")).toBeInTheDocument();
    expect(screen.getByText("https://apache.org")).toHaveAttribute("href", "https://apache.org");
  });

  it("formats a timed event as a single day with a range", () => {
    render(EventDialog, { props: props({ event }) });
    expect(screen.getByText("10 March 2026, 09:00 - 10:00")).toBeInTheDocument();
  });

  it("formats an all-day event without times", () => {
    const allDay = makeEvent({
      all_day: true,
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-11T00:00:00Z",
    });
    render(EventDialog, { props: props({ event: allDay }) });
    expect(screen.getByText("10 March 2026 (all day)")).toBeInTheDocument();
  });

  it("formats a multi-day all-day event as a span", () => {
    const allDay = makeEvent({
      all_day: true,
      start: "2026-03-10T00:00:00Z",
      end: "2026-03-13T00:00:00Z",
    });
    render(EventDialog, { props: props({ event: allDay }) });
    expect(screen.getByText("10 March 2026 - 12 March 2026 (all day)")).toBeInTheDocument();
  });

  it("shows the shortlink and an ics download", () => {
    render(EventDialog, { props: props({ event }) });
    expect(screen.getByText(event.shortlink_url)).toHaveAttribute("href", event.shortlink_url);
    expect(screen.getByText("Download .ics")).toHaveAttribute("href", `/api/events/${event.id}.ics`);
  });

  it("hides the edit button when the user may not edit", () => {
    render(EventDialog, { props: props({ event, editable: false }) });
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("offers editing when the user may", async () => {
    const onedit = vi.fn();
    render(EventDialog, { props: props({ event, editable: true, onedit }) });
    await fireEvent.click(screen.getByText("Edit"));
    expect(onedit).toHaveBeenCalledOnce();
  });

  it("closes on the Close button and on Escape", async () => {
    const onclose = vi.fn();
    render(EventDialog, { props: props({ event, onclose }) });
    await fireEvent.click(screen.getByText("Close"));
    expect(onclose).toHaveBeenCalledOnce();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  it("shows an error passed in from the app", () => {
    render(EventDialog, { props: props({ event, error: "Something went wrong" }) });
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });
});

describe("creating an event", () => {
  const draft = newDraft(new Date(2026, 2, 10, 14, 0), makeCalendars());

  it("shows an empty form", () => {
    render(EventDialog, { props: props({ draft }) });
    expect(screen.getByText("New event")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What is happening?")).toHaveValue("");
  });

  it("offers only the calendars the user can write to", () => {
    render(EventDialog, { props: props({ draft }) });
    const options = [...screen.getByLabelText("Calendar").querySelectorAll("option")].map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["Personal", "Project"]);
  });

  it("offers the private option to a committee member", () => {
    render(EventDialog, { props: props({ draft }) });
    const options = [...screen.getByLabelText("Visibility").querySelectorAll("option")].map(
      (option) => option.value,
    );
    expect(options).toEqual(["public", "private"]);
  });

  it("hands the filled-in draft back on submit", async () => {
    const onsave = vi.fn();
    const { container } = render(EventDialog, { props: props({ draft, onsave }) });
    await fireEvent.input(screen.getByPlaceholderText("What is happening?"), {
      target: { value: "Release party" },
    });
    await fireEvent.submit(container.querySelector("form")!);
    expect(onsave).toHaveBeenCalledOnce();
    expect(onsave.mock.calls[0][0].title).toBe("Release party");
    expect(onsave.mock.calls[0][0].category).toBe("project");
  });

  it("switches to date inputs for an all-day event", async () => {
    const { container } = render(EventDialog, { props: props({ draft }) });
    expect(container.querySelectorAll('input[type="datetime-local"]')).toHaveLength(2);
    await fireEvent.click(screen.getByLabelText("All day"));
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2);
  });

  it("has no delete button for an event that does not exist yet", () => {
    render(EventDialog, { props: props({ draft }) });
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("disables the buttons while saving", () => {
    render(EventDialog, { props: props({ draft, saving: true }) });
    expect(screen.getByText("Saving...")).toBeDisabled();
    expect(screen.getByText("Cancel")).toBeDisabled();
  });
});

describe("editing an event", () => {
  const event = makeEvent({ title: "Original" });

  it("pre-fills the form and offers deletion", () => {
    render(EventDialog, { props: props({ event, draft: draftFromEvent(event), editable: true }) });
    expect(screen.getByText("Edit event")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What is happening?")).toHaveValue("Original");
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("asks the app to delete", async () => {
    const ondelete = vi.fn();
    render(EventDialog, {
      props: props({ event, draft: draftFromEvent(event), editable: true, ondelete }),
    });
    await fireEvent.click(screen.getByText("Delete"));
    expect(ondelete).toHaveBeenCalledOnce();
  });

  it("hides the project picker for a foundation event", () => {
    const foundationEvent = makeEvent({ category: "foundation", project: null });
    const calendars = makeCalendars({
      is_member: true,
      can_create: { personal: true, project: ["httpd"], project_private: ["httpd"], foundation: true },
    });
    render(EventDialog, {
      props: props({ event: foundationEvent, draft: draftFromEvent(foundationEvent), calendars }),
    });
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
  });

  it("hides the visibility picker for a personal event", () => {
    const personal = makeEvent({ category: "personal", project: null, visibility: "private" });
    render(EventDialog, { props: props({ event: personal, draft: draftFromEvent(personal) }) });
    expect(screen.queryByLabelText("Visibility")).not.toBeInTheDocument();
  });
});

describe("timezones in the form", () => {
  const calendars = makeCalendars();

  function berlinDraft() {
    return {
      ...newDraft(new Date(2026, 6, 10, 12, 0), calendars),
      timezone: "Europe/Berlin",
      // 13:00 UTC is 15:00 in Berlin in July.
      start: "2026-07-10T13:00:00Z",
      end: "2026-07-10T14:00:00Z",
    };
  }

  it("offers a timezone picker for a timed event", () => {
    render(EventDialog, { props: props({ draft: berlinDraft() }) });
    const picker = screen.getByLabelText(/Timezone of these times/);
    expect(picker).toHaveValue("Europe/Berlin");
  });

  it("hides the picker for an all-day event, which is a date not a moment", async () => {
    render(EventDialog, { props: props({ draft: berlinDraft() }) });
    await fireEvent.click(screen.getByLabelText("All day"));
    expect(screen.queryByLabelText(/Timezone of these times/)).not.toBeInTheDocument();
  });

  it("shows the times on the event's own clock, not the viewer's", () => {
    const { container } = render(EventDialog, { props: props({ draft: berlinDraft() }) });
    const [start, end] = container.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    expect(start.value).toBe("2026-07-10T15:00");
    expect(end.value).toBe("2026-07-10T16:00");
  });

  it("moving the event to another zone keeps the clock and changes the moment", async () => {
    const onsave = vi.fn();
    const { container } = render(EventDialog, { props: props({ draft: berlinDraft(), onsave }) });
    await fireEvent.change(screen.getByLabelText(/Timezone of these times/), {
      target: { value: "Asia/Tokyo" },
    });
    const [start] = container.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    expect(start.value).toBe("2026-07-10T15:00"); // still 15:00...
    await fireEvent.submit(container.querySelector("form")!);
    // ...but 15:00 in Tokyo, which is 06:00 UTC.
    expect(onsave.mock.calls[0][0].start).toBe("2026-07-10T06:00:00Z");
    expect(onsave.mock.calls[0][0].timezone).toBe("Asia/Tokyo");
  });

  it("interprets a typed time in the chosen zone", async () => {
    const onsave = vi.fn();
    const { container } = render(EventDialog, { props: props({ draft: berlinDraft(), onsave }) });
    const [start] = container.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    await fireEvent.change(start, { target: { value: "2026-07-10T09:30" } });
    await fireEvent.submit(container.querySelector("form")!);
    expect(onsave.mock.calls[0][0].start).toBe("2026-07-10T07:30:00Z");
  });

  it("keeps all-day events on whole UTC days", async () => {
    const onsave = vi.fn();
    const { container } = render(EventDialog, { props: props({ draft: berlinDraft(), onsave }) });
    await fireEvent.click(screen.getByLabelText("All day"));
    const [start, end] = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    await fireEvent.change(start, { target: { value: "2026-07-10" } });
    await fireEvent.change(end, { target: { value: "2026-07-12" } });
    await fireEvent.submit(container.querySelector("form")!);
    const saved = onsave.mock.calls[0][0];
    expect(saved.start).toBe("2026-07-10T00:00:00Z");
    // The stored end is exclusive: the day after the last day.
    expect(saved.end).toBe("2026-07-13T00:00:00Z");
  });
});

describe("timezones in the details", () => {
  const berlinEvent = makeEvent({
    title: "Berlin call",
    timezone: "Europe/Berlin",
    start: "2026-07-10T13:00:00Z",
    end: "2026-07-10T14:00:00Z",
  });

  it("shows the viewer's clock as the headline", () => {
    render(EventDialog, { props: props({ event: berlinEvent, zone: "utc" }) });
    expect(screen.getByText(/10 July 2026, 13:00 - 14:00/)).toBeInTheDocument();
  });

  it("adds the organiser's own clock when it differs", () => {
    render(EventDialog, { props: props({ event: berlinEvent, zone: "utc" }) });
    expect(screen.getByText(/Entered by the organiser as 15:00 - 16:00 Europe\/Berlin/)).toBeInTheDocument();
  });

  it("does not repeat itself when the clocks agree", () => {
    const utcEvent = makeEvent({ timezone: "UTC" });
    render(EventDialog, { props: props({ event: utcEvent, zone: "utc" }) });
    expect(screen.queryByText(/Entered by the organiser/)).not.toBeInTheDocument();
  });

  it("says nothing about zones for an all-day event", () => {
    const allDay = makeEvent({
      all_day: true,
      start: "2026-07-10T00:00:00Z",
      end: "2026-07-11T00:00:00Z",
      timezone: "UTC",
    });
    render(EventDialog, { props: props({ event: allDay, zone: "utc" }) });
    expect(screen.queryByText(/Entered by the organiser/)).not.toBeInTheDocument();
  });
});
