<script lang="ts">
  import type { Calendars, SessionInfo } from "../lib/types";
  import type { DisplayZone } from "../lib/timezone";
  import { browserZone, describeDisplayZone } from "../lib/timezone";

  interface Props {
    calendars: Calendars | null;
    session: SessionInfo | null;
    zone: DisplayZone;
    onclose: () => void;
  }

  let { calendars, session, zone, onclose }: Props = $props();

  /** Rows of the "who can do what" table. A cell is either true, false, or a note. */
  type Cell = boolean | string;

  const COLUMNS = ["Anyone", "Project member", "Committee member", "Foundation member"];

  const ROWS: { what: string; cells: Cell[] }[] = [
    { what: "See public project events", cells: [true, true, true, true] },
    { what: "See public foundation events", cells: [true, true, true, true] },
    { what: "Subscribe to the iCalendar feed", cells: [true, true, true, true] },
    { what: "Open an event by its shortlink", cells: ["public events", true, true, true] },
    { what: "Keep personal events", cells: [false, true, true, true] },
    { what: "Add and edit public events for a project", cells: [false, "own projects", "own projects", "own projects"] },
    { what: "See private events of a project", cells: [false, false, "own committees", "own committees"] },
    { what: "Add and edit private project events", cells: [false, false, "own committees", "own committees"] },
    { what: "See private foundation events", cells: [false, false, false, true] },
    { what: "Add and edit foundation events", cells: [false, false, false, true] },
  ];

  let youAre = $derived.by(() => {
    if (!calendars?.authenticated) return "You are browsing anonymously, so you can see public events only.";
    const bits: string[] = [];
    if (calendars.projects.length > 0) bits.push(`a member of ${calendars.projects.join(", ")}`);
    if (calendars.committees.length > 0) bits.push(`on the ${calendars.committees.join(", ")} committee${calendars.committees.length > 1 ? "s" : ""}`);
    if (calendars.is_member) bits.push("a foundation member");
    if (bits.length === 0) return `You are signed in as ${calendars.uid}.`;
    return `You are signed in as ${calendars.uid}, ${bits.join(", and ")}.`;
  });
</script>

<div class="help">
  <div class="sheet">
    <header>
      <h2>Using the ASF Community Calendar</h2>
      <button type="button" class="btn" onclick={onclose}>Back to the calendar</button>
    </header>

    <p class="status">{youAre}</p>

    <section>
      <h3>The three calendars</h3>
      <p>
        Every event belongs to one of three calendars, and that is what decides who can see it and
        who can change it.
      </p>
      <dl>
        <dt><span class="swatch personal"></span> Personal</dt>
        <dd>
          Your own events. Nobody else can see them, and they are never public. Use them for the
          things you want on the same grid as everything else without telling anyone about them.
        </dd>

        <dt><span class="swatch project"></span> Project</dt>
        <dd>
          Events belonging to a project: release votes, community calls, meetups. Public ones are
          visible to everyone, including people who are not signed in. Private ones are visible only
          to the project's committee (its PMC).
        </dd>

        <dt><span class="swatch foundation"></span> Foundation</dt>
        <dd>
          Events for the ASF as a whole: board meetings, ApacheCon, report deadlines. Public ones are
          visible to everyone; private ones only to foundation members.
        </dd>
      </dl>
    </section>

    <section>
      <h3>Who can do what</h3>
      <p>
        The lists of projects and committees you belong to come from your Apache account, through the
        same login the rest of the foundation's tools use. There is nothing to configure here: sign
        in and the calendar knows.
      </p>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th scope="col">&nbsp;</th>
              {#each COLUMNS as column (column)}
                <th scope="col">{column}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each ROWS as row (row.what)}
              <tr>
                <th scope="row">{row.what}</th>
                {#each row.cells as cell, index (index)}
                  <td>
                    {#if cell === true}
                      <span class="yes" aria-label="yes">&#10003;</span>
                    {:else if cell === false}
                      <span class="no" aria-label="no">&#8211;</span>
                    {:else}
                      <span class="note">{cell}</span>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="muted small">
        "Own projects" means the projects you commit to; "own committees" means the PMCs you sit on.
        Being on a committee also counts as being a member of that project. Any project member can
        edit any of their project's events, not only the ones they added themselves.
      </p>
    </section>

    <section>
      <h3>Getting around</h3>
      <ul>
        <li><strong>Day, week, month, year and agenda</strong> are the five views. Pick one at the top.</li>
        <li>
          The <strong>&#8249;</strong> and <strong>&#8250;</strong> buttons move one view-sized step:
          a day in the day view, a month in the month view, and so on. <strong>Today</strong> jumps
          back to now.
        </li>
        <li>
          Clicking a date number in the month or year view opens that day. Clicking a month name in
          the year view opens that month.
        </li>
        <li>
          A day with more events than fit shows <strong>+n more</strong>; click it to open the day.
        </li>
        <li>Clicking any event opens it, with its full details, shortlink and download link.</li>
      </ul>
    </section>

    <section>
      <h3>Filters and search</h3>
      <p>
        The panel on the left narrows what is drawn. It does not change what you have access to; it
        only hides things you would rather not look at right now.
      </p>
      <ul>
        <li>
          <strong>Calendars</strong> switches the three categories on and off. When you sign in, all
          three start switched on, along with every project you belong to.
        </li>
        <li>
          <strong>Projects</strong> lists your projects plus any others that appear in the events
          currently loaded. Projects you are not a member of stay visible unless you narrow the list
          yourself.
        </li>
        <li><strong>Visibility</strong> lets you look at only the public or only the private events.</li>
        <li>
          <strong>Search</strong> matches the title, description, location and project name of the
          events in view.
        </li>
        <li><strong>Sort</strong> appears in the agenda view, where the order is yours to choose.</li>
      </ul>
    </section>

    <section id="timezones">
      <h3>Timezones</h3>
      <p>
        An event happens at one moment in time, but that moment has a different clock reading
        depending on where you are. The calendar keeps those two things apart.
      </p>
      <ul>
        <li>
          The switch at the top of the page chooses the clock <em>you</em> read the calendar by:
          your browser's own timezone (currently
          <strong>{browserZone()}</strong>, {describeDisplayZone("local")}) or
          <strong>UTC</strong>. It is currently set to <strong>{zone === "utc" ? "UTC" : "your local timezone"}</strong>.
          Everything moves together when you flip it: the grid, the times on each event, and which
          day an event lands on.
        </li>
        <li>
          When you add an event you also choose the timezone the times are <em>in</em>. If you are
          organising a call at 15:00 Berlin time, pick Europe/Berlin and type 15:00, and everybody
          else will see it at their own 15:00-equivalent. Changing the timezone in the form keeps the
          clock reading and moves the moment, which is almost always what you meant.
        </li>
        <li>
          When an event's own timezone differs from the one you are reading in, its details show both.
        </li>
        <li>
          <strong>All-day events are dates, not moments.</strong> An all-day event on 14 March is on
          14 March for everyone, and does not shift when you change the switch.
        </li>
      </ul>
    </section>

    <section>
      <h3>Adding and changing events</h3>
      <p>
        <strong>New event</strong> appears at the top once you are signed in and have somewhere to
        put an event. The form only offers the calendars you can actually write to, so if you cannot
        see a "Foundation" option it is because you are not a foundation member.
      </p>
      <ul>
        <li>A title and a start time are the only things required. An event with no end lasts an hour.</li>
        <li>
          <strong>All day</strong> turns the time fields into date fields. A one-day event is a
          single date; a conference is a range.
        </li>
        <li>
          <strong>Visibility</strong> is public or private. Private means the project committee for
          project events, and foundation members for foundation events. Personal events are always
          private, so there is no choice to make.
        </li>
        <li>
          To edit or delete, open the event and use <strong>Edit</strong>. It only appears if you are
          allowed. You cannot move an event into a calendar you cannot write to, or out of one.
        </li>
      </ul>
    </section>

    <section>
      <h3>Shortlinks and subscribing</h3>
      <ul>
        <li>
          Every event has a short URL, shown in its details, that opens the event directly. It is
          safe to paste anywhere: someone who cannot see the event gets told so rather than shown it.
          Public events show their title in link previews; private ones deliberately do not.
        </li>
        <li>
          <strong>Download .ics</strong> in an event's details saves that one event for your own
          calendar application.
        </li>
        <li>
          <strong>Download .ics</strong> at the bottom of the filter panel gives you everything
          currently in view, filters and all.
        </li>
      </ul>
    </section>

    <section>
      <h3>Signing in</h3>
      {#if session?.authenticated}
        <p>
          You are signed in. <a href={session.logout_url ?? "/auth?logout=/"}>Log out</a> when you
          are done, particularly on a shared machine.
        </p>
      {:else}
        <p>
          <a href={session?.login_url ?? "/auth?login=/"}>Log in</a> with your Apache account. You
          will be sent to the foundation's OAuth service and back again. Nothing is stored here
          beyond your username and the projects and committees you belong to.
        </p>
      {/if}
      <p class="muted small">
        If your affiliations have changed recently and the calendar has not noticed, log out and back
        in; the lists are read when you sign in.
      </p>
    </section>

    <footer>
      <button type="button" class="btn primary" onclick={onclose}>Back to the calendar</button>
    </footer>
  </div>
</div>

<style>
  .help {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1.5rem 1rem 4rem;
  }

  .sheet {
    max-width: 52rem;
    margin: 0 auto;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 1.5rem 1.8rem 1.8rem;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  h2 {
    margin: 0;
    font-size: 22px;
  }

  h3 {
    margin: 0 0 0.4rem;
    font-size: 15px;
    color: var(--asf-red);
  }

  .status {
    margin: 0.6rem 0 0;
    padding: 0.5rem 0.8rem;
    background: var(--bg-subtle);
    border-radius: var(--radius);
    font-size: 13px;
  }

  section {
    margin-top: 1.6rem;
  }

  p,
  li {
    max-width: 62ch;
  }

  ul {
    margin: 0.3rem 0;
    padding-left: 1.2rem;
  }

  li {
    margin-bottom: 0.35rem;
  }

  dl {
    margin: 0.5rem 0 0;
  }

  dt {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-weight: 700;
    margin-top: 0.7rem;
  }

  dd {
    margin: 0.15rem 0 0 1.4rem;
    max-width: 62ch;
  }

  .swatch {
    width: 11px;
    height: 11px;
    border-radius: 3px;
    display: inline-block;
  }

  .swatch.personal {
    background: hsl(265 60% 55%);
  }

  .swatch.project {
    background: hsl(210 60% 55%);
  }

  .swatch.foundation {
    background: hsl(0 60% 55%);
  }

  .tablewrap {
    overflow-x: auto;
    margin: 0.6rem 0;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }

  th,
  td {
    border: 1px solid var(--border);
    padding: 0.35rem 0.6rem;
    text-align: center;
  }

  thead th {
    background: var(--bg-subtle);
    font-size: 12px;
  }

  tbody th {
    text-align: left;
    font-weight: 500;
    white-space: nowrap;
  }

  .yes {
    color: hsl(140 60% 35%);
    font-weight: 700;
  }

  .no {
    color: var(--text-faint);
  }

  .note {
    font-size: 11px;
    color: var(--text-muted);
  }

  .small {
    font-size: 12px;
  }

  footer {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  @media (prefers-color-scheme: dark) {
    .yes {
      color: hsl(140 50% 60%);
    }
  }
</style>
