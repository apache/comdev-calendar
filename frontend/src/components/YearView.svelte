<script lang="ts">
  import type { CalendarEvent } from "../lib/types";
  import { MONTH_NAMES, dayKey, isToday, monthGrid, yearMonths } from "../lib/dates";
  import { eventHue, occursOnDay } from "../lib/events";
  import type { DisplayZone } from "../lib/timezone";
  import { nowInZone } from "../lib/timezone";

  interface Props {
    cursor: Date;
    events: CalendarEvent[];
    zone?: DisplayZone;
    onpickday: (day: Date) => void;
    onpickmonth: (month: Date) => void;
  }

  let { cursor, events, zone = "local", onpickday, onpickmonth }: Props = $props();

  let now = $derived(nowInZone(zone));

  /** Up to three dots per day, so a busy day still reads as busy. */
  const MAX_DOTS = 3;

  function dotsFor(day: Date): CalendarEvent[] {
    return events.filter((event) => occursOnDay(event, day, zone)).slice(0, MAX_DOTS);
  }

  let months = $derived(yearMonths(cursor));
</script>

<div class="year">
  {#each months as month (month.getMonth())}
    <section class="month">
      <button type="button" class="title" onclick={() => onpickmonth(month)}>
        {MONTH_NAMES[month.getMonth()]}
      </button>
      <div class="mini">
        {#each ["M", "T", "W", "T", "F", "S", "S"] as label, index (index)}
          <div class="dow">{label}</div>
        {/each}
        {#each monthGrid(month).slice(0, 42) as day (dayKey(day))}
          {@const inMonth = day.getMonth() === month.getMonth()}
          {@const dots = inMonth ? dotsFor(day) : []}
          <button
            type="button"
            class="day"
            class:outside={!inMonth}
            class:today={isToday(day, now)}
            onclick={() => onpickday(day)}
            aria-label={`${day.getDate()} ${MONTH_NAMES[day.getMonth()]}${dots.length ? `, ${dots.length} events` : ""}`}
          >
            <span class="num">{day.getDate()}</span>
            <span class="dots">
              {#each dots as event (event.id)}
                <i style="--hue: {eventHue(event)}"></i>
              {/each}
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .year {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 1rem;
    padding: 1rem;
    overflow-y: auto;
    height: 100%;
  }

  .month {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem;
    box-shadow: var(--shadow);
  }

  .title {
    display: block;
    width: 100%;
    background: none;
    border: 0;
    padding: 0 0 0.4rem;
    text-align: left;
    font-weight: 700;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--asf-red);
  }

  .title:hover {
    text-decoration: underline;
  }

  .mini {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
  }

  .dow {
    font-size: 10px;
    color: var(--text-faint);
    text-align: center;
    padding-bottom: 2px;
  }

  .day {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    background: none;
    border: 0;
    border-radius: 3px;
    padding: 2px 0 3px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    min-height: 1.9rem;
  }

  .day:hover {
    background: var(--bg-hover);
  }

  .day.outside {
    opacity: 0.3;
  }

  .day.today .num {
    background: var(--asf-red);
    color: #fff;
    border-radius: 999px;
    padding: 0 4px;
    font-weight: 700;
  }

  .dots {
    display: flex;
    gap: 1px;
    height: 4px;
  }

  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: hsl(var(--hue) 60% 50%);
  }
</style>
