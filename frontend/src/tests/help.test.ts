/** The help page. */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/svelte";

import HelpPage from "../components/HelpPage.svelte";
import { anonymousCalendars, makeCalendars } from "./factories";

const noop = () => {};

function props(overrides: Record<string, unknown> = {}) {
  return {
    calendars: makeCalendars(),
    session: { authenticated: true, uid: "alice", logout_url: "/auth?logout=/" },
    zone: "local" as const,
    onclose: noop,
    ...overrides,
  };
}

describe("what it explains", () => {
  it("covers the three calendars", () => {
    const { container } = render(HelpPage, { props: props() });
    expect(screen.getByText("The three calendars")).toBeInTheDocument();
    const terms = [...container.querySelectorAll("dt")].map((term) => term.textContent?.trim());
    expect(terms).toEqual(["Personal", "Project", "Foundation"]);
    expect(container.querySelectorAll("dd")).toHaveLength(3);
  });

  it("has a section for each part of the UI", () => {
    render(HelpPage, { props: props() });
    for (const heading of [
      "Who can do what",
      "Getting around",
      "Filters and search",
      "Timezones",
      "Adding and changing events",
      "Shortlinks and subscribing",
      "Signing in",
    ]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it("spells out the audiences in the permissions table", () => {
    const { container } = render(HelpPage, { props: props() });
    const header = container.querySelector("thead")!;
    for (const column of ["Anyone", "Project member", "Committee member", "Foundation member"]) {
      expect(within(header).getByText(column)).toBeInTheDocument();
    }
  });

  it("lists a row for each capability", () => {
    const { container } = render(HelpPage, { props: props() });
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(screen.getByText("See private foundation events")).toBeInTheDocument();
    expect(screen.getByText("Keep personal events")).toBeInTheDocument();
  });

  it("marks what anonymous visitors cannot do", () => {
    const { container } = render(HelpPage, { props: props() });
    const row = [...container.querySelectorAll("tbody tr")].find((candidate) =>
      candidate.textContent?.startsWith("Add and edit foundation events"),
    )!;
    const cells = row.querySelectorAll("td");
    expect(within(cells[0] as HTMLElement).getByLabelText("no")).toBeInTheDocument();
    expect(within(cells[3] as HTMLElement).getByLabelText("yes")).toBeInTheDocument();
  });
});

describe("what it says about you", () => {
  it("tells an anonymous visitor where they stand", () => {
    render(HelpPage, {
      props: props({ calendars: anonymousCalendars, session: { authenticated: false } }),
    });
    expect(screen.getByText(/browsing anonymously/)).toBeInTheDocument();
    expect(screen.getByText("Log in")).toBeInTheDocument();
  });

  it("lists the projects and committees of a signed-in user", () => {
    render(HelpPage, { props: props() });
    const status = screen.getByText(/signed in as alice/);
    expect(status).toHaveTextContent("httpd, tomcat");
    expect(status).toHaveTextContent("httpd committee");
  });

  it("mentions foundation membership", () => {
    render(HelpPage, {
      props: props({ calendars: makeCalendars({ is_member: true }) }),
    });
    expect(screen.getByText(/signed in as alice/)).toHaveTextContent("a foundation member");
  });

  it("says which timezone setting is in force", () => {
    const { container } = render(HelpPage, { props: props({ zone: "utc" }) });
    expect(container.querySelector("#timezones")).toHaveTextContent("It is currently set to UTC");
  });

  it("and says so for local too", () => {
    const { container } = render(HelpPage, { props: props({ zone: "local" }) });
    expect(container.querySelector("#timezones")).toHaveTextContent(
      "It is currently set to your local timezone",
    );
  });
});

describe("getting back", () => {
  it("has a way out at the top and the bottom", async () => {
    const onclose = vi.fn();
    render(HelpPage, { props: props({ onclose }) });
    const buttons = screen.getAllByText("Back to the calendar");
    expect(buttons).toHaveLength(2);
    await fireEvent.click(buttons[0]);
    await fireEvent.click(buttons[1]);
    expect(onclose).toHaveBeenCalledTimes(2);
  });
});
