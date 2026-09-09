<script lang="ts">
  import type { Calendars, Category, Filters, SortName, ViewName } from "../lib/types";
  import { CATEGORIES } from "../lib/types";
  import { categoryLabel, projectHue } from "../lib/events";
  import { toggle } from "../lib/filters";

  interface Props {
    filters: Filters;
    calendars: Calendars | null;
    projects: string[];
    view: ViewName;
    feedUrl: string;
    onchange: (filters: Filters) => void;
  }

  let { filters, calendars, projects, view, feedUrl, onchange }: Props = $props();

  function setCategory(category: Category) {
    onchange({ ...filters, categories: toggle(filters.categories, category) });
  }

  function setProject(project: string) {
    onchange({ ...filters, projects: toggle(filters.projects, project) });
  }

  function allProjects(on: boolean) {
    onchange({ ...filters, projects: new Set(on ? projects : []) });
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
</style>
