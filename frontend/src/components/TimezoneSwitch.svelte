<script lang="ts">
  import type { DisplayZone } from "../lib/timezone";
  import {
    LOCAL,
    MAJOR_ZONES,
    browserZone,
    explainDisplayZone,
    isLocal,
    shortZoneLabel,
    zoneLabel,
  } from "../lib/timezone";

  interface Props {
    /** The zone the calendar is drawn in. */
    zone: DisplayZone;
    /** The zone the picker is set to, used when switching away from local. */
    alternate: DisplayZone;
    onzone: (zone: DisplayZone) => void;
    onalternate: (zone: DisplayZone) => void;
  }

  let { zone, alternate, onzone, onalternate }: Props = $props();

  // Recomputed on every render, which is often enough: the labels only change
  // when a zone crosses a daylight-saving boundary.
  let now = $derived(new Date());
  let local = $derived(browserZone());
  let localLabel = $derived(zoneLabel(local, now));

  function pick(chosen: string) {
    onalternate(chosen);
    onzone(chosen);
  }
</script>

<div class="zones" role="group" aria-label="Display timezone">
  <button
    type="button"
    class="zone"
    class:active={isLocal(zone)}
    aria-pressed={isLocal(zone)}
    title={explainDisplayZone(LOCAL, now)}
    onclick={() => onzone(LOCAL)}
  >
    <span class="lead">Local</span>
    <span class="detail">{localLabel}</span>
  </button>

  <label class="zone select" class:active={!isLocal(zone)} title={explainDisplayZone(alternate, now)}>
    <select
      aria-label="Show the calendar in another timezone"
      value={alternate}
      onchange={(event) => pick(event.currentTarget.value)}
      onclick={() => {
        if (isLocal(zone)) onzone(alternate);
      }}
    >
      {#each MAJOR_ZONES as group (group.region)}
        <optgroup label={group.region}>
          {#each group.zones as name (name)}
            <option value={name}>{zoneLabel(name, now)}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
    <span class="badge" aria-hidden="true">{shortZoneLabel(alternate, now)}</span>
  </label>
</div>

<style>
  .zones {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .zone {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0;
    background: var(--bg-panel);
    border: 0;
    border-right: 1px solid var(--border);
    padding: 0.15rem 0.6rem;
    font-size: 12px;
    line-height: 1.25;
    text-align: left;
    white-space: nowrap;
  }

  .zone:last-child {
    border-right: 0;
  }

  .zone:hover {
    background: var(--bg-hover);
  }

  .zone.active {
    background: var(--bg-subtle);
    box-shadow: inset 0 -2px 0 var(--asf-red);
  }

  .lead {
    font-weight: 700;
  }

  .zone.active .lead {
    color: var(--asf-red);
  }

  .detail {
    color: var(--text-muted);
    font-size: 11px;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The select sits on top of the label so the whole cell is the hit area,
     while the badge underneath shows the short name in our own styling. */
  .zone.select {
    position: relative;
    cursor: pointer;
    justify-content: center;
  }

  .zone.select select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  .badge {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .zone.select.active .badge {
    color: var(--asf-red);
  }

  .badge::after {
    content: " \25BE";
    font-weight: 400;
    color: var(--text-muted);
  }
</style>
