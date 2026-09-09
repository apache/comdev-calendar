<script lang="ts">
  import type { CalendarEvent } from "../lib/types";
  import { WEEKDAY_NAMES, formatDate, formatTime, isToday } from "../lib/dates";
  import { agendaSections, calendarLabel, eventEnd, eventHue, eventStart } from "../lib/events";
  import type { DisplayZone } from "../lib/timezone";
  import { nowInZone } from "../lib/timezone";

  interface Props {
    events: CalendarEvent[];
    zone?: DisplayZone;
    onselect: (event: CalendarEvent) => void;
  }

  let { events, zone = "local", onselect }: Props = $props();

  let now = $derived(nowInZone(zone));
  let sections = $derived(agendaSections(events, zone));

  function when(event: CalendarEvent): string {
    if (event.all_day) return "All day";
    return `${formatTime(eventStart(event, zone))} - ${formatTime(eventEnd(event, zone))}`;
  }
</script>

<div class="agenda">
  {#if sections.length === 0}
    <p class="empty muted">No events match the current filters.</p>
  {/if}

  {#each sections as section (section.key)}
    <section>
      <h3 class:today={isToday(section.date, now)}>
        <span class="dow">{WEEKDAY_NAMES[(section.date.getDay() + 6) % 7]}</span>
        {formatDate(section.date)}
      </h3>
      <ul>
        {#each section.events as event (event.id)}
          <li>
            <button
              type="button"
              class="row"
              style="--hue: {eventHue(event)}"
              onclick={() => onselect(event)}
            >
              <span class="when">{when(event)}</span>
              <span class="title">{event.title}</span>
              <span class="tag">{calendarLabel(event)}</span>
              {#if event.visibility === "private"}
                <span class="tag private">private</span>
              {/if}
              {#if event.location}
                <span class="where muted">{event.location}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .agenda {
    height: 100%;
    overflow-y: auto;
    padding: 1rem 1rem 3rem;
  }

  .empty {
    padding: 2rem;
    text-align: center;
  }

  section {
    margin-bottom: 1.25rem;
  }

  h3 {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0 0 0.4rem;
    font-size: 13px;
    font-weight: 700;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.25rem;
  }

  h3.today {
    color: var(--asf-red);
  }

  .dow {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 11px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-left: 4px solid hsl(var(--hue) 55% 55%);
    border-radius: var(--radius);
    padding: 0.45rem 0.7rem;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .when {
    flex: none;
    width: 9rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    font-size: 12px;
  }

  .title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    flex: none;
    font-size: 11px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .tag.private {
    border-style: dashed;
  }

  .where {
    margin-left: auto;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 42rem) {
    .row {
      flex-wrap: wrap;
    }

    .when {
      width: auto;
    }

    .where {
      margin-left: 0;
      width: 100%;
    }
  }
</style>
