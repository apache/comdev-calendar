/** The import form: preview first, then say where the events go. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";

import ImportDialog from "../components/ImportDialog.svelte";
import type { ImportCandidate } from "../lib/importing";
import { makeCalendars, makeEvent } from "./factories";

const noop = () => {};
const fetchMock = vi.fn();

const CANDIDATE: ImportCandidate = {
  title: "Community call",
  start: "2026-07-10T13:00:00Z",
  end: "2026-07-10T14:00:00Z",
  all_day: false,
  description: "",
  location: "Room 3",
  url: "",
  timezone: "Europe/Berlin",
  uid: "1@t",
  warnings: [],
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function previewOf(events: ImportCandidate[] = [CANDIDATE], warnings: string[] = []) {
  return { events, count: events.length, warnings };
}

const pmcMember = makeCalendars({
  uid: "bob",
  projects: ["httpd"],
  committees: ["httpd"],
  can_create: { personal: true, project: ["httpd"], project_private: ["httpd"], foundation: false },
});

function props(overrides: Record<string, unknown> = {}) {
  return {
    calendars: pmcMember,
    zone: "UTC",
    onclose: noop,
    onimported: noop,
    ...overrides,
  };
}

function icsFile(name = "events.ics") {
  return new File(["BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"], name, { type: "text/calendar" });
}

/** Puts a file into the dialog's file input the way a picker would. */
async function attach(container: HTMLElement, file = icsFile()) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await fireEvent.change(input);
}

function importButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^Import/ }) as HTMLButtonElement;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("before a file is chosen", () => {
  it("asks for one", () => {
    render(ImportDialog, { props: props() });
    expect(screen.getByText("Choose a file")).toBeInTheDocument();
    expect(screen.getByText(/drop an .ics file here/)).toBeInTheDocument();
  });

  it("cannot import anything yet", () => {
    render(ImportDialog, { props: props() });
    expect(importButton()).toBeDisabled();
  });

  it("asks nothing about calendars yet", () => {
    render(ImportDialog, { props: props() });
    expect(screen.queryByLabelText("Calendar")).not.toBeInTheDocument();
  });
});

describe("the preview", () => {
  it("reads the file without saving it", async () => {
    fetchMock.mockResolvedValue(respond(previewOf()));
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() => expect(screen.getByText("Community call")).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/import/preview");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("sends the file as multipart, letting the browser set the boundary", async () => {
    fetchMock.mockResolvedValue(respond(previewOf()));
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("shows what was found, on the reader's clock", async () => {
    fetchMock.mockResolvedValue(respond(previewOf()));
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() => expect(screen.getByText("Community call")).toBeInTheDocument());
    expect(screen.getByText("1 event found")).toBeInTheDocument();
    expect(screen.getByText(/10 July 2026, 13:00 - 14:00/)).toBeInTheDocument();
    expect(screen.getByText("Room 3")).toBeInTheDocument();
  });

  it("counts several events", async () => {
    fetchMock.mockResolvedValue(
      respond(previewOf([CANDIDATE, { ...CANDIDATE, uid: "2@t", title: "ApacheCon" }])),
    );
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() => expect(screen.getByText("2 events found")).toBeInTheDocument());
  });

  it("shows the file's own warnings", async () => {
    fetchMock.mockResolvedValue(respond(previewOf([CANDIDATE], ["Skipped 1 entry with no start time."])));
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() =>
      expect(screen.getByText("Skipped 1 entry with no start time.")).toBeInTheDocument(),
    );
  });

  it("shows a warning attached to one event", async () => {
    const repeating = { ...CANDIDATE, warnings: ["This event repeats."] };
    fetchMock.mockResolvedValue(respond(previewOf([repeating])));
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() => expect(screen.getByText("This event repeats.")).toBeInTheDocument());
    expect(screen.getByText(/1 thing to note/)).toBeInTheDocument();
  });

  it("renders recurrence overrides, which all carry the parent event's UID", async () => {
    // A repeating event exported from Google or Outlook is one VEVENT with an
    // RRULE plus one per modified occurrence, and every one of them repeats the
    // same UID. Keying the list on the UID made a real file crash the dialog.
    const override = { ...CANDIDATE, title: "Community call (moved)" };
    fetchMock.mockResolvedValue(respond(previewOf([CANDIDATE, override])));
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() => expect(screen.getByText("2 events found")).toBeInTheDocument());
    expect(screen.getByText("Community call (moved)")).toBeInTheDocument();
  });

  it("renders events with no UID at all", async () => {
    const anonymous = { ...CANDIDATE, uid: null };
    fetchMock.mockResolvedValue(
      respond(previewOf([anonymous, { ...anonymous, title: "ApacheCon" }])),
    );
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() => expect(screen.getByText("2 events found")).toBeInTheDocument());
    expect(screen.getByText("ApacheCon")).toBeInTheDocument();
  });

  it("repeats a warning the file raises twice", async () => {
    const twice = ["Two entries were skipped.", "Two entries were skipped."];
    fetchMock.mockResolvedValue(respond(previewOf([CANDIDATE], twice)));
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() => expect(screen.getAllByText("Two entries were skipped.")).toHaveLength(2));
  });

  it("repeats a warning one event raises twice", async () => {
    const noisy = { ...CANDIDATE, warnings: ["Something was cut short.", "Something was cut short."] };
    fetchMock.mockResolvedValue(respond(previewOf([noisy])));
    const { container } = render(ImportDialog, { props: props() });
    await attach(container);
    await waitFor(() => expect(screen.getAllByText("Something was cut short.")).toHaveLength(2));
  });

  it("reports a file it cannot read", async () => {
    fetchMock.mockResolvedValue(
      respond({ error: "That does not look like an iCalendar (.ics) file.", field: "file" }, 400),
    );
    const { container } = render(ImportDialog, { props: props() });
    await attach(container, new File(["nope"], "holiday.jpg", { type: "image/jpeg" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not look like an iCalendar");
    expect(importButton()).toBeDisabled();
  });
});

describe("choosing where the events go", () => {
  async function withPreview() {
    fetchMock.mockResolvedValue(respond(previewOf()));
    const rendered = render(ImportDialog, { props: props() });
    await attach(rendered.container);
    await waitFor(() => expect(screen.getByText("Community call")).toBeInTheDocument());
    return rendered;
  }

  it("will not save until a calendar is chosen", async () => {
    await withPreview();
    expect(importButton()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("which calendar these events belong to");
  });

  it("offers only the calendars this session may write to", async () => {
    await withPreview();
    const picker = screen.getByLabelText<HTMLSelectElement>("Calendar");
    const options = [...picker.querySelectorAll("option")].map((option) => option.value);
    expect(options).toEqual(["", "personal", "project"]);
  });

  it("insists on a project and a visibility for a project import", async () => {
    await withPreview();
    await fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "project" } });
    expect(importButton()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("whether they are public or private");
    expect(screen.getByRole("status")).toHaveTextContent("which project they belong to");
  });

  it("enables saving once everything is answered", async () => {
    await withPreview();
    await fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "project" } });
    await fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "public" } });
    expect(importButton()).toBeDisabled();
    await fireEvent.change(screen.getByLabelText("Project"), { target: { value: "httpd" } });
    expect(importButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("asks nothing more for a personal import", async () => {
    await withPreview();
    await fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "personal" } });
    expect(screen.queryByLabelText("Visibility")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
    expect(screen.getByText(/always private to you/)).toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });

  it("nothing is pre-selected, so a wrong default cannot be saved by accident", async () => {
    await withPreview();
    expect(screen.getByLabelText<HTMLSelectElement>("Calendar").value).toBe("");
    await fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "project" } });
    expect(screen.getByLabelText<HTMLSelectElement>("Visibility").value).toBe("");
    expect(screen.getByLabelText<HTMLSelectElement>("Project").value).toBe("");
  });

  it("forgets a project that switching visibility has taken off the list", async () => {
    const committer = makeCalendars({
      can_create: { personal: true, project: ["httpd"], project_private: [], foundation: false },
    });
    fetchMock.mockResolvedValue(respond(previewOf()));
    const { container } = render(ImportDialog, { props: props({ calendars: committer }) });
    await attach(container);
    await waitFor(() => expect(screen.getByText("Community call")).toBeInTheDocument());

    await fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "project" } });
    await fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "public" } });
    await fireEvent.change(screen.getByLabelText("Project"), { target: { value: "httpd" } });
    expect(importButton()).toBeEnabled();
  });
});

describe("saving", () => {
  async function readyToSave() {
    fetchMock.mockResolvedValue(respond(previewOf()));
    const onimported = vi.fn();
    const rendered = render(ImportDialog, { props: props({ onimported }) });
    await attach(rendered.container);
    await waitFor(() => expect(screen.getByText("Community call")).toBeInTheDocument());
    await fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "project" } });
    await fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "private" } });
    await fireEvent.change(screen.getByLabelText("Project"), { target: { value: "httpd" } });
    return { ...rendered, onimported };
  }

  it("posts the file with the chosen settings", async () => {
    const { onimported } = await readyToSave();
    fetchMock.mockResolvedValue(respond({ created: [makeEvent()], count: 1, warnings: [] }, 201));
    await fireEvent.click(importButton());
    await waitFor(() => expect(onimported).toHaveBeenCalledWith(1));

    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).toBe("/api/import");
    const body = init.body as FormData;
    expect(body.get("category")).toBe("project");
    expect(body.get("visibility")).toBe("private");
    expect(body.get("project")).toBe("httpd");
    expect(body.get("file")).toBeInstanceOf(File);
  });

  it("says how many will be imported", async () => {
    await readyToSave();
    expect(importButton()).toHaveTextContent("Import 1 event");
  });

  it("reports a refusal from the server without closing", async () => {
    const { onimported } = await readyToSave();
    fetchMock.mockResolvedValue(
      respond({ error: "You are not a member of the httpd project." }, 403),
    );
    await fireEvent.click(importButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("not a member of the httpd project");
    expect(onimported).not.toHaveBeenCalled();
  });
});

describe("getting out", () => {
  it("closes on Cancel and on Escape", async () => {
    const onclose = vi.fn();
    render(ImportDialog, { props: props({ onclose }) });
    await fireEvent.click(screen.getByText("Cancel"));
    expect(onclose).toHaveBeenCalledOnce();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  it("stays open when the dialog itself is clicked", async () => {
    const onclose = vi.fn();
    render(ImportDialog, { props: props({ onclose }) });
    await fireEvent.click(within(screen.getByRole("dialog")).getByText(/Import events from/));
    expect(onclose).not.toHaveBeenCalled();
  });
});
