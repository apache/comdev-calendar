# ASF Community Calendar

A shared calendar for the Apache Software Foundation. It holds three kinds of
events, each with its own rules about who may see and change them:

- **Personal events** belong to one person. Nobody else can see them.
- **Project events** belong to a project. Public ones are visible to everybody,
  including people who are not logged in; private ones are visible only to the
  project's committee. Project members create and edit them.
- **Foundation events** belong to the ASF as a whole. Public ones are visible to
  everybody; private ones are visible only to foundation members. Only members
  can create or edit them.

Every event has a shortlink, something like `https://calendar.apache.org/e/Qvj3wfyH`,
that opens the event directly. Public events also carry OpenGraph tags on that
page, so pasting a shortlink into chat or email shows the event title rather
than a bare URL.

The web UI has day, week, month, year and agenda views, filters for calendars,
projects and visibility, a text search, and an iCalendar export so events can be
pulled into whatever calendar application you already use. When you are logged
in it opens showing everything you have access to: your own events, every
project you belong to, and the foundation calendar.

It is timezone aware in both directions. When you add an event you say which
timezone the times are in, and everybody else sees them on their own clock. A
switch at the top of the page flips the whole calendar between your browser's
timezone and UTC. There is also a help page, at `/help`, that explains the
views, the filters, the timezone switch and exactly what each kind of user can
see and do.

The backend is [asfquart](https://github.com/apache/infrastructure-asfquart)
(Quart with ASF conventions layered on top), which provides the OAuth login
against `oauth.apache.org` and the project and committee membership that the
access rules are built on. The frontend is Svelte 5 built with Vite.

## Contents

- [How access works](#how-access-works)
- [Requirements](#requirements)
- [Installing](#installing)
- [Configuration](#configuration)
- [Running it](#running-it)
- [Serving from a sub-directory](#serving-from-a-sub-directory)
- [Timezones](#timezones)
- [The API](#the-api)
- [Project layout](#project-layout)
- [Tests](#tests)
- [Debugging](#debugging)
- [Things it does not do](#things-it-does-not-do)

## How access works

After an OAuth login, asfquart puts the user's affiliations into the session:
`session.projects` lists the projects they commit to, `session.committees` lists
the committees (PMCs) they sit on, and `session.isMember` says whether they are
a foundation member. Those three facts decide everything.

| Category   | Visibility | Who can read it                     | Who can create, edit and delete   |
| ---------- | ---------- | ----------------------------------- | --------------------------------- |
| personal   | private    | the owner                           | the owner                         |
| project    | public     | everybody, including anonymous      | `session.projects` for that project |
| project    | private    | `session.committees` for that project | `session.committees` for that project |
| foundation | public     | everybody, including anonymous      | foundation members                |
| foundation | private    | foundation members                  | foundation members                |

A few details worth knowing:

- Personal events are always private. If a client asks for a public personal
  event, it is stored as private anyway.
- Committee membership implies project membership. A PMC member who is somehow
  missing from the committer list can still manage their project's public
  events.
- Any project member can edit any of their project's events, not only the ones
  they created. The `owner` field records who added an event but does not
  restrict who can change it.
- An edit has to pass the check twice: once against the event as it is stored,
  and once against the event as it would be afterwards. That stops somebody
  moving an event into a calendar they cannot write to, or out of one they
  cannot write to.
- The membership test uses asfquart's own `Requirements.member`, so this app
  agrees with whatever `@asfquart.auth.require({R.member})` would decide
  elsewhere.

The rules live in one place, `backend/asfcalendar/permissions.py`, as plain
functions over `(event, session)`. `backend/tests/test_permissions.py` walks
through every combination of category, visibility, project and user. The same
table, written for users rather than for developers, is in the app itself at
`/help`, along with a note about what the current visitor's own account allows.

The database query that lists events applies the same rules as a SQL `WHERE`
clause, so listing a month does not mean loading every event in the table and
filtering in Python. The API then runs `can_view` over the results anyway. That
is deliberate belt and braces: a mistake in the SQL should not become a
disclosure bug, and there is a test asserting the two agree.

## Requirements

- Python 3.11 or newer
- [uv](https://docs.astral.sh/uv/) for the backend
- Node.js 20 or newer for the frontend

Nothing else. Events live in a SQLite file, so there is no database server to
set up.

## Installing

```shell
git clone https://github.com/apache/comdev-calendar.git
cd comdev-calendar

# Backend dependencies, into .venv
uv sync --all-groups

# Frontend dependencies
cd frontend && npm ci && cd ..

# Configuration
cp config.yaml.example config.yaml
```

Or, if you have `make`:

```shell
make install
cp config.yaml.example config.yaml
```

## Configuration

Configuration lives in `config.yaml` in the repository root, in the YAML format
asfquart reads. `config.yaml.example` documents every key; all of them are
optional and the defaults are fine for local work.

```yaml
server:
  host: 127.0.0.1
  port: 8080
  # Absolute base URL of the deployment, used to build shortlinks. Leave it
  # empty and the base is taken from the incoming request instead.
  base_url: "https://calendar.apache.org"

database:
  path: "calendar.sqlite3"

app:
  title: "ASF Community Calendar"
  frontend_dist: "frontend/dist"
  # Which clock the calendar opens on for someone who has not chosen:
  # "local" or "utc".
  default_display_zone: "local"
  shortlink_prefix: "/e"

oauth:
  uri: "/auth"

debug: false

# Read by asfquart itself: maximum session lifetime in seconds, 0 for no limit.
MAX_SESSION_AGE: 0
```

Relative paths are resolved against the directory holding `config.yaml`.

Two files appear at runtime and should not be committed (both are in
`.gitignore`):

- `calendar.sqlite3` - the event database.
- `apptoken.txt` - the key asfquart uses to sign session cookies. It is created
  with mode 0600 on first start. Delete it and everybody is logged out.

## Running it

### Development

You want two processes. The backend serves the API and handles OAuth; the Vite
dev server serves the UI with hot reloading and proxies `/api` and `/auth`
through to the backend, so the browser sees a single origin and session cookies
work normally.

```shell
# Terminal 1
uv run asf-calendar --reload

# Terminal 2
cd frontend && npm run dev
```

Then open <http://localhost:5173>.

If your backend is somewhere other than `http://127.0.0.1:8080`, tell Vite:

```shell
BACKEND=http://127.0.0.1:9000 npm run dev
```

Useful backend flags:

```
-c, --config PATH   path to the YAML config (default: ./config.yaml)
    --host HOST     bind address, overriding the config
    --port PORT     port, overriding the config
    --reload        restart when a source file changes
    --debug         Quart debug mode, with tracebacks in responses
    --access-log    log every request
-v, --verbose       log at DEBUG level
```

### Production

`frontend/dist` is committed to the repository, kept up to date by CI (see
[Committed build output](#committed-build-output)). A deployment is therefore a
checkout and the backend, with no Node involved:

```shell
uv run asf-calendar
```

The backend serves `frontend/dist` as static files and falls back to
`index.html` for client-side routes. If you are working from a branch where the
build is stale, or you have just changed the UI locally, rebuild it yourself:

```shell
cd frontend && npm ci && npm run build && cd ..
```

The server is [hypercorn](https://hypercorn.readthedocs.io/). To run it directly,
for instance under systemd with your own worker settings:

```shell
uv run hypercorn --bind 0.0.0.0:8080 --workers 1 'asfcalendar.app:create_app()'
```

Use one worker. asfquart keeps the pending OAuth states in a process-local
dictionary, so with several workers a login started on one and completed on
another will fail. This is
[a known asfquart limitation](https://github.com/apache/infrastructure-asfquart/issues/52).

### As a service

`pipservice-comdev-calendar.service` is a systemd unit for the ASF's pipservice
deployment pattern. It runs `uv run asf-calendar` from the checkout, which finds
`pyproject.toml` and `config.yaml` by walking up from the package directory.

If you move things around, or install the package rather than running it from a
checkout, pin the config explicitly rather than relying on that: either pass
`--config /path/to/config.yaml`, or set `ASF_CALENDAR_CONFIG` in the unit. The
same environment variable is what `--reload` uses to hand the config path to its
worker processes.

Behind httpd or another reverse proxy, pass the original `Host` header through.
asfquart builds the OAuth callback URL from it, and a rewritten host sends users
back to the wrong place after login:

```apache
ProxyPreserveHost On
ProxyPass        / http://127.0.0.1:8080/
ProxyPassReverse / http://127.0.0.1:8080/
```

That is the layout for a calendar at the root of its host. To serve it from a
sub-directory instead, see [Serving from a
sub-directory](#serving-from-a-sub-directory).

Session cookies are set with `Secure`, so the deployment has to be served over
HTTPS. See [Debugging](#debugging) if logins seem to work but do not stick.

## Serving from a sub-directory

The calendar normally sits at the root of a host, at
`https://calendar.apache.org/`. It can be mounted in a sub-directory instead by
setting one config key:

```yaml
server:
  base_path: "/calendar"
```

Everything moves under it in one go: the pages, the whole `/api` surface, the
OAuth endpoint, the static assets and the event shortlinks. A shortlink becomes
`https://calendar.apache.org/calendar/e/AbCd2345`, the login URL becomes
`/calendar/auth?login=/calendar/`, and the callback URL asfquart sends to the
OAuth provider comes back to `/calendar/auth` as well, so the whole login
round-trip stays inside the mount point.

**The reverse proxy has to pass the prefix through, not strip it.** The app
answers on the prefixed paths, so:

```apache
ProxyPreserveHost On
ProxyPass        /calendar/ http://127.0.0.1:8080/calendar/
ProxyPassReverse /calendar/ http://127.0.0.1:8080/calendar/
```

Note the `/calendar/` on both sides. Getting this wrong is the one likely
mistake, so the app watches for it: a request that arrives outside the mount
point gets a 404 saying which URL the calendar answers on and printing the
`ProxyPass` line it expects. A plain `GET /` redirects to `/calendar/`.

### How it works, and why the build is not involved

The obvious way to do this in a Vite app is `base: "/calendar/"` at build time.
That would be wrong here, because `frontend/dist` is committed to the repository
and shared between deployments - baking a prefix in would tie one build to one
mount point.

Instead the prefix is applied when a page is served:

- Vite is configured with `base: "./"`, so the built `index.html` refers to its
  script, stylesheet and favicon relatively. Nothing in `dist` mentions an
  absolute path.
- `index.html` ships with `<base href="/">` as the first thing in its `<head>`.
  The backend rewrites that one attribute to the configured mount point on the
  way out. The browser then resolves those relative URLs against it, which is
  also what makes them work on a nested route such as `/calendar/e/AbCd2345`,
  where resolving against the document's own directory would look for the
  assets under `/calendar/e/`.
- The frontend reads the mount point back out of `document.baseURI` and puts it
  in front of its own API calls, its client-side routes and its `pushState`
  navigation. That lives in `frontend/src/lib/base.ts`.

So the same committed build serves both layouts, and switching between them is a
config edit and a restart.

One thing to keep in mind if you are editing the frontend: because `<base href>`
is set, **every relative URL in the page resolves against the mount point**, not
against the current route. Build paths with the helpers in `base.ts` rather than
writing `/api/...`, `/auth?login=/` or `/icon.png` by hand, or they will break
the moment somebody mounts the app in a sub-directory:

| Helper                | For                                                   |
| --------------------- | ----------------------------------------------------- |
| `apiUrl("/events")`   | an API endpoint                                        |
| `appPath("/help")`    | a client-side route, including `pushState` targets     |
| `assetUrl("icon.png")`| a file shipped in the build                            |
| `loginUrl()`          | the OAuth login link                                   |
| `logoutUrl()`         | the OAuth logout link                                  |
| `withoutBase(path)`   | turning `location.pathname` back into an app route     |

The login and logout links are a special case worth knowing about. `/api/session`
returns the real URLs, because a deployment can move the endpoint with the
`oauth.uri` config key, and those always win. `loginUrl()` and `logoutUrl()` are
the fallbacks used before that request has come back or if it fails - which is
precisely when somebody is most likely to be reaching for the login link, so
they have to be right too.

### Developing against a mounted backend

The Vite dev server always serves the app at the root. If the backend you are
proxying to has a `base_path` set, tell the proxy where to find it:

```shell
BASE_PATH=/calendar npm run dev
```

For everyday work it is simpler to leave `base_path` empty in your local
`config.yaml` and test the sub-directory setup against the built frontend.

## Timezones

An event happens at one moment in time, but that moment reads differently on
different clocks. The app keeps those two things apart, and the distinction runs
all the way through:

- **Instants** are what the backend stores. Every event's start and end are
  epoch seconds in UTC, and the API talks in ISO 8601 UTC. There is no ambiguity
  about when an event actually is.
- **The event timezone** is what the organiser meant when they typed the times
  in. It is stored alongside the event as an IANA name such as `Europe/Berlin`,
  validated against the system tz database. An event form entry of "15:00" in
  Berlin means 13:00 UTC in July and 14:00 UTC in January, and the app works
  that out. Changing the timezone in the form keeps the clock reading and moves
  the instant, which is what an organiser almost always means.
- **The display timezone** is the clock the reader wants. The switch in the
  header flips between the browser's own zone and UTC. It moves everything
  together: the grid columns, the position of each block in the day, the times
  on each event, and which day an event falls on. The choice is remembered in
  the browser; `app.default_display_zone` in the config decides what a first-time
  visitor gets.

When an event's own timezone is not the one you are reading in, its details show
both: the headline time on your clock, and a line saying how the organiser
entered it.

**All-day events are dates, not instants.** They are snapped to whole UTC days
and have no organiser timezone, exactly as iCalendar treats a `VALUE=DATE`
event. An all-day event on 14 March is on 14 March for everybody, and does not
move when the switch is flipped. Their stored end is exclusive: midnight of the
day after the last day.

In the iCalendar export, `DTSTART` and `DTEND` are always UTC, which every
client reads correctly. The organiser's zone rides along as an
`X-ASF-EVENT-TIMEZONE` property for anything that cares.

The conversions live in `frontend/src/lib/timezone.ts`. The trick it uses is
worth knowing about if you go reading it: a "wall date" is an ordinary
JavaScript `Date` whose *local* getters read as the wall clock in some other
zone. Converting at the edges means the whole grid arithmetic works unchanged,
whichever clock is on display. Offsets for named zones come from
`Intl.DateTimeFormat`, so daylight saving is handled by the browser's own tz
data rather than by us.

## The API

Everything under `/api` speaks JSON, errors included. Anonymous reads are
allowed; anything that writes needs a session.

| Method            | Path                     | What it does                                        |
| ----------------- | ------------------------ | --------------------------------------------------- |
| GET               | `/api/session`           | who is logged in, plus login and logout URLs        |
| GET               | `/api/calendars`         | which calendars this session can read and write     |
| GET               | `/api/events`            | list events (see the filters below)                 |
| POST              | `/api/events`            | create an event                                     |
| GET               | `/api/events/<id>`       | one event                                           |
| PUT, PATCH        | `/api/events/<id>`       | replace an event                                    |
| DELETE            | `/api/events/<id>`       | delete an event                                     |
| GET               | `/api/events/<id>.ics`   | one event as iCalendar                              |
| GET               | `/api/events.ics`        | a filtered iCalendar feed                           |
| GET               | `/api/shortlink/<token>` | look an event up by its shortlink token             |
| GET               | `/api/healthz`           | liveness check                                      |

Outside `/api`, the backend serves the built frontend: `/` for the calendar,
`/help` for the help page, and `/e/<token>` for an event shortlink. All three
are client-side routes, so the backend answers them with the same SPA shell.

`GET /api/events` accepts:

| Parameter               | Meaning                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `start`, `end`          | ISO 8601 or epoch seconds; returns events overlapping `[start, end)` |
| `category`, `categories`| `personal`, `project` or `foundation`; repeat or comma-separate |
| `project`, `projects`   | project names; repeat or comma-separate                        |
| `visibility`            | `public` or `private`                                          |
| `owner`                 | a uid, or `me`                                                 |
| `q`                     | text search over title, description, location and project      |
| `sort`                  | `start`, `-start`, `title`, `-title`, `created`, `-created`     |
| `limit`, `offset`       | paging; `limit` is capped at 2000                              |

A minimal create:

```shell
curl -X POST http://localhost:8080/api/events \
  -H 'Content-Type: application/json' \
  -H 'X-No-Redirect: 1' \
  -b cookies.txt \
  -d '{
        "title": "Release party",
        "category": "project",
        "project": "httpd",
        "visibility": "public",
        "start": "2026-04-01T17:00:00Z",
        "end": "2026-04-01T19:00:00Z"
      }'
```

Timestamps go in and come out as ISO 8601 in UTC. Epoch seconds are accepted on
the way in. All-day events are snapped to whole UTC days, and their end is
exclusive, matching iCalendar's `DTEND`.

An event may also carry a `timezone`, an IANA name such as `"Europe/Berlin"`,
recording the clock the organiser entered the times on. It defaults to `"UTC"`,
is validated against the tz database, and is forced to `"UTC"` for all-day
events.

It has one effect on parsing: a timestamp sent with **no** offset is read in the
event's timezone rather than in UTC, so the obvious thing works.

```
{"start": "2026-07-10T15:00:00",      "timezone": "Europe/Berlin"}  ->  13:00Z
{"start": "2026-01-10T15:00:00",      "timezone": "Europe/Berlin"}  ->  14:00Z
{"start": "2026-07-10T15:00:00Z",     "timezone": "Europe/Berlin"}  ->  15:00Z
{"start": "2026-07-10T15:00:00+09:00","timezone": "Europe/Berlin"}  ->  06:00Z
```

A timestamp that says what offset it is in, or ends in `Z`, is always taken at
face value. Epoch seconds are unaffected. The frontend always sends an absolute
UTC instant, so this only matters to anything talking to the API directly.

`X-No-Redirect: 1` matters. Without it, asfquart answers an unauthenticated
request by redirecting to the OAuth provider, which is right for a browser
following a link and useless for a `fetch()` or a `curl`. With it you get a JSON
401. The frontend sends it on every request.

Errors look like this, with `field` present when a particular field was at
fault:

```json
{ "error": "'end' must be after 'start'", "field": "end" }
```

## Project layout

```
backend/
  asfcalendar/
    __main__.py      command line entry point, starts hypercorn
    app.py           builds the Quart app, static files, shortlink pages
    api.py           the /api blueprint
    permissions.py   the access rules, as pure functions
    storage.py       SQLite, including the visibility SQL
    models.py        the Event type and payload validation
    ics.py           iCalendar output
    shortlink.py     shortlink tokens
    config.py        reading config.yaml
  tests/             pytest suite

frontend/
  src/
    App.svelte       state, loading and routing
    components/      Header, FilterPanel, the five views, EventDialog, HelpPage
    lib/
      api.ts         the API client
      base.ts        the deployment's mount point, for sub-directory installs
      dates.ts       date arithmetic and grid maths
      timezone.ts    wall-clock conversions and the display-zone switch
      events.ts      grouping, overlap layout, colours
      filters.ts     client-side filtering and sorting
      drafts.ts      new and edited events, and a local canEdit
      types.ts       shared types
    tests/           component tests and fixtures

config.yaml.example  documented configuration
images.png           the site logo; copied to frontend/public/icon.png
```

## Tests

### Backend

```shell
uv run pytest                       # the whole suite
uv run pytest -k permissions        # one area
uv run pytest --cov=backend/asfcalendar --cov-report=term-missing
uv run mypy                         # strict type checking
uv run ruff check backend           # lint
```

The suite covers the access rules exhaustively, the storage layer including the
agreement between the SQL filter and `can_view`, payload validation, the
iCalendar output, and the HTTP API end to end through Quart's test client.

Sessions in the API tests are set through the real signed session cookie rather
than by patching, so they take the same path asfquart does in production. The
personas live in `backend/tests/conftest.py`:

| Persona | Projects       | Committees | Member |
| ------- | -------------- | ---------- | ------ |
| alice   | httpd, tomcat  | -          | no     |
| bob     | httpd          | httpd      | no     |
| carol   | tomcat         | tomcat     | yes    |
| dave    | maven          | -          | no     |

Between them they cover committer without committee, committee member,
foundation member, and complete outsider.

### Frontend

```shell
cd frontend
npm run test        # vitest, once
npm run test:watch  # vitest, watching
npm run check       # svelte-check: types across .ts and .svelte
npm run coverage
```

The date and layout maths, the timezone conversions, the filters, the draft
handling and the API client are tested as plain functions. The components are
rendered into jsdom with Testing Library and driven the way a user would drive
them.

The suite pins `TZ` to UTC so assertions about local time are stable;
`src/tests/setup.ts` does that. That would hide any bug in the display-zone
switch, since local and UTC agree there, so `src/lib/events.zone.test.ts` puts
the browser in Asia/Tokyo for its duration and checks that events move to the
right day, land in the right place in the grid, and that all-day events do not
move at all.

### CI

Three GitHub workflows, all path-filtered so a backend change does not start the
frontend jobs and vice versa:

- `.github/workflows/backend.yml` runs ruff, `ruff format --check`, mypy, and
  pytest on Python 3.11, 3.12 and 3.13, then boots the real server and calls it.
- `.github/workflows/frontend.yml` runs svelte-check and vitest on Node 20 and
  22, builds the UI, and uploads `frontend/dist` as an artifact. This is the one
  that runs on pull requests.
- `.github/workflows/build-dist.yml` rebuilds `frontend/dist` on pushes to the
  default branch and commits the result back if it differs. See below.

### Committed build output

`frontend/dist` is tracked in git rather than ignored, so that deploying the app
needs nothing but a checkout and Python. Keeping it honest by hand would be
tedious and easy to forget, so `build-dist.yml` does it: on every push that
touches `frontend/` it runs `npm ci && npm run build`, compares the result with
what is committed, and pushes a "Rebuild frontend/dist" commit when they differ.
When they match, which is the usual case for a backend-only or docs change, it
does nothing.

Some details that matter if you are changing that workflow:

- **It cannot set itself off.** GitHub does not start new workflow runs from
  commits pushed with `GITHUB_TOKEN`. The `!frontend/dist/**` path exclusion is
  a second line of defence, for the day somebody swaps in a PAT.
- **The build is reproducible.** Vite names its output by content hash, so an
  unchanged source tree produces byte-identical files and the "did anything
  change" check is trustworthy rather than approximate.
- **Stale assets are removed.** The commit uses `git add -A`, so the previous
  hashed filenames go away instead of accumulating.
- **Concurrent pushes are handled.** Runs are serialised per branch and an
  in-flight build is cancelled by a newer push, since its output is obsolete
  anyway. If a push is still rejected because the branch moved, the workflow
  replays the build onto the new tip, up to three times.

You will get merge conflicts in `frontend/dist` if two branches both change the
UI. Resolve them by rebuilding rather than by editing: `npm run build` in
`frontend/`, then `git add frontend/dist`. Or simply take either side and let CI
correct it on the next push to the default branch.

The build includes a source map, which is most of the roughly 750 KB in `dist`
and changes whenever the UI does. It is there because it makes production
problems debuggable. If you would rather not carry it in the history, set
`sourcemap: false` in `frontend/vite.config.ts`.

## Debugging

**Nothing but a page saying there is no frontend build.** The backend could not
find `frontend/dist/index.html`. It is committed to the repository, so this
usually means a `make clean`, a stray `rm -rf`, or a checkout of a branch from
before it was tracked. Run `npm run build` in `frontend/`, or use the Vite dev
server and open port 5173 instead of 8080. The page tells you which path it
looked in.

**The deployed UI is not the code you just merged.** `frontend/dist` is
committed, and the `Build dist` workflow updates it on pushes to the default
branch. Check that workflow ran and pushed its commit; a deployment from before
that commit will still be serving the previous build.

**The UI loads but every request fails.** Open the browser's network tab. If
`/api/session` returns HTML, the Vite proxy is not reaching the backend; check
the backend is running and that `BACKEND` points at it. If it returns a 502, the
backend crashed - look at its terminal.

**Login redirects to `oauth.apache.org` and comes back to the wrong host.**
asfquart builds the callback URL from the `Host` header. Behind a proxy, set
`ProxyPreserveHost On`. Locally, use the Vite dev server rather than opening the
backend port directly, so everything is on one origin.

**Login appears to work but you are still logged out.** Session cookies are set
`Secure`, `HttpOnly` and `SameSite=Strict`, so the browser will not store them
over plain http on a non-localhost host. In development use localhost; in
production terminate TLS in front of the app. `Secure` is relaxed only when the
app is constructed with `testing=True`, which is for the test suite.

**An API call redirects to `/auth` instead of returning JSON.** Send
`X-No-Redirect: 1`. asfquart's redirect-to-login behaviour is deliberate for
browsers and unhelpful for scripts.

**A 403 with a message about a project or committee.** That is the access rules
working. `GET /api/session` shows what asfquart thinks you are a member of, and
`GET /api/calendars` shows what that entitles you to. If the lists look wrong,
the problem is in LDAP or the OAuth response, not here; logging out and back in
picks up changed affiliations.

**Wanting to see the rules decide something in isolation.** They are pure
functions and take a plain object:

```python
from asfquart.session import ClientSession
from asfcalendar.permissions import can_view, can_write

session = ClientSession({"uid": "bob", "pmcs": ["httpd"], "projects": ["httpd"]})
can_view(some_event, session)
```

**Under a sub-directory, the page loads but is unstyled and blank.** The browser
is fetching the assets from the wrong place. Look at the served HTML: the
`<base href>` should be `/calendar/`, matching `server.base_path`. If it says
`/`, the config did not take effect; if the assets 404, the proxy is probably
stripping the prefix, which the section above covers.

**Under a sub-directory, everything 404s with a message about `ProxyPass`.**
That is the app telling you the request arrived outside its mount point. Either
`server.base_path` does not match what the proxy sends, or the proxy is
rewriting `/calendar/x` to `/x`. The message prints the directive it expects.

**Shortlinks come out as `/calendar/calendar/e/...`.** Older configs put the
path in `server.base_url`. Only the scheme and host are read from it now, so
this should not happen; if it does, the `base_path` value itself has the prefix
twice.

**An event shows up on the wrong day.** Check the timezone switch in the header.
An event at 22:00 UTC is the following morning in Tokyo, and the calendar will
correctly put it there when the browser's clock is on display. If the event is
all-day, it should not move at all; if it does, that is a bug worth reporting.

**An event was posted at the wrong time.** The form's times are in the timezone
picked in the form, which is not necessarily the one the calendar is being
displayed in. The event's details show both once it is saved.

**`'Europe/Berlin' is not a known timezone`.** The Python process cannot find a
tz database. The `tzdata` package is a dependency for exactly this reason, so
`uv sync` should fix it; on a system with its own zoneinfo it is not used.

**`database is locked`.** SQLite allows one writer at a time. It should not
happen with a single worker; if it does, something else has the file open - a
second copy of the app, or a `sqlite3` shell.

**Changes to Python files are ignored.** Start with `--reload`. Note that
`app.runx()`, asfquart's own watcher, is not what this app uses: asfquart 0.1.12
restarts by calling `quart.utils.restart()`, which newer Quart releases renamed
to `run_reloader`, so the process dies on the first reload. `--reload` uses
hypercorn's reloader instead.

**More logging.** `-v` turns on DEBUG for everything, `--access-log` logs
requests. `--debug` additionally puts Quart in debug mode, which returns
tracebacks in HTTP responses; that is for local use only.

**Looking directly at the data.**

```shell
sqlite3 calendar.sqlite3 'SELECT id, shortlink, category, visibility, project, title FROM events;'
```

**Everybody suddenly logged out.** `apptoken.txt` was deleted or replaced, so
existing session cookies no longer verify. Expected; they just need to log in
again.

## Things it does not do

Worth being clear about, so nobody goes looking:

- No recurring events. Every event is a single occurrence.
- No invitations, attendance or reminders. It is a calendar, not a scheduler.
- No per-event access lists. Access follows the category and visibility, and
  nothing else.
- No per-viewer timezone beyond the local/UTC switch. You cannot ask to read the
  calendar in a third zone that is neither yours nor UTC.
- One process only, because of the OAuth state limitation described above.

## Licence

Apache License 2.0.
