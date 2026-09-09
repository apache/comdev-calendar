<script lang="ts">
  import type { SessionInfo, ViewName } from "../lib/types";
  import { VIEWS } from "../lib/types";
  import { formatViewTitle } from "../lib/dates";
  import type { DisplayZone } from "../lib/timezone";
  import { assetUrl, loginUrl, logoutUrl } from "../lib/base";
  import TimezoneSwitch from "./TimezoneSwitch.svelte";

  interface Props {
    title: string;
    view: ViewName;
    cursor: Date;
    session: SessionInfo | null;
    loading: boolean;
    canCreate: boolean;
    zone: DisplayZone;
    /** The zone the picker is parked on, used when switching away from local. */
    alternateZone: DisplayZone;
    helpOpen: boolean;
    onview: (view: ViewName) => void;
    onstep: (direction: number) => void;
    ontoday: () => void;
    oncreate: () => void;
    ontogglefilters: () => void;
    onzone: (zone: DisplayZone) => void;
    onalternatezone: (zone: DisplayZone) => void;
    onhelp: () => void;
  }

  let {
    title,
    view,
    cursor,
    session,
    loading,
    canCreate,
    zone,
    alternateZone,
    helpOpen,
    onview,
    onstep,
    ontoday,
    oncreate,
    ontogglefilters,
    onzone,
    onalternatezone,
    onhelp,
  }: Props = $props();

  let heading = $derived(formatViewTitle(view, cursor));
</script>

<header>
  <div class="brand">
    <button type="button" class="filters-toggle" onclick={ontogglefilters} aria-label="Toggle filters">
      &#9776;
    </button>
    <img src={assetUrl("icon.png")} alt="" width="28" height="28" />
    <h1>{title}</h1>
  </div>

  <div class="nav">
    <button type="button" class="btn" onclick={ontoday}>Today</button>
    <div class="stepper">
      <button type="button" class="btn" onclick={() => onstep(-1)} aria-label="Previous">&#8249;</button>
      <button type="button" class="btn" onclick={() => onstep(1)} aria-label="Next">&#8250;</button>
    </div>
    <h2 aria-live="polite">{heading}</h2>
    {#if loading}
      <span class="spinner" role="status" aria-label="Loading"></span>
    {/if}
  </div>

  <div class="views" role="tablist" aria-label="Calendar view">
    {#each VIEWS as name (name)}
      <button
        type="button"
        role="tab"
        class="view"
        class:active={view === name}
        aria-selected={view === name}
        onclick={() => onview(name)}
      >
        {name}
      </button>
    {/each}
  </div>

  <TimezoneSwitch {zone} alternate={alternateZone} {onzone} onalternate={onalternatezone} />

  <div class="account">
    <button type="button" class="btn" class:active={helpOpen} onclick={onhelp}>Help</button>
    {#if canCreate}
      <button type="button" class="btn primary" onclick={oncreate}>New event</button>
    {/if}
    {#if session?.authenticated}
      <span class="who" title={session.email ?? ""}>{session.fullname || session.uid}</span>
      <a class="btn" href={session.logout_url ?? logoutUrl()}>Log out</a>
    {:else}
      <a class="btn primary" href={session?.login_url ?? loginUrl()}>Log in</a>
    {/if}
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.9rem;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    box-shadow: var(--shadow);
    z-index: 5;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .brand img {
    border-radius: 4px;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
  }

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .stepper {
    display: flex;
  }

  .stepper .btn:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }

  .stepper .btn:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
    margin-left: -1px;
  }

  .views {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .view {
    background: var(--bg-panel);
    border: 0;
    border-right: 1px solid var(--border);
    padding: 0.35rem 0.7rem;
    text-transform: capitalize;
    font-size: 13px;
  }

  .view:last-child {
    border-right: 0;
  }

  .view:hover {
    background: var(--bg-hover);
  }

  .view.active {
    background: var(--asf-red);
    color: #fff;
    font-weight: 600;
  }

  .btn.active {
    background: var(--bg-subtle);
    box-shadow: inset 0 -2px 0 var(--asf-red);
  }

  .account {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }

  .who {
    font-size: 13px;
    color: var(--text-muted);
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .filters-toggle {
    display: none;
    background: none;
    border: 0;
    font-size: 18px;
    padding: 0 0.3rem;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border-strong);
    border-top-color: var(--asf-red);
    border-radius: 999px;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 60rem) {
    .filters-toggle {
      display: block;
    }

    .account {
      width: 100%;
      margin-left: 0;
    }
  }
</style>
