<script lang="ts">
  import type { CalendarEvent } from "../lib/types";
  import { MONTH_NAMES, WEEKDAY_NAMES, dayKey, isToday, isWeekend, monthGrid } from "../lib/dates";
  import { groupByDay } from "../lib/events";
  import type { DisplayZone } from "../lib/timezone";
  import { nowInZone } from "../lib/timezone";
  import EventChip from "./EventChip.svelte";

  interface Props {
    cursor: Date;
    events: CalendarEvent[];
    zone?: DisplayZone;
    onselect: (event: CalendarEvent) => void;
    onpickday: (day: Date) => void;
  }

  let { cursor, events, zone = "local", onselect, onpickday }: Props = $props();

  let now = $derived(nowInZone(zone));

  /** How many chips fit in a cell before we collapse the rest into "+n more". */
  const VISIBLE_PER_DAY = 3;

  let days = $derived(monthGrid(cursor));
  let buckets = $derived(groupByDay(events, days, zone));
  let month = $derived(cursor.getMonth());
</script>

<div class="month">
  <div class="weekdays" role="row">
    {#each WEEKDAY_NAMES as name (name)}
      <div class="weekday" role="columnheader">{name}</div>
    {/each}
  </div>

  <div class="grid">
    {#each days as day (dayKey(day))}
      {@const key = dayKey(day)}
      {@const dayEvents = buckets.get(key) ?? []}
      <div
        class="cell"
        class:other-month={day.getMonth() !== month}
        class:weekend={isWeekend(day)}
        class:today={isToday(day, now)}
      >
        <button type="button" class="daynumber" onclick={() => onpickday(day)}>
          {#if day.getDate() === 1}
            <span class="monthname">{MONTH_NAMES[day.getMonth()].slice(0, 3)}</span>
          {/if}
          {day.getDate()}
        </button>

        <div class="events">
          {#each dayEvents.slice(0, VISIBLE_PER_DAY) as event (event.id)}
            <EventChip {event} {zone} {onselect} />
          {/each}
          {#if dayEvents.length > VISIBLE_PER_DAY}
            <button type="button" class="more" onclick={() => onpickday(day)}>
              +{dayEvents.length - VISIBLE_PER_DAY} more
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .month {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .weekdays,
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .weekday {
    padding: 0.4rem 0.5rem;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }

  .grid {
    flex: 1;
    grid-auto-rows: minmax(5.5rem, 1fr);
    min-height: 0;
    border-left: 1px solid var(--border);
    border-top: 1px solid var(--border);
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 2px;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
  }

  .cell.weekend {
    background: var(--bg-subtle);
  }

  .cell.other-month {
    opacity: 0.55;
  }

  .cell.today {
    background: var(--today);
  }

  .daynumber {
    align-self: flex-start;
    display: flex;
    gap: 0.25rem;
    align-items: baseline;
    background: none;
    border: 0;
    padding: 1px 5px;
    border-radius: 999px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }

  .daynumber:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .today .daynumber {
    background: var(--asf-red);
    color: #fff;
    font-weight: 700;
  }

  .monthname {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 10px;
  }

  .events {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .more {
    background: none;
    border: 0;
    padding: 0 4px;
    text-align: left;
    font-size: 11px;
    color: var(--text-muted);
  }

  .more:hover {
    color: var(--text);
    text-decoration: underline;
  }
</style>
