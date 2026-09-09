<script lang="ts">
  import type { CalendarEvent, Calendars, EventDraft, Filters, SessionInfo, ViewName } from "./lib/types";
  import { VIEWS } from "./lib/types";
  import { api, ApiError } from "./lib/api";
  import { rangeForView, startOfDay, step } from "./lib/dates";
  import { applyFilters, defaultFilters, projectsInPlay, sortEvents } from "./lib/filters";
  import { canCreateAnything, canEdit, draftFromEvent, newDraft } from "./lib/drafts";
  import type { DisplayZone } from "./lib/timezone";
  import { fromWall, nowInZone, toWall } from "./lib/timezone";
  import { appPath, withoutBase } from "./lib/base";

  import Header from "./components/Header.svelte";
  import FilterPanel from "./components/FilterPanel.svelte";
  import MonthView from "./components/MonthView.svelte";
  import WeekView from "./components/WeekView.svelte";
  import YearView from "./components/YearView.svelte";
  import AgendaView from "./components/AgendaView.svelte";
  import EventDialog from "./components/EventDialog.svelte";
  import HelpPage from "./components/HelpPage.svelte";

  const VIEW_STORAGE_KEY = "asf-calendar-view";
  const ZONE_STORAGE_KEY = "asf-calendar-zone";
  const SHORTLINK_PATTERN = /^\/e\/([A-Za-z0-9]+)\/?$/;
  const HELP_PATH = "/help";

  /** The current browser path with the deployment's mount point removed. */
  function routePath(): string | null {
    return withoutBase(globalThis.location?.pathname ?? "/");
  }

  function stored(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function remember(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Private browsing, or storage turned off. Not worth complaining about.
    }
  }

  function initialView(): ViewName {
    const saved = stored(VIEW_STORAGE_KEY);
    return (VIEWS as readonly string[]).includes(saved ?? "") ? (saved as ViewName) : "month";
  }

  function initialZone(): DisplayZone {
    return stored(ZONE_STORAGE_KEY) === "utc" ? "utc" : "local";
  }

  /** True once the visitor has expressed a preference of their own. */
  function hasChosenZone(): boolean {
    const saved = stored(ZONE_STORAGE_KEY);
    return saved === "utc" || saved === "local";
  }

  let view = $state<ViewName>(initialView());
  let zone = $state<DisplayZone>(initialZone());
  // The cursor is a wall date: its local getters read as the display zone.
  let cursor = $state<Date>(startOfDay(nowInZone(initialZone())));
  let helpOpen = $state<boolean>(routePath() === HELP_PATH);
  let events = $state<CalendarEvent[]>([]);
  let session = $state<SessionInfo | null>(null);
  let calendars = $state<Calendars | null>(null);
  let filters = $state<Filters>(defaultFilters(null));

  let loading = $state(false);
  let saving = $state(false);
  let loadError = $state<string | null>(null);
  let dialogError = $state<string | null>(null);
  let showFilters = $state(true);

  let selected = $state<CalendarEvent | null>(null);
  let draft = $state<EventDraft | null>(null);

  let range = $derived(rangeForView(view, cursor));
  let knownProjects = $derived(projectsInPlay(events, calendars));
  let visible = $derived(sortEvents(applyFilters(events, filters, knownProjects), filters.sort, zone));
  let title = $derived(calendars?.title ?? "ASF Community Calendar");
  let editable = $derived(selected ? canEdit(selected, calendars) : false);
  let feedUrl = $derived(
    api.feedUrl({
      start: fromWall(range.start, zone),
      end: fromWall(range.end, zone),
      categories: [...filters.categories],
      visibility: filters.visibility,
      q: filters.search || undefined,
    }),
  );

  // ---- loading ------------------------------------------------------------

  async function loadIdentity() {
    try {
      const [who, cals] = await Promise.all([api.session(), api.calendars()]);
      session = who;
      calendars = cals;
      // Everything the user belongs to is on by default.
      filters = defaultFilters(cals);
      // The deployment can say which clock to open on; the visitor's own
      // choice, once made, always wins.
      if (!hasChosenZone() && cals.default_display_zone === "utc") zone = "utc";
    } catch (error) {
      loadError = error instanceof ApiError ? error.message : String(error);
    }
  }

  let loadToken = 0;

  async function loadEvents(from: Date, to: Date) {
    const token = ++loadToken;
    loading = true;
    try {
      const found = await api.events({ start: from, end: to });
      // A slow earlier request must not overwrite a newer result.
      if (token === loadToken) {
        events = found;
        loadError = null;
      }
    } catch (error) {
      if (token === loadToken) loadError = error instanceof ApiError ? error.message : String(error);
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  $effect(() => {
    // The grid works in wall time; the API works in instants.
    const from = fromWall(range.start, zone);
    const to = fromWall(range.end, zone);
    void loadEvents(from, to);
  });

  $effect(() => {
    remember(VIEW_STORAGE_KEY, view);
  });

  $effect(() => {
    remember(ZONE_STORAGE_KEY, zone);
  });


  // ---- shortlink routing --------------------------------------------------

  async function openFromLocation() {
    const path = routePath();
    if (path === null) return; // Not a URL this app is mounted on.
    helpOpen = path === HELP_PATH;
    const match = SHORTLINK_PATTERN.exec(path);
    if (!match) return;
    try {
      const event = await api.byShortlink(match[1]);
      selected = event;
      cursor = startOfDay(toWall(new Date(event.start), zone));
    } catch (error) {
      loadError =
        error instanceof ApiError && error.needsLogin
          ? "That event is not public. Log in to see whether you have access."
          : "That shortlink does not point at an event you can see.";
    }
  }

  /** Pushes a route, in app terms: navigate("/help") -> /calendar/help. */
  function navigate(path: string) {
    if (!globalThis.history) return;
    const target = appPath(path);
    if (globalThis.location.pathname !== target) globalThis.history.pushState({}, "", target);
  }

  function pushShortlink(event: CalendarEvent | null) {
    if (!globalThis.location) return;
    if (!event) {
      navigate("/");
      return;
    }
    // The backend builds shortlink_url with the mount point already in it, so
    // push its path as-is rather than prefixing it a second time.
    const path = new URL(event.shortlink_url, globalThis.location.href).pathname;
    if (globalThis.location.pathname !== path) globalThis.history.pushState({}, "", path);
  }

  $effect(() => {
    void openFromLocation();
    const onPop = () => void openFromLocation();
    globalThis.addEventListener?.("popstate", onPop);
    return () => globalThis.removeEventListener?.("popstate", onPop);
  });

  void loadIdentity();

  // ---- actions ------------------------------------------------------------

  function selectEvent(event: CalendarEvent) {
    selected = event;
    draft = null;
    dialogError = null;
    pushShortlink(event);
  }

  function closeDialog() {
    selected = null;
    draft = null;
    dialogError = null;
    pushShortlink(null);
  }

  function startCreate(when: Date = nowInZone(zone)) {
    selected = null;
    dialogError = null;
    helpOpen = false;
    // The form is filled in from the wall clock the user is looking at.
    draft = newDraft(fromWall(when, zone), calendars);
  }

  function startEdit() {
    if (selected) draft = draftFromEvent(selected);
  }

  async function save(next: EventDraft) {
    saving = true;
    dialogError = null;
    try {
      const saved = selected ? await api.update(selected.id, next) : await api.create(next);
      events = [...events.filter((event) => event.id !== saved.id), saved];
      selected = saved;
      draft = null;
      pushShortlink(saved);
    } catch (error) {
      dialogError = error instanceof ApiError ? error.message : String(error);
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!selected) return;
    if (!globalThis.confirm?.(`Delete "${selected.title}"? This cannot be undone.`)) return;
    saving = true;
    dialogError = null;
    try {
      await api.remove(selected.id);
      events = events.filter((event) => event.id !== selected!.id);
      closeDialog();
    } catch (error) {
      dialogError = error instanceof ApiError ? error.message : String(error);
    } finally {
      saving = false;
    }
  }

  function goToDay(day: Date) {
    cursor = startOfDay(day);
    view = "day";
  }

  function goToMonth(month: Date) {
    cursor = startOfDay(month);
    view = "month";
  }

  /**
   * Switching the display zone keeps the date you are looking at. You asked to
   * see March 10th in UTC, not "whatever March 10th local becomes in UTC".
   */
  function setZone(next: DisplayZone) {
    zone = next;
  }

  function toggleHelp() {
    helpOpen = !helpOpen;
    navigate(helpOpen ? HELP_PATH : "/");
  }
</script>

<div class="layout">
  <Header
    {title}
    {view}
    {cursor}
    {session}
    {loading}
    canCreate={canCreateAnything(calendars)}
    {zone}
    {helpOpen}
    onview={(next) => {
      view = next;
      helpOpen = false;
    }}
    onstep={(direction) => (cursor = step(view, cursor, direction))}
    ontoday={() => (cursor = startOfDay(nowInZone(zone)))}
    oncreate={() => startCreate(cursor)}
    ontogglefilters={() => (showFilters = !showFilters)}
    onzone={setZone}
    onhelp={toggleHelp}
  />

  {#if loadError}
    <p class="banner" role="alert">
      {loadError}
      <button type="button" class="btn" onclick={() => (loadError = null)}>Dismiss</button>
    </p>
  {/if}

  <div class="body">
    {#if helpOpen}
      <HelpPage {calendars} {session} {zone} onclose={toggleHelp} />
    {:else}
      {#if showFilters}
        <FilterPanel
          {filters}
          {calendars}
          projects={knownProjects}
          {view}
          {feedUrl}
          onchange={(next) => (filters = next)}
        />
      {/if}

      <main>
        {#if view === "month"}
          <MonthView {cursor} events={visible} {zone} onselect={selectEvent} onpickday={goToDay} />
        {:else if view === "week"}
          <WeekView {cursor} events={visible} {zone} onselect={selectEvent} onpickday={goToDay} />
        {:else if view === "day"}
          <WeekView {cursor} events={visible} {zone} days={1} onselect={selectEvent} onpickday={goToDay} />
        {:else if view === "year"}
          <YearView {cursor} events={visible} {zone} onpickday={goToDay} onpickmonth={goToMonth} />
        {:else}
          <AgendaView events={visible} {zone} onselect={selectEvent} />
        {/if}
      </main>
    {/if}
  </div>
</div>

{#if selected || draft}
  <EventDialog
    event={selected}
    {draft}
    {calendars}
    {saving}
    error={dialogError}
    {editable}
    {zone}
    onclose={closeDialog}
    onedit={startEdit}
    onsave={save}
    ondelete={remove}
  />
{/if}

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin: 0;
    padding: 0.5rem 0.9rem;
    background: hsl(38 92% 92%);
    border-bottom: 1px solid hsl(38 60% 70%);
    color: hsl(28 70% 25%);
  }

  @media (prefers-color-scheme: dark) {
    .banner {
      background: hsl(38 40% 20%);
      border-color: hsl(38 40% 35%);
      color: hsl(38 80% 82%);
    }
  }

  @media (max-width: 60rem) {
    .body {
      position: relative;
    }
  }
</style>
