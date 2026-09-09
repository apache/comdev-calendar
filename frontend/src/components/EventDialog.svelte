<script lang="ts">
  import type { CalendarEvent, Calendars, Category, EventDraft, Visibility } from "../lib/types";
  import { formatDate, formatTime, fromDayKey, toDateInput, toISO, toLocalInput } from "../lib/dates";
  import { calendarLabel, categoryLabel, eventEnd, eventHue, eventStart } from "../lib/events";
  import type { DisplayZone } from "../lib/timezone";
  import {
    describeDisplayZone,
    fromWallInZone,
    isLocal,
    resolveZone,
    toWallInZone,
    zoneCity,
    zoneLabel,
    zoneList,
  } from "../lib/timezone";
  import { api } from "../lib/api";

  interface Props {
    event: CalendarEvent | null;
    draft: EventDraft | null;
    calendars: Calendars | null;
    saving: boolean;
    error: string | null;
    /** Whether the current user may change this event. */
    editable: boolean;
    /** The timezone the viewer is reading the calendar in. */
    zone?: DisplayZone;
    /** Extra clocks the viewer has asked to see alongside. */
    compareZones?: DisplayZone[];
    onclose: () => void;
    onedit: () => void;
    onsave: (draft: EventDraft) => void;
    ondelete: () => void;
  }

  let {
    event,
    draft,
    calendars,
    saving,
    error,
    editable,
    zone = "local",
    compareZones = [],
    onclose,
    onedit,
    onsave,
    ondelete,
  }: Props = $props();

  const ZONES = zoneList();

  /** A local, editable copy so typing does not mutate the parent's state. */
  let form = $state<EventDraft | null>(null);
  let lastDraft: EventDraft | null = null;

  $effect(() => {
    if (draft !== lastDraft) {
      lastDraft = draft;
      form = draft ? { ...draft } : null;
    }
  });

  let creatableCategories = $derived.by((): Category[] => {
    const can = calendars?.can_create;
    if (!can) return [];
    const list: Category[] = [];
    if (can.personal) list.push("personal");
    if (can.project.length > 0) list.push("project");
    if (can.foundation) list.push("foundation");
    return list;
  });

  let projectOptions = $derived(
    form?.visibility === "private"
      ? (calendars?.can_create.project_private ?? [])
      : (calendars?.can_create.project ?? []),
  );

  /** A committer can only make public events for their projects. */
  let visibilityOptions = $derived.by((): Visibility[] => {
    if (!form) return ["public"];
    if (form.category === "personal") return ["private"];
    if (form.category === "foundation") return ["public", "private"];
    const privateProjects = calendars?.can_create.project_private ?? [];
    return privateProjects.length > 0 ? ["public", "private"] : ["public"];
  });

  function onCategoryChange(category: Category) {
    if (!form) return;
    form.category = category;
    if (category === "personal") {
      form.visibility = "private";
      form.project = null;
    } else if (category === "foundation") {
      form.project = null;
      if (form.visibility === "private" && !calendars?.can_create.foundation) form.visibility = "public";
    } else {
      form.project ??= calendars?.can_create.project[0] ?? null;
    }
  }

  function submit(submitEvent: SubmitEvent) {
    submitEvent.preventDefault();
    if (form) onsave({ ...form });
  }

  function keydown(keyEvent: KeyboardEvent) {
    if (keyEvent.key === "Escape") onclose();
  }

  function copyShortlink() {
    if (event?.shortlink_url) void navigator.clipboard?.writeText(event.shortlink_url);
  }

  function whenLabel(current: CalendarEvent): string {
    const start = eventStart(current, zone);
    const end = eventEnd(current, zone);
    if (current.all_day) {
      const lastDay = new Date(end.getTime() - 1);
      return lastDay.toDateString() === start.toDateString()
        ? `${formatDate(start)} (all day)`
        : `${formatDate(start)} - ${formatDate(lastDay)} (all day)`;
    }
    if (start.toDateString() === end.toDateString()) {
      return `${formatDate(start)}, ${formatTime(start)} - ${formatTime(end)}`;
    }
    return `${formatDate(start)} ${formatTime(start)} - ${formatDate(end)} ${formatTime(end)}`;
  }

  interface ZoneReading {
    key: string;
    label: string;
    when: string;
  }

  /**
   * The same event on other clocks: the organiser's own, and whichever zones
   * the viewer has asked to compare against.
   *
   * All-day events are dates rather than instants, so there is nothing to
   * convert and the list stays empty.
   */
  let otherReadings = $derived.by((): ZoneReading[] => {
    const current = event;
    if (!current || current.all_day) return [];

    const start = new Date(current.start);
    const end = new Date(current.end);
    const primary = eventStart(current, zone).getTime();
    const rows: ZoneReading[] = [];
    const seen = new Set<string>([resolveZone(zone)]);

    const add = (candidate: DisplayZone, suffix = "") => {
      const resolved = resolveZone(candidate);
      if (seen.has(resolved)) return;
      seen.add(resolved);
      const from = toWallInZone(start, resolved);
      // A zone that happens to read the same as the viewer's is just noise.
      if (from.getTime() === primary && !suffix) return;
      const name = isLocal(candidate) ? `Local - ${zoneCity(resolved)}` : zoneCity(resolved);
      rows.push({
        key: resolved,
        label: `${name}${suffix}`,
        when: `${formatTime(from)} - ${formatTime(toWallInZone(end, resolved))}`,
      });
    };

    add(current.timezone || "UTC", " (organiser)");
    for (const candidate of compareZones) add(candidate);
    return rows;
  });

  /**
   * The form's times are entered in the event's own timezone, so that posting
   * "15:00 in Berlin" means exactly that regardless of where the organiser is
   * sitting or which zone they are reading the calendar in.
   *
   * All-day events are dates, not instants, so they stay on the UTC day.
   */
  function setStart(value: string, allDay: boolean) {
    if (!form || !value) return;
    form.start = allDay
      ? toISO(new Date(Date.UTC(...dateParts(value))))
      : toISO(fromWallInZone(new Date(value), form.timezone));
  }

  function setEnd(value: string, allDay: boolean) {
    if (!form || !value) return;
    if (allDay) {
      // The stored end is exclusive: the day after the last day.
      const [year, month, day] = dateParts(value);
      form.end = toISO(new Date(Date.UTC(year, month, day + 1)));
    } else {
      form.end = toISO(fromWallInZone(new Date(value), form.timezone));
    }
  }

  function dateParts(value: string): [number, number, number] {
    const parsed = fromDayKey(value);
    return [parsed.getFullYear(), parsed.getMonth(), parsed.getDate()];
  }

  /** The value to show in a datetime-local input, in the event's timezone. */
  function inputValue(iso: string): string {
    if (!form) return "";
    return toLocalInput(toWallInZone(new Date(iso), form.timezone));
  }

  /** The UTC date to show in a date input for an all-day event. */
  function dateValue(iso: string, exclusiveEnd = false): string {
    const instant = new Date(iso);
    const shifted = exclusiveEnd ? new Date(instant.getTime() - 1) : instant;
    return toDateInput(
      new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
    );
  }

  /**
   * Moving an event to another timezone keeps the wall clock and changes the
   * instant: "the call is still at 15:00, but 15:00 in Tokyo".
   */
  function onTimezoneChange(next: string) {
    if (!form) return;
    const startWall = toWallInZone(new Date(form.start), form.timezone);
    const endWall = toWallInZone(new Date(form.end), form.timezone);
    form.timezone = next;
    form.start = toISO(fromWallInZone(startWall, next));
    form.end = toISO(fromWallInZone(endWall, next));
  }
</script>

<svelte:window onkeydown={keydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="dialog"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={form ? "Edit event" : (event?.title ?? "Event")}
    style="--hue: {event ? eventHue(event) : 210}"
    onclick={(mouseEvent) => mouseEvent.stopPropagation()}
  >
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    {#if form}
      <form onsubmit={submit}>
        <h2>{event ? "Edit event" : "New event"}</h2>

        <label class="row">
          <span>Title</span>
          <input bind:value={form.title} required maxlength="200" placeholder="What is happening?" />
        </label>

        <div class="pair">
          <label class="row">
            <span>Calendar</span>
            <select
              value={form.category}
              onchange={(changeEvent) => onCategoryChange(changeEvent.currentTarget.value as Category)}
              disabled={creatableCategories.length <= 1 && !event}
            >
              {#each creatableCategories as category (category)}
                <option value={category}>{categoryLabel(category)}</option>
              {/each}
            </select>
          </label>

          {#if form.category === "project"}
            <label class="row">
              <span>Project</span>
              <select bind:value={form.project}>
                {#each projectOptions as project (project)}
                  <option value={project}>{project}</option>
                {/each}
              </select>
            </label>
          {/if}

          {#if form.category !== "personal"}
            <label class="row">
              <span>Visibility</span>
              <select bind:value={form.visibility}>
                {#each visibilityOptions as option (option)}
                  <option value={option}>{option}</option>
                {/each}
              </select>
            </label>
          {/if}
        </div>

        <label class="check">
          <input type="checkbox" bind:checked={form.all_day} />
          All day
        </label>

        {#if !form.all_day}
          <label class="row">
            <span>Timezone of these times</span>
            <select
              value={form.timezone}
              onchange={(changeEvent) => onTimezoneChange(changeEvent.currentTarget.value)}
            >
              {#each ZONES as name (name)}
                <option value={name}>{name}</option>
              {/each}
            </select>
            <small class="hint muted">
              Enter the times as they will be in this zone. Everybody else sees them converted to
              their own clock.
            </small>
          </label>
        {/if}

        <div class="pair">
          <label class="row">
            <span>Starts</span>
            {#if form.all_day}
              <input
                type="date"
                value={dateValue(form.start)}
                onchange={(changeEvent) => setStart(changeEvent.currentTarget.value, true)}
                required
              />
            {:else}
              <input
                type="datetime-local"
                value={inputValue(form.start)}
                onchange={(changeEvent) => setStart(changeEvent.currentTarget.value, false)}
                required
              />
            {/if}
          </label>

          <label class="row">
            <span>Ends</span>
            {#if form.all_day}
              <input
                type="date"
                value={dateValue(form.end, true)}
                onchange={(changeEvent) => setEnd(changeEvent.currentTarget.value, true)}
                required
              />
            {:else}
              <input
                type="datetime-local"
                value={inputValue(form.end)}
                onchange={(changeEvent) => setEnd(changeEvent.currentTarget.value, false)}
                required
              />
            {/if}
          </label>
        </div>

        <label class="row">
          <span>Location</span>
          <input bind:value={form.location} maxlength="300" placeholder="Room, city or a meeting link" />
        </label>

        <label class="row">
          <span>Link</span>
          <input bind:value={form.url} type="url" maxlength="2048" placeholder="https://..." />
        </label>

        <label class="row">
          <span>Description</span>
          <textarea bind:value={form.description} maxlength="20000"></textarea>
        </label>

        <footer>
          {#if event}
            <button type="button" class="btn danger" onclick={ondelete} disabled={saving}>Delete</button>
          {/if}
          <span class="spacer"></span>
          <button type="button" class="btn" onclick={onclose} disabled={saving}>Cancel</button>
          <button type="submit" class="btn primary" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </footer>
      </form>
    {:else if event}
      <article>
        <header>
          <span class="tag">{calendarLabel(event)}</span>
          <span class="tag" class:private={event.visibility === "private"}>{event.visibility}</span>
        </header>

        <h2>{event.title}</h2>
        <p class="when">
          {whenLabel(event)}
          <span class="zonehint muted">{event.all_day ? "" : describeDisplayZone(zone)}</span>
        </p>

        {#if otherReadings.length > 0}
          <ul class="clocks">
            {#each otherReadings as reading (reading.key)}
              <li>
                <span class="clockzone" title={zoneLabel(reading.key)}>{reading.label}</span>
                <span class="clocktime">{reading.when}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if event.location}
          <p><strong>Where</strong> {event.location}</p>
        {/if}

        {#if event.url}
          <p><strong>Link</strong> <a href={event.url} rel="noreferrer noopener">{event.url}</a></p>
        {/if}

        {#if event.description}
          <p class="description">{event.description}</p>
        {/if}

        <p class="shortlink">
          <strong>Shortlink</strong>
          <a href={event.shortlink_url}>{event.shortlink_url}</a>
          <button type="button" class="btn" onclick={copyShortlink}>Copy</button>
        </p>

        <p class="muted owner">Added by {event.owner}</p>

        <footer>
          <a class="btn" href={api.icsUrl(event.id)}>Download .ics</a>
          <span class="spacer"></span>
          {#if editable}
            <button type="button" class="btn" onclick={onedit}>Edit</button>
          {/if}
          <button type="button" class="btn primary" onclick={onclose}>Close</button>
        </footer>
      </article>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(10, 14, 20, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 3rem 1rem;
    overflow-y: auto;
    z-index: 50;
  }

  .dialog {
    width: min(38rem, 100%);
    background: var(--bg-panel);
    border-radius: 10px;
    border-top: 4px solid hsl(var(--hue) 55% 50%);
    box-shadow: var(--shadow-lg);
    padding: 1.2rem 1.4rem 1rem;
  }

  h2 {
    margin: 0.2rem 0 0.6rem;
    font-size: 19px;
  }

  .error {
    margin: 0 0 0.8rem;
    padding: 0.5rem 0.7rem;
    border-radius: var(--radius);
    background: hsl(0 70% 95%);
    border: 1px solid hsl(0 60% 75%);
    color: hsl(0 65% 30%);
  }

  @media (prefers-color-scheme: dark) {
    .error {
      background: hsl(0 40% 20%);
      border-color: hsl(0 40% 40%);
      color: hsl(0 70% 85%);
    }
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-bottom: 0.6rem;
    flex: 1 1 10rem;
  }

  .row > span {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .pair {
    display: flex;
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
    font-size: 13px;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--border);
  }

  .spacer {
    flex: 1;
  }

  article header {
    display: flex;
    gap: 0.35rem;
  }

  .tag {
    font-size: 11px;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    color: var(--text-muted);
    text-transform: capitalize;
  }

  .tag.private {
    border-style: dashed;
    color: var(--asf-red);
  }

  .when {
    margin: 0 0 0.3rem;
    font-weight: 600;
  }

  .zonehint {
    font-weight: 400;
    font-size: 12px;
  }

  .clocks {
    list-style: none;
    margin: 0 0 0.8rem;
    padding: 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .clocks li {
    display: flex;
    gap: 0.5rem;
  }

  .clockzone {
    min-width: 11rem;
  }

  .clocktime {
    font-variant-numeric: tabular-nums;
  }

  .hint {
    font-size: 11px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    line-height: 1.3;
  }

  article p {
    margin: 0 0 0.5rem;
  }

  .description {
    white-space: pre-wrap;
    padding: 0.6rem 0.8rem;
    background: var(--bg-subtle);
    border-radius: var(--radius);
  }

  .shortlink {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 13px;
  }

  .shortlink a {
    font-family: var(--mono);
    font-size: 12px;
  }

  .owner {
    font-size: 12px;
  }
</style>
