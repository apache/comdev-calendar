<script lang="ts">
  import type { Calendars, Category, Visibility } from "../lib/types";
  import type { DisplayZone } from "../lib/timezone";
  import type { ImportCandidate, ImportPreview, ImportSettings } from "../lib/importing";
  import {
    emptySettings,
    importReadiness,
    importableCategories,
    importableProjects,
    importableVisibilities,
    looksLikeCalendar,
    reconcile,
    resolveSettings,
  } from "../lib/importing";
  import { api, ApiError } from "../lib/api";
  import { formatDate, formatTime } from "../lib/dates";
  import { categoryLabel } from "../lib/events";
  import { shortZoneLabel, toWall } from "../lib/timezone";

  interface Props {
    calendars: Calendars | null;
    /** The clock the reader is using, so the preview matches the calendar. */
    zone?: DisplayZone;
    onclose: () => void;
    /** Called with the number of events created, so the calendar can reload. */
    onimported: (count: number) => void;
  }

  let { calendars, zone = "local", onclose, onimported }: Props = $props();

  let file = $state<File | null>(null);
  let preview = $state<ImportPreview | null>(null);
  let settings = $state<ImportSettings>(emptySettings());
  let reading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let dragging = $state(false);

  let categories = $derived(importableCategories(calendars));
  let visibilities = $derived(importableVisibilities(settings.category, calendars));
  let projects = $derived(importableProjects(calendars, settings.visibility));
  let readiness = $derived(importReadiness(settings, calendars));
  let canSave = $derived(preview !== null && preview.count > 0 && readiness.ready && !saving);

  function update(change: Partial<ImportSettings>) {
    settings = reconcile({ ...settings, ...change }, calendars);
  }

  async function choose(chosen: File | null | undefined) {
    if (!chosen) return;
    file = chosen;
    preview = null;
    error = null;
    reading = true;
    try {
      preview = await api.previewImport(chosen);
      if (!looksLikeCalendar(chosen)) {
        // It parsed, so the name was just unhelpful. Worth knowing, not worth
        // refusing.
        error = null;
      }
    } catch (failure) {
      error = failure instanceof ApiError ? failure.message : "That file could not be read.";
      file = null;
    } finally {
      reading = false;
    }
  }

  async function save() {
    if (!file || !canSave) return;
    saving = true;
    error = null;
    try {
      const result = await api.runImport(file, resolveSettings(settings));
      onimported(result.count);
    } catch (failure) {
      error = failure instanceof ApiError ? failure.message : "Those events could not be saved.";
    } finally {
      saving = false;
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    void choose(event.dataTransfer?.files?.[0]);
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") onclose();
  }

  function when(candidate: ImportCandidate): string {
    const start = toWall(new Date(candidate.start), zone);
    if (candidate.all_day) {
      const last = toWall(new Date(new Date(candidate.end).getTime() - 1), zone);
      return last.toDateString() === start.toDateString()
        ? `${formatDate(start)} (all day)`
        : `${formatDate(start)} - ${formatDate(last)} (all day)`;
    }
    const end = toWall(new Date(candidate.end), zone);
    return `${formatDate(start)}, ${formatTime(start)} - ${formatTime(end)} ${shortZoneLabel(zone)}`;
  }

  let warningCount = $derived(
    (preview?.warnings.length ?? 0) +
      (preview?.events ?? []).reduce((total, event) => total + event.warnings.length, 0),
  );
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
    aria-label="Import an iCalendar file"
    onclick={(event) => event.stopPropagation()}
  >
    <h2>Import events from a calendar file</h2>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="dropzone"
      class:dragging
      ondragover={(event) => {
        event.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
    >
      <label class="btn">
        Choose a file
        <input
          type="file"
          accept=".ics,text/calendar"
          onchange={(event) => choose(event.currentTarget.files?.[0])}
        />
      </label>
      <span class="muted">
        {#if file}{file.name}{:else}or drop an .ics file here{/if}
      </span>
    </div>

    {#if reading}
      <p class="note">Reading the file...</p>
    {/if}

    {#if preview}
      <section class="preview">
        <h3>
          {preview.count}
          {preview.count === 1 ? "event" : "events"} found
          {#if warningCount > 0}
            <span class="muted">- {warningCount} thing{warningCount === 1 ? "" : "s"} to note</span>
          {/if}
        </h3>

        {#each preview.warnings as warning}
          <p class="warning">{warning}</p>
        {/each}

        <!--
          These three lists are unkeyed on purpose. A preview is replaced whole
          or not at all, so there is no identity to preserve across a change,
          and nothing in a file is unique enough to key on: a repeating event
          exported from Google or Outlook repeats its UID on every modified
          occurrence, and two entries can raise word-for-word the same warning.
        -->
        <ul>
          {#each preview.events as candidate}
            <li>
              <span class="title">{candidate.title}</span>
              <span class="when">{when(candidate)}</span>
              {#if candidate.location}<span class="where muted">{candidate.location}</span>{/if}
              {#each candidate.warnings as warning}
                <span class="warning inline">{warning}</span>
              {/each}
            </li>
          {/each}
        </ul>
      </section>

      <section class="settings">
        <h3>Where should they go?</h3>

        <div class="pair">
          <label class="row">
            <span>Calendar</span>
            <select
              value={settings.category ?? ""}
              onchange={(event) =>
                update({ category: (event.currentTarget.value || null) as Category | null })}
            >
              <option value="">Choose...</option>
              {#each categories as category (category)}
                <option value={category}>{categoryLabel(category)}</option>
              {/each}
            </select>
          </label>

          {#if settings.category !== null && settings.category !== "personal"}
            <label class="row">
              <span>Visibility</span>
              <select
                value={settings.visibility ?? ""}
                onchange={(event) =>
                  update({ visibility: (event.currentTarget.value || null) as Visibility | null })}
              >
                <option value="">Choose...</option>
                {#each visibilities as visibility (visibility)}
                  <option value={visibility}>{visibility}</option>
                {/each}
              </select>
            </label>
          {/if}

          {#if settings.category === "project"}
            <label class="row">
              <span>Project</span>
              <select
                value={settings.project ?? ""}
                onchange={(event) => update({ project: event.currentTarget.value || null })}
              >
                <option value="">Choose...</option>
                {#each projects as project (project)}
                  <option value={project}>{project}</option>
                {/each}
              </select>
            </label>
          {/if}
        </div>

        {#if settings.category === "personal"}
          <p class="muted small">Personal events are always private to you.</p>
        {/if}

        {#if !readiness.ready}
          <p class="missing" role="status">
            Still to choose: {readiness.missing.join(", ")}.
          </p>
        {/if}
      </section>
    {/if}

    <footer>
      <span class="spacer"></span>
      <button type="button" class="btn" onclick={onclose} disabled={saving}>Cancel</button>
      <button type="button" class="btn primary" onclick={save} disabled={!canSave}>
        {#if saving}
          Importing...
        {:else if preview}
          Import {preview.count} {preview.count === 1 ? "event" : "events"}
        {:else}
          Import
        {/if}
      </button>
    </footer>
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
    width: min(42rem, 100%);
    background: var(--bg-panel);
    border-radius: 10px;
    border-top: 4px solid var(--asf-red);
    box-shadow: var(--shadow-lg);
    padding: 1.2rem 1.4rem 1rem;
  }

  h2 {
    margin: 0 0 0.8rem;
    font-size: 19px;
  }

  h3 {
    margin: 0 0 0.4rem;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .error {
    margin: 0 0 0.8rem;
    padding: 0.5rem 0.7rem;
    border-radius: var(--radius);
    background: hsl(0 70% 95%);
    border: 1px solid hsl(0 60% 75%);
    color: hsl(0 65% 30%);
  }

  .dropzone {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }

  .dropzone.dragging {
    border-color: var(--asf-red);
    background: var(--bg-hover);
  }

  .dropzone input[type="file"] {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .dropzone label {
    cursor: pointer;
  }

  .note {
    margin: 0.7rem 0 0;
    color: var(--text-muted);
  }

  .preview,
  .settings {
    margin-top: 1.1rem;
  }

  .preview ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 16rem;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .preview li {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }

  .preview li:last-child {
    border-bottom: 0;
  }

  .title {
    font-weight: 600;
  }

  .when {
    font-size: 12px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .where {
    font-size: 12px;
  }

  .warning {
    margin: 0 0 0.4rem;
    font-size: 12px;
    color: hsl(28 70% 30%);
    background: hsl(38 92% 92%);
    border: 1px solid hsl(38 60% 78%);
    border-radius: var(--radius);
    padding: 0.3rem 0.5rem;
  }

  .warning.inline {
    margin: 0.2rem 0 0;
    display: block;
  }

  .pair {
    display: flex;
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1 1 10rem;
  }

  .row > span {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .missing {
    margin: 0.6rem 0 0;
    font-size: 13px;
    color: var(--asf-red);
  }

  .small {
    font-size: 12px;
    margin: 0.5rem 0 0;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1.2rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--border);
  }

  .spacer {
    flex: 1;
  }

  @media (prefers-color-scheme: dark) {
    .error {
      background: hsl(0 40% 20%);
      border-color: hsl(0 40% 40%);
      color: hsl(0 70% 85%);
    }

    .warning {
      background: hsl(38 40% 20%);
      border-color: hsl(38 40% 35%);
      color: hsl(38 80% 82%);
    }
  }
</style>
