<script lang="ts">
  import type { CalendarEvent } from "../lib/types";
  import { WEEKDAY_NAMES, dayKey, formatTime, isToday, isWeekend, weekDays } from "../lib/dates";
  import { allDayEvents, eventHue, eventStart, layoutDay } from "../lib/events";
  import type { DisplayZone } from "../lib/timezone";
  import { nowInZone } from "../lib/timezone";
  import EventChip from "./EventChip.svelte";

  interface Props {
    cursor: Date;
    events: CalendarEvent[];
    /** One day for the day view, seven for the week view. */
    days?: number;
    zone?: DisplayZone;
    onselect: (event: CalendarEvent) => void;
    onpickday: (day: Date) => void;
  }

  let { cursor, events, days = 7, zone = "local", onselect, onpickday }: Props = $props();

  const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

  let now = $derived(nowInZone(zone));
  let columns = $derived(days === 1 ? [new Date(cursor)] : weekDays(cursor));
  let allDayRows = $derived(columns.map((day) => allDayEvents(events, day, zone)));
  let hasAllDay = $derived(allDayRows.some((row) => row.length > 0));
  let laidOut = $derived(columns.map((day) => layoutDay(events, day, zone)));
</script>

<div class="week" class:single={columns.length === 1} style="--cols: {columns.length}">
  <div class="headers">
    <div class="gutter"></div>
    {#each columns as day, index (dayKey(day))}
      <button
        type="button"
        class="dayhead"
        class:today={isToday(day, now)}
        class:weekend={isWeekend(day)}
        onclick={() => onpickday(day)}
      >
        <span class="dow">{WEEKDAY_NAMES[(day.getDay() + 6) % 7]}</span>
        <span class="dom">{day.getDate()}</span>
        {#if allDayRows[index].length > 0}
          <span class="badge">{allDayRows[index].length}</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if hasAllDay}
    <div class="allday">
      <div class="gutter"><span>All day</span></div>
      {#each columns as day, index (dayKey(day))}
        <div class="allday-cell" class:weekend={isWeekend(day)}>
          {#each allDayRows[index] as event (event.id)}
            <EventChip {event} {zone} {onselect} showTime={false} />
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  <div class="scroll">
    <div class="body">
      <div class="gutter hours">
        {#each HOURS as hour (hour)}
          <div class="hour"><span>{String(hour).padStart(2, "0")}:00</span></div>
        {/each}
      </div>

      {#each columns as day, index (dayKey(day))}
        <div class="daycol" class:weekend={isWeekend(day)} class:today={isToday(day, now)}>
          {#each HOURS as hour (hour)}
            <div class="slot"></div>
          {/each}

          {#each laidOut[index] as placed (placed.event.id)}
            <button
              type="button"
              class="timed"
              class:private={placed.event.visibility === "private"}
              style="--hue: {eventHue(placed.event)};
                     top: {placed.top * 100}%;
                     height: {placed.height * 100}%;
                     left: calc({(placed.column / placed.columns) * 100}% + 2px);
                     width: calc({(1 / placed.columns) * 100}% - 4px);"
              onclick={() => onselect(placed.event)}
              title={placed.event.title}
            >
              <span class="timed-time">{formatTime(eventStart(placed.event, zone))}</span>
              <span class="timed-title">{placed.event.title}</span>
            </button>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .week {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .headers,
  .allday,
  .body {
    display: grid;
    grid-template-columns: 3.5rem repeat(var(--cols, 7), minmax(0, 1fr));
  }

  .headers {
    border-bottom: 1px solid var(--border);
  }

  .dayhead {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.45rem 0.25rem;
    background: none;
    border: 0;
    border-left: 1px solid var(--border);
  }

  .dayhead:hover {
    background: var(--bg-hover);
  }

  .dayhead.weekend {
    background: var(--bg-subtle);
  }

  .dayhead.today {
    background: var(--today);
  }

  .dow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .dom {
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .today .dom {
    color: var(--asf-red);
  }

  .badge {
    font-size: 10px;
    background: var(--border-strong);
    color: var(--bg-panel);
    border-radius: 999px;
    padding: 0 5px;
  }

  .allday {
    border-bottom: 1px solid var(--border-strong);
    max-height: 6rem;
    overflow-y: auto;
  }

  .allday-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px;
    min-width: 0;
    border-left: 1px solid var(--border);
  }

  .gutter {
    font-size: 11px;
    color: var(--text-faint);
    text-align: right;
    padding-right: 0.4rem;
  }

  .allday .gutter {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--bg-panel);
  }

  .hours .hour {
    height: 3rem;
    position: relative;
  }

  .hours .hour span {
    position: absolute;
    top: -0.6em;
    right: 0.4rem;
  }

  .daycol {
    position: relative;
    min-width: 0;
    border-left: 1px solid var(--border);
  }

  .daycol.weekend {
    background: var(--bg-subtle);
  }

  .daycol.today {
    background: var(--today);
  }

  .slot {
    height: 3rem;
    border-bottom: 1px solid var(--border);
  }

  .timed {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
    padding: 1px 4px;
    text-align: left;
    font-size: 12px;
    line-height: 1.25;
    background: var(--chip-bg);
    color: var(--chip-text);
    border: 1px solid var(--chip-border);
    border-left: 3px solid var(--chip-border);
    border-radius: 4px;
  }

  .timed.private {
    border-style: dashed;
    border-left-style: solid;
  }

  .timed:hover {
    filter: brightness(0.96);
    z-index: 2;
  }

  .timed-time {
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
  }

  .timed-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
