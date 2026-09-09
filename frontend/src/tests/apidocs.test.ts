/**
 * The API documentation panel.
 *
 * Swagger UI is a vendored static asset rather than a bundled import, so these
 * tests stand in for the script tag and check the wiring around it: that the
 * right URLs are used, that the stylesheet is cleaned up, and that a missing
 * vendor file is reported rather than leaving a blank page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/svelte";

import ApiDocs from "../components/ApiDocs.svelte";

const noop = () => {};

/**
 * Stands in for the browser fetching the vendored script. Real jsdom does not
 * execute src scripts, so we watch for the tag and fire its load event.
 */
function serveSwagger(options: { fail?: boolean } = {}) {
  const factory = vi.fn();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLScriptElement) || !node.dataset.swagger) continue;
        if (options.fail) {
          node.dispatchEvent(new Event("error"));
        } else {
          (globalThis as { SwaggerUIBundle?: unknown }).SwaggerUIBundle = factory;
          node.dispatchEvent(new Event("load"));
        }
      }
    }
  });
  observer.observe(document.head, { childList: true });
  return { factory, stop: () => observer.disconnect() };
}

let swagger: ReturnType<typeof serveSwagger> | null = null;

beforeEach(() => {
  delete (globalThis as { SwaggerUIBundle?: unknown }).SwaggerUIBundle;
});

afterEach(() => {
  swagger?.stop();
  swagger = null;
  for (const tag of [...document.head.querySelectorAll("[data-swagger]")]) tag.remove();
  for (const tag of [...document.head.querySelectorAll("base")]) tag.remove();
});

describe("the panel itself", () => {
  it("links to the machine-readable spec in both formats", () => {
    swagger = serveSwagger();
    render(ApiDocs, { props: { onclose: noop } });
    expect(screen.getByText("openapi.json")).toHaveAttribute("href", "/api/openapi.json");
    expect(screen.getByText("openapi.yaml")).toHaveAttribute("href", "/api/openapi.yaml");
  });

  it("has a way back to the calendar", async () => {
    swagger = serveSwagger();
    const onclose = vi.fn();
    render(ApiDocs, { props: { onclose } });
    (await screen.findByText("Back to the calendar")).click();
    expect(onclose).toHaveBeenCalledOnce();
  });
});

describe("starting Swagger UI", () => {
  it("points it at this deployment's spec", async () => {
    swagger = serveSwagger();
    render(ApiDocs, { props: { onclose: noop } });
    await waitFor(() => expect(swagger!.factory).toHaveBeenCalled());
    const options = swagger!.factory.mock.calls[0][0] as Record<string, unknown>;
    expect(options.url).toBe("/api/openapi.json");
    expect(options.domNode).toBeInstanceOf(HTMLElement);
  });

  it("asks for JSON errors rather than an OAuth redirect", async () => {
    swagger = serveSwagger();
    render(ApiDocs, { props: { onclose: noop } });
    await waitFor(() => expect(swagger!.factory).toHaveBeenCalled());
    const options = swagger!.factory.mock.calls[0][0] as {
      requestInterceptor: (request: { headers: Record<string, string> }) => {
        headers: Record<string, string>;
        credentials?: string;
      };
    };
    const request = options.requestInterceptor({ headers: {} });
    expect(request.headers["X-No-Redirect"]).toBe("1");
    // Same origin as the docs page, so "try it out" works when logged in.
    expect(request.credentials).toBe("same-origin");
  });

  it("loads the vendored asset, not a CDN", async () => {
    swagger = serveSwagger();
    render(ApiDocs, { props: { onclose: noop } });
    await waitFor(() => expect(swagger!.factory).toHaveBeenCalled());
    const script = document.head.querySelector<HTMLScriptElement>("script[data-swagger]")!;
    expect(script.src).toContain("/vendor/swagger-ui-bundle.js");
    expect(script.src).not.toContain("//unpkg");
    expect(script.src).not.toContain("//cdn");
  });

  it("respects the app's mount point", async () => {
    const base = document.createElement("base");
    base.setAttribute("href", "/calendar/");
    document.head.appendChild(base);
    swagger = serveSwagger();
    render(ApiDocs, { props: { onclose: noop } });
    await waitFor(() => expect(swagger!.factory).toHaveBeenCalled());
    const options = swagger!.factory.mock.calls[0][0] as { url: string };
    expect(options.url).toBe("/calendar/api/openapi.json");
    const script = document.head.querySelector<HTMLScriptElement>("script[data-swagger]")!;
    expect(new URL(script.src).pathname).toBe("/calendar/vendor/swagger-ui-bundle.js");
  });
});

describe("its stylesheet", () => {
  it("is added while the docs are open", async () => {
    swagger = serveSwagger();
    render(ApiDocs, { props: { onclose: noop } });
    await waitFor(() =>
      expect(document.head.querySelector('link[data-swagger="styles"]')).not.toBeNull(),
    );
  });

  it("is taken away again, so it cannot restyle the calendar", async () => {
    swagger = serveSwagger();
    const { unmount } = render(ApiDocs, { props: { onclose: noop } });
    await waitFor(() =>
      expect(document.head.querySelector('link[data-swagger="styles"]')).not.toBeNull(),
    );
    unmount();
    expect(document.head.querySelector('link[data-swagger="styles"]')).toBeNull();
  });
});

describe("when it cannot be loaded", () => {
  it("says so rather than showing an empty page", async () => {
    swagger = serveSwagger({ fail: true });
    render(ApiDocs, { props: { onclose: noop } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Swagger UI could not be loaded");
    expect(alert).toHaveTextContent("npm run build");
  });

  it("copes with the script loading but registering nothing", async () => {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLScriptElement && node.dataset.swagger) {
            node.dispatchEvent(new Event("load"));
          }
        }
      }
    });
    observer.observe(document.head, { childList: true });
    try {
      render(ApiDocs, { props: { onclose: noop } });
      expect(await screen.findByRole("alert")).toHaveTextContent("could not be started");
    } finally {
      observer.disconnect();
    }
  });
});
