<script lang="ts">
  import { apiUrl, assetUrl } from "../lib/base";

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  interface SwaggerRequest {
    headers: Record<string, string>;
    credentials?: RequestCredentials;
  }

  type SwaggerFactory = (options: Record<string, unknown>) => unknown;

  let host = $state<HTMLElement | null>(null);
  let status = $state<"loading" | "ready" | "failed">("loading");
  let failure = $state<string | null>(null);

  const SCRIPT = "vendor/swagger-ui-bundle.js";
  const STYLES = "vendor/swagger-ui.css";

  /** Loads a script once, reusing the tag if the docs are opened again. */
  function loadScript(src: string): Promise<void> {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-swagger="${src}"]`);
    if (existing) {
      return existing.dataset.loaded === "yes"
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
            existing.addEventListener("load", () => resolve());
            existing.addEventListener("error", () => reject(new Error(src)));
          });
    }
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      tag.async = true;
      tag.dataset.swagger = src;
      tag.addEventListener("load", () => {
        tag.dataset.loaded = "yes";
        resolve();
      });
      tag.addEventListener("error", () => reject(new Error(src)));
      document.head.appendChild(tag);
    });
  }

  /**
   * Swagger UI's stylesheet has a few rules that are not scoped to its own
   * container, so it is removed again when the docs are closed rather than
   * left to affect the calendar.
   */
  function loadStyles(href: string): HTMLLinkElement {
    const tag = document.createElement("link");
    tag.rel = "stylesheet";
    tag.href = href;
    tag.dataset.swagger = "styles";
    document.head.appendChild(tag);
    return tag;
  }

  $effect(() => {
    if (!host) return;
    const styles = loadStyles(assetUrl(STYLES));
    let cancelled = false;

    void (async () => {
      try {
        await loadScript(assetUrl(SCRIPT));
        const factory = (globalThis as { SwaggerUIBundle?: SwaggerFactory }).SwaggerUIBundle;
        if (!factory) throw new Error("SwaggerUIBundle did not register itself");
        if (cancelled || !host) return;

        factory({
          url: apiUrl("/openapi.json"),
          domNode: host,
          deepLinking: false,
          docExpansion: "list",
          defaultModelsExpandDepth: 1,
          tryItOutEnabled: true,
          persistAuthorization: false,
          supportedSubmitMethods: ["get", "post", "put", "patch", "delete"],
          requestInterceptor: (request: SwaggerRequest) => {
            // Without this the API answers an unauthenticated write with a
            // redirect to the OAuth provider instead of a readable 401.
            request.headers["X-No-Redirect"] = "1";
            // Same origin as the docs page, so a logged-in reader can try the
            // endpoints that need a session.
            request.credentials = "same-origin";
            return request;
          },
        });
        status = "ready";
      } catch (error) {
        failure =
          error instanceof Error && error.message.includes(SCRIPT)
            ? "Swagger UI could not be loaded. If this is a development server, run 'npm run build' " +
              "in frontend/ so the vendored files are in place."
            : "Swagger UI could not be started.";
        status = "failed";
      }
    })();

    return () => {
      cancelled = true;
      styles.remove();
    };
  });
</script>

<div class="docs">
  <header>
    <div>
      <h2>HTTP API</h2>
      <p class="muted">
        Generated from the running service, so it always describes this deployment. Machine-readable
        copies: <a href={apiUrl("/openapi.json")}>openapi.json</a> and
        <a href={apiUrl("/openapi.yaml")}>openapi.yaml</a>.
      </p>
    </div>
    <button type="button" class="btn" onclick={onclose}>Back to the calendar</button>
  </header>

  {#if status === "loading"}
    <p class="note">Loading the API documentation...</p>
  {:else if status === "failed"}
    <p class="note error" role="alert">{failure}</p>
  {/if}

  <div class="swagger" bind:this={host}></div>
</div>

<style>
  .docs {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1.2rem 1rem 4rem;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    max-width: 72rem;
    margin: 0 auto 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 22px;
  }

  header p {
    margin: 0.2rem 0 0;
    font-size: 13px;
    max-width: 60ch;
  }

  .note {
    max-width: 72rem;
    margin: 1rem auto;
    color: var(--text-muted);
  }

  .note.error {
    color: var(--asf-red);
  }

  .swagger {
    max-width: 72rem;
    margin: 0 auto;
  }

  /* Swagger UI ships its own white theme. Keeping it on a light card rather
     than fighting it means it stays legible when the calendar is in dark mode. */
  .swagger:not(:empty) {
    background: #fff;
    color: #3b4151;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    overflow: hidden;
  }
</style>
