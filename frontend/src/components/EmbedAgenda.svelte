<script lang="ts">
  import type { CalendarEvent } from "../lib/types";
  import { api, ApiError } from "../lib/api";
  import { addDays, formatTime, startOfDay, MONTH_NAMES, WEEKDAY_NAMES } from "../lib/dates";
  import { agendaSections, calendarLabel, eventEnd, eventHue, eventStart } from "../lib/events";
  import { describeDisplayZone, nowInZone, shortZoneLabel } from "../lib/timezone";
  import { appPath } from "../lib/base";
  import { heightMessage, parseEmbedOptions } from "../lib/embed";

  interface Props {
    /** The query string to configure from. Defaults to the current URL's. */
    search?: string;
  }

  let { search = globalThis.location?.search ?? "" }: Props = $props();

  let options = $derived(parseEmbedOptions(search));

  let events = $state<CalendarEvent[]>([]);
  let loading = $state(true);
  let failure = $state<string | null>(null);

  let sections = $derived(agendaSections(events, options.zone));
  let root = $state<HTMLElement | null>(null);

  async function load() {
    loading = true;
    const from = startOfDay(nowInZone(options.zone));
    try {
      events = await api.events({
        start: from,
        end: addDays(from, options.days),
        categories: options.categories,
        projects: options.projects,
        q: options.search || undefined,
        sort: "start",
        limit: options.limit,
      });
      failure = null;
    } catch (error) {
      failure =
        error instanceof ApiError
          ? error.message
          : "The calendar could not be reached.";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void options;
    void load();
  });

  // Let the host page size its iframe to the content. An iframe cannot do this
  // for itself, so we measure and tell whoever is framing us.
  $effect(() => {
    if (!root) return;
    // Re-measure whenever the content changes, not only when the box does.
    void sections;
    void loading;

    const send = () => {
      const height = Math.max(
        root?.scrollHeight ?? 0,
        globalThis.document?.documentElement?.scrollHeight ?? 0,
      );
      globalThis.parent?.postMessage(heightMessage(height), "*");
    };
    send();

    // Everything current has ResizeObserver, but the first measurement above
    // should not depend on it.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(send);
    observer.observe(root);
    return () => observer.disconnect();
  });

  function dayHeading(date: Date): string {
    const weekday = WEEKDAY_NAMES[(date.getDay() + 6) % 7];
    return `${weekday} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
  }

  function when(event: CalendarEvent): string {
    if (event.all_day) return "All day";
    return `${formatTime(eventStart(event, options.zone))} - ${formatTime(eventEnd(event, options.zone))}`;
  }
</script>

<div
  bind:this={root}
  class="embed"
  class:transparent={options.transparent}
  data-theme={options.theme === "auto" ? null : options.theme}
>
  {#if options.title}
    <h1>{options.title}</h1>
  {/if}

  {#if loading}
    <p class="note">Loading events...</p>
  {:else if failure}
    <p class="note error" role="alert">{failure}</p>
  {:else if sections.length === 0}
    <p class="note">No events coming up.</p>
  {:else}
    {#each sections as section (section.key)}
      <section>
        <h2>{dayHeading(section.date)}</h2>
        <ul>
          {#each section.events as event (event.id)}
            <li style="--hue: {eventHue(event)}">
              <a href={event.shortlink_url} target="_blank" rel="noopener noreferrer">
                <span class="when">{when(event)}</span>
                <span class="title">{event.title}</span>
              </a>
              <span class="meta">
                <span class="tag">{calendarLabel(event)}</span>
                {#if event.location}<span class="where">{event.location}</span>{/if}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}

  {#if options.showZone && !loading && !failure}
    <p class="zone" title={describeDisplayZone(options.zone)}>
      Times shown in {shortZoneLabel(options.zone)}
    </p>
  {/if}

  {#if options.showCredit}
    <p class="credit">
      <a href={appPath("/")} target="_blank" rel="noopener noreferrer">ASF Community Calendar</a>
    </p>
  {/if}
</div>

<style>
  .embed {
    padding: 0.75rem;
    background: var(--bg-panel);
    color: var(--text);
    font-size: 13px;
  }

  .embed.transparent {
    background: transparent;
  }

  h1 {
    margin: 0 0 0.6rem;
    font-size: 15px;
    font-weight: 700;
  }

  h2 {
    margin: 0.9rem 0 0.25rem;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.2rem;
  }

  section:first-of-type h2 {
    margin-top: 0;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    border-left: 3px solid hsl(var(--hue) 55% 55%);
    padding: 0.25rem 0 0.25rem 0.5rem;
    margin: 0.25rem 0;
  }

  a {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    color: inherit;
    text-decoration: none;
  }

  a:hover .title {
    text-decoration: underline;
  }

  .when {
    flex: none;
    width: 6.5rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    font-size: 12px;
  }

  .title {
    font-weight: 600;
  }

  .meta {
    display: flex;
    gap: 0.4rem;
    padding-left: 7rem;
    font-size: 11px;
    color: var(--text-faint);
  }

  .tag {
    text-transform: lowercase;
  }

  .note {
    margin: 0.5rem 0;
    color: var(--text-muted);
  }

  .note.error {
    color: var(--asf-red);
  }

  .zone,
  .credit {
    margin: 0.6rem 0 0;
    font-size: 11px;
    color: var(--text-faint);
  }

  .credit a {
    color: var(--text-faint);
    text-decoration: underline;
  }

  @media (max-width: 24rem) {
    a {
      flex-wrap: wrap;
    }

    .when {
      width: auto;
    }

    .meta {
      padding-left: 0;
    }
  }
</style>
