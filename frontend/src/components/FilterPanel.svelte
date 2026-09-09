<script lang="ts">
  import type { Calendars, Category, Filters, SortName, ViewName } from "../lib/types";
  import { CATEGORIES } from "../lib/types";
  import { categoryLabel, projectHue } from "../lib/events";
  import { toggle } from "../lib/filters";
  import type { DisplayZone } from "../lib/timezone";
  import { LOCAL, MAJOR_ZONES, browserZone, describeDisplayZone, resolveZone, zoneLabel } from "../lib/timezone";

  interface Props {
    filters: Filters;
    calendars: Calendars | null;
    projects: string[];
    view: ViewName;
    feedUrl: string;
    /** The zone the calendar is drawn in, set from the header. */
    zone: DisplayZone;
    /** Extra clocks shown beside it. */
    compareZones: DisplayZone[];
    /** How many comparison clocks the layout can take. */
    maxCompareZones?: number;
    onchange: (filters: Filters) => void;
    oncomparezones: (zones: DisplayZone[]) => void;
  }

  let {
    filters,
    calendars,
    projects,
    view,
    feedUrl,
    zone,
    compareZones,
    maxCompareZones = 3,
    onchange,
    oncomparezones,
  }: Props = $props();

  function setCategory(category: Category) {
    onchange({ ...filters, categories: toggle(filters.categories, category) });
  }

  function setProject(project: string) {
    onchange({ ...filters, projects: toggle(filters.projects, project) });
  }

  function allProjects(on: boolean) {
    onchange({ ...filters, projects: new Set(on ? projects : []) });
  }

  let now = $derived(new Date());
  // A clock already on screen as the primary zone is not worth offering again.
  let alreadyShown = $derived(new Set([resolveZone(zone), ...compareZones.map(resolveZone)]));
  let canAddMore = $derived(compareZones.length < maxCompareZones);

  function addCompareZone(chosen: string) {
    if (!chosen || alreadyShown.has(resolveZone(chosen))) return;
    oncomparezones([...compareZones, chosen]);
  }

  function removeCompareZone(chosen: DisplayZone) {
    oncomparezones(compareZones.filter((candidate) => candidate !== chosen));
  }
</script>

<aside>
  <label class="search">
    <span class="visually-hidden">Search events</span>
    <input
      type="search"
      placeholder="Search events..."
      value={filters.search}
      oninput={(event) => onchange({ ...filters, search: event.currentTarget.value })}
    />
  </label>

  <section>
    <h3>Calendars</h3>
    {#each CATEGORIES as category (category)}
      <label class="check">
        <input
          type="checkbox"
          checked={filters.categories.has(category)}
          onchange={() => setCategory(category)}
        />
        <span class="swatch" style="--hue: {category === 'personal' ? 265 : category === 'foundation' ? 0 : 210}"
        ></span>
        {categoryLabel(category)}
      </label>
    {/each}
  </section>

  {#if projects.length > 0}
    <section>
      <h3>
        Projects
        <span class="bulk">
          <button type="button" onclick={() => allProjects(true)}>all</button>
          <button type="button" onclick={() => allProjects(false)}>none</button>
        </span>
      </h3>
      <div class="projects">
        {#each projects as project (project)}
          <label class="check">
            <input
              type="checkbox"
              checked={filters.projects.has(project)}
              onchange={() => setProject(project)}
            />
            <span class="swatch" style="--hue: {projectHue(project)}"></span>
            {project}
            {#if calendars?.committees.includes(project)}
              <span class="role" title="You are on this committee">PMC</span>
            {/if}
          </label>
        {/each}
      </div>
    </section>
  {/if}

  <section>
    <h3>Visibility</h3>
    <label class="field">
      <select
        value={filters.visibility}
        onchange={(event) =>
          onchange({ ...filters, visibility: event.currentTarget.value as Filters["visibility"] })}
      >
        <option value="all">Everything I can see</option>
        <option value="public">Public only</option>
        <option value="private">Private only</option>
      </select>
    </label>
  </section>

  {#if view === "agenda"}
    <section>
      <h3>Sort</h3>
      <label class="field">
        <select
          value={filters.sort}
          onchange={(event) => onchange({ ...filters, sort: event.currentTarget.value as SortName })}
        >
          <option value="start">Soonest first</option>
          <option value="-start">Latest first</option>
          <option value="title">Title A-Z</option>
          <option value="-title">Title Z-A</option>
        </select>
      </label>
    </section>
  {/if}

  <section class="timezones">
    <h3>Timezones</h3>
    <p class="muted">
      Drawn in <strong>{describeDisplayZone(zone, now)}</strong>, which you can change at the top of
      the page.
    </p>

    {#if compareZones.length > 0}
      <ul class="chips">
        {#each compareZones as other (other)}
          <li>
            <span title={zoneLabel(resolveZone(other), now)}>{describeDisplayZone(other, now)}</span>
            <button
              type="button"
              onclick={() => removeCompareZone(other)}
              aria-label={`Stop showing ${resolveZone(other)}`}
            >
              &#215;
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if canAddMore}
      <label class="field">
        <span class="visually-hidden">Also show another timezone</span>
        <select
          value=""
          onchange={(event) => {
            addCompareZone(event.currentTarget.value);
            event.currentTarget.value = "";
          }}
        >
          <option value="">Also show...</option>
          {#if !alreadyShown.has(browserZone())}
            <option value={LOCAL}>Local - {zoneLabel(browserZone(), now)}</option>
          {/if}
          {#each MAJOR_ZONES as group (group.region)}
            <optgroup label={group.region}>
              {#each group.zones.filter((name) => !alreadyShown.has(name)) as name (name)}
                <option value={name}>{zoneLabel(name, now)}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </label>
    {/if}

    <p class="muted small">
      Comparison clocks appear beside the week and day grids, on agenda rows, and in an event's
      details.
    </p>
  </section>

  <section class="subscribe">
    <h3>Subscribe</h3>
    <p class="muted">
      Add the events you can see to your own calendar application with this iCalendar feed.
    </p>
    <a class="btn" href={feedUrl}>Download .ics</a>
  </section>
</aside>

<style>
  aside {
    width: 15rem;
    flex: none;
    padding: 0.9rem;
    overflow-y: auto;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
  }

  .search input {
    width: 100%;
  }

  section {
    margin-top: 1.1rem;
  }

  h3 {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 0 0 0.4rem;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .bulk button {
    background: none;
    border: 0;
    padding: 0 0.2rem;
    font-size: 11px;
    color: var(--asf-red);
    text-transform: none;
    letter-spacing: 0;
  }

  .bulk button:hover {
    text-decoration: underline;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.12rem 0;
    cursor: pointer;
    font-size: 13px;
    overflow: hidden;
  }

  .check:hover {
    color: var(--asf-red);
  }

  .swatch {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: 3px;
    background: hsl(var(--hue) 60% 55%);
  }

  .projects {
    max-height: 16rem;
    overflow-y: auto;
  }

  .role {
    margin-left: auto;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--text-faint);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 3px;
  }

  .field select {
    width: 100%;
  }

  .subscribe p {
    margin: 0 0 0.5rem;
    font-size: 12px;
  }

  .timezones p {
    margin: 0 0 0.5rem;
    font-size: 12px;
  }

  .timezones .small {
    margin: 0.5rem 0 0;
    font-size: 11px;
  }

  .chips {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .chips li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 12px;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.1rem 0.2rem 0.1rem 0.45rem;
  }

  .chips li span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chips button {
    background: none;
    border: 0;
    padding: 0 0.3rem;
    font-size: 14px;
    line-height: 1;
    color: var(--text-muted);
  }

  .chips button:hover {
    color: var(--asf-red);
  }
</style>
