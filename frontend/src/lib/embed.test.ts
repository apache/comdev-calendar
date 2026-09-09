/** Configuring the embeddable agenda from its query string. */

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DAYS,
  DEFAULT_LIMIT,
  EMBED_PATH,
  HEIGHT_MESSAGE,
  heightMessage,
  isEmbedRoute,
  parseEmbedOptions,
} from "./embed";

afterEach(() => {
  for (const tag of [...document.head.querySelectorAll("base")]) tag.remove();
});

describe("recognising the route", () => {
  it("matches the embed path", () => {
    expect(isEmbedRoute(EMBED_PATH)).toBe(true);
    expect(isEmbedRoute(`${EMBED_PATH}/`)).toBe(true);
  });

  it("does not match anything else", () => {
    expect(isEmbedRoute("/")).toBe(false);
    expect(isEmbedRoute("/help")).toBe(false);
    expect(isEmbedRoute("/embed")).toBe(false);
    expect(isEmbedRoute("/embed/agenda/extra")).toBe(false);
  });

  it("respects the app's mount point", () => {
    const tag = document.createElement("base");
    tag.setAttribute("href", "/calendar/");
    document.head.appendChild(tag);
    expect(isEmbedRoute("/calendar/embed/agenda")).toBe(true);
    expect(isEmbedRoute("/embed/agenda")).toBe(false);
  });
});

describe("defaults", () => {
  const options = parseEmbedOptions("");

  it("looks a couple of months ahead", () => {
    expect(options.days).toBe(DEFAULT_DAYS);
    expect(options.limit).toBe(DEFAULT_LIMIT);
  });

  it("shows every calendar the viewer can see", () => {
    expect(options.categories).toEqual([]);
    expect(options.projects).toEqual([]);
  });

  it("uses the reader's own clock", () => {
    expect(options.zone).toBe("local");
    expect(options.showZone).toBe(true);
  });

  it("has no heading, a solid background and a credit link", () => {
    expect(options.title).toBeNull();
    expect(options.transparent).toBe(false);
    expect(options.showCredit).toBe(true);
    expect(options.theme).toBe("auto");
  });
});

describe("filters", () => {
  it("takes repeated or comma-separated projects", () => {
    expect(parseEmbedOptions("?project=httpd&project=tomcat").projects).toEqual(["httpd", "tomcat"]);
    expect(parseEmbedOptions("?projects=httpd,tomcat").projects).toEqual(["httpd", "tomcat"]);
  });

  it("lowercases project names", () => {
    expect(parseEmbedOptions("?project=HTTPD").projects).toEqual(["httpd"]);
  });

  it("takes categories, ignoring ones that do not exist", () => {
    expect(parseEmbedOptions("?category=project,foundation").categories).toEqual([
      "project",
      "foundation",
    ]);
    expect(parseEmbedOptions("?category=nonsense").categories).toEqual([]);
  });

  it("takes a search term", () => {
    expect(parseEmbedOptions("?q=%20release%20").search).toBe("release");
  });
});

describe("numbers", () => {
  it("are read when sensible", () => {
    expect(parseEmbedOptions("?days=7&limit=5").days).toBe(7);
    expect(parseEmbedOptions("?days=7&limit=5").limit).toBe(5);
  });

  it("are clamped rather than trusted", () => {
    expect(parseEmbedOptions("?days=99999").days).toBe(366);
    expect(parseEmbedOptions("?days=0").days).toBe(1);
    expect(parseEmbedOptions("?limit=99999").limit).toBe(100);
    expect(parseEmbedOptions("?limit=-3").limit).toBe(1);
  });

  it("fall back when they are not numbers at all", () => {
    expect(parseEmbedOptions("?days=lots").days).toBe(DEFAULT_DAYS);
    expect(parseEmbedOptions("?limit=").limit).toBe(DEFAULT_LIMIT);
  });
});

describe("presentation", () => {
  it("takes a heading", () => {
    expect(parseEmbedOptions("?title=Upcoming%20httpd%20events").title).toBe("Upcoming httpd events");
    expect(parseEmbedOptions("?title=%20%20").title).toBeNull();
  });

  it("takes boolean flags in the spellings people actually type", () => {
    expect(parseEmbedOptions("?transparent=1").transparent).toBe(true);
    expect(parseEmbedOptions("?transparent").transparent).toBe(true);
    expect(parseEmbedOptions("?transparent=true").transparent).toBe(true);
    expect(parseEmbedOptions("?transparent=0").transparent).toBe(false);
    expect(parseEmbedOptions("?transparent=no").transparent).toBe(false);
    expect(parseEmbedOptions("?credit=false").showCredit).toBe(false);
    expect(parseEmbedOptions("?showzone=off").showZone).toBe(false);
  });

  it("takes a theme, ignoring ones it does not have", () => {
    expect(parseEmbedOptions("?theme=dark").theme).toBe("dark");
    expect(parseEmbedOptions("?theme=light").theme).toBe("light");
    expect(parseEmbedOptions("?theme=neon").theme).toBe("auto");
  });
});

describe("the display zone", () => {
  it("takes an IANA name", () => {
    expect(parseEmbedOptions("?zone=Asia/Tokyo").zone).toBe("Asia/Tokyo");
    expect(parseEmbedOptions("?zone=UTC").zone).toBe("UTC");
  });

  it("takes the local sentinel", () => {
    expect(parseEmbedOptions("?zone=local").zone).toBe("local");
  });

  it("falls back to the reader's own clock for anything else", () => {
    expect(parseEmbedOptions("?zone=Mars/Olympus").zone).toBe("local");
    expect(parseEmbedOptions("?zone=").zone).toBe("local");
  });
});

describe("the height message", () => {
  it("carries nothing but a rounded pixel height", () => {
    expect(heightMessage(412.3)).toEqual({ type: HEIGHT_MESSAGE, height: 413 });
    expect(Object.keys(heightMessage(10))).toEqual(["type", "height"]);
  });
});
