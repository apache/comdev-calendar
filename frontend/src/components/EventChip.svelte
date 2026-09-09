<script lang="ts">
  import type { CalendarEvent } from "../lib/types";
  import { calendarLabel, eventHue, eventStart } from "../lib/events";
  import { formatTime } from "../lib/dates";
  import type { DisplayZone } from "../lib/timezone";

  interface Props {
    event: CalendarEvent;
    /** "chip" is the compact form used in month cells and the year view. */
    variant?: "chip" | "block" | "row";
    showTime?: boolean;
    zone?: DisplayZone;
    onselect: (event: CalendarEvent) => void;
  }

  let { event, variant = "chip", showTime = true, zone = "local", onselect }: Props = $props();

  let hue = $derived(eventHue(event));
  let time = $derived(event.all_day ? "All day" : formatTime(eventStart(event, zone)));
  let label = $derived(calendarLabel(event));
</script>

<button
  type="button"
  class="chip {variant}"
  class:private={event.visibility === "private"}
  style="--hue: {hue}"
  title="{event.title} - {label}{event.location ? ` - ${event.location}` : ''}"
  onclick={(mouseEvent) => {
    mouseEvent.stopPropagation();
    onselect(event);
  }}
>
  {#if showTime}
    <span class="time">{time}</span>
  {/if}
  <span class="title">{event.title}</span>
  {#if event.visibility === "private"}
    <span class="lock" aria-label="Private event">&#128274;</span>
  {/if}
</button>

<style>
  .chip {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    width: 100%;
    text-align: left;
    background: var(--chip-bg);
    color: var(--chip-text);
    border: 1px solid var(--chip-border);
    border-left-width: 3px;
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 12px;
    line-height: 1.35;
    overflow: hidden;
  }

  .chip:hover {
    filter: brightness(0.96);
  }

  .chip.private {
    border-style: dashed;
    border-left-style: solid;
  }

  .time {
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
    flex: none;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lock {
    margin-left: auto;
    font-size: 10px;
    flex: none;
  }

  .chip.block {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    height: 100%;
    padding: 2px 4px;
    white-space: normal;
  }

  .chip.block .title {
    white-space: normal;
    font-weight: 600;
  }

  .chip.row {
    padding: 0.4rem 0.6rem;
    font-size: 13px;
    border-left-width: 4px;
  }
</style>
