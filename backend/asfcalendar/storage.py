"""SQLite storage for calendar events.

The visibility rules from ``permissions`` are mirrored here as a SQL WHERE
clause so listing events does not mean pulling the whole table into Python.
The API layer still runs ``permissions.can_view`` over the results, so a
mistake in the SQL cannot leak an event; the tests check that the two agree.
"""

from __future__ import annotations

import pathlib
import time
from collections.abc import Iterable, Sequence
from typing import Any

import aiosqlite

from . import shortlink
from .models import Event, EventInput
from .permissions import SessionLike, committees_of, is_member, uid_of

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    shortlink   TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    visibility  TEXT    NOT NULL,
    starts_at   INTEGER NOT NULL,
    ends_at     INTEGER NOT NULL,
    all_day     INTEGER NOT NULL DEFAULT 0,
    description TEXT    NOT NULL DEFAULT '',
    location    TEXT    NOT NULL DEFAULT '',
    url         TEXT    NOT NULL DEFAULT '',
    project     TEXT,
    timezone    TEXT    NOT NULL DEFAULT 'UTC',
    owner       TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_range_idx ON events (starts_at, ends_at);
CREATE INDEX IF NOT EXISTS events_scope_idx ON events (category, visibility, project);
CREATE INDEX IF NOT EXISTS events_owner_idx ON events (owner);
"""

# Columns added after the initial schema, applied by Storage._migrate().
ADDED_COLUMNS: list[tuple[str, str]] = [
    ("timezone", "timezone TEXT NOT NULL DEFAULT 'UTC'"),
]

MAX_LIMIT = 2000
SORT_COLUMNS = {
    "start": "starts_at ASC, id ASC",
    "-start": "starts_at DESC, id DESC",
    "title": "title COLLATE NOCASE ASC, starts_at ASC",
    "-title": "title COLLATE NOCASE DESC, starts_at ASC",
    "created": "created_at ASC, id ASC",
    "-created": "created_at DESC, id DESC",
}
DEFAULT_SORT = "start"


def _row_to_event(row: aiosqlite.Row) -> Event:
    return Event(
        id=int(row["id"]),
        shortlink=str(row["shortlink"]),
        title=str(row["title"]),
        category=row["category"],
        visibility=row["visibility"],
        start=int(row["starts_at"]),
        end=int(row["ends_at"]),
        all_day=bool(row["all_day"]),
        description=str(row["description"]),
        location=str(row["location"]),
        url=str(row["url"]),
        project=row["project"],
        timezone=str(row["timezone"] or "UTC"),
        owner=str(row["owner"]),
        created_at=int(row["created_at"]),
        updated_at=int(row["updated_at"]),
    )


def visibility_sql(session: SessionLike | None) -> tuple[str, list[Any]]:
    """Builds the WHERE fragment describing what this session may read."""
    clauses: list[str] = ["(category = 'project' AND visibility = 'public')"]
    params: list[Any] = []

    clauses.append("(category = 'foundation' AND visibility = 'public')")

    uid = uid_of(session)
    if uid is not None:
        clauses.append("(category = 'personal' AND owner = ?)")
        params.append(uid)

    committees = sorted(committees_of(session))
    if committees:
        placeholders = ", ".join("?" for _ in committees)
        clauses.append(f"(category = 'project' AND visibility = 'private' AND project IN ({placeholders}))")
        params.extend(committees)

    if is_member(session):
        clauses.append("(category = 'foundation' AND visibility = 'private')")

    return "(" + " OR ".join(clauses) + ")", params


class Storage:
    """Thin async wrapper around a single SQLite database file."""

    def __init__(self, path: pathlib.Path | str):
        self.path = pathlib.Path(path)
        self._db: aiosqlite.Connection | None = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("Storage.connect() has not been awaited")
        return self._db

    async def connect(self) -> None:
        if self._db is not None:
            return
        if self.path.parent and str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self.path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA foreign_keys=ON")
        await self._db.executescript(SCHEMA)
        await self._migrate()
        await self._db.commit()

    async def _migrate(self) -> None:
        """Adds columns introduced after the first release.

        SQLite has no "ADD COLUMN IF NOT EXISTS", so we look at the table
        first. Each entry is a column name and the DDL that creates it.
        """
        async with self.db.execute("PRAGMA table_info(events)") as cursor:
            existing = {str(row["name"]) for row in await cursor.fetchall()}
        for column, ddl in ADDED_COLUMNS:
            if column not in existing:
                await self.db.execute(f"ALTER TABLE events ADD COLUMN {ddl}")

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    async def __aenter__(self) -> Storage:
        await self.connect()
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.close()

    async def create(self, data: EventInput, owner: str, *, now: int | None = None) -> Event:
        """Inserts a new event owned by ``owner`` and returns it."""
        if not owner:
            raise ValueError("An event needs an owner")
        stamp = int(now if now is not None else time.time())
        event_id = await self._insert(data, owner, stamp)
        await self.db.commit()
        created = await self.get(event_id)
        assert created is not None
        return created

    async def _insert(self, data: EventInput, owner: str, stamp: int) -> int:
        """Writes one row and returns its id, without committing.

        Retries on the astronomically unlikely shortlink collision.
        """
        for _attempt in range(8):
            token = shortlink.generate()
            try:
                cursor = await self.db.execute(
                    """
                    INSERT INTO events (shortlink, title, category, visibility, starts_at, ends_at,
                                        all_day, description, location, url, project, timezone,
                                        owner, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        token,
                        data.title,
                        data.category,
                        data.visibility,
                        data.start,
                        data.end,
                        int(data.all_day),
                        data.description,
                        data.location,
                        data.url,
                        data.project,
                        data.timezone,
                        owner,
                        stamp,
                        stamp,
                    ),
                )
            except aiosqlite.IntegrityError:
                continue
            return int(cursor.lastrowid or 0)
        raise RuntimeError("Could not allocate a unique shortlink")

    async def create_many(self, data: Sequence[EventInput], owner: str, *, now: int | None = None) -> list[Event]:
        """Inserts several events in one transaction.

        An import either lands completely or not at all: if any row fails, the
        whole batch is rolled back rather than leaving somebody to work out
        which half of their calendar arrived.
        """
        if not owner:
            raise ValueError("An event needs an owner")
        if not data:
            return []

        stamp = int(now if now is not None else time.time())
        created_ids: list[int] = []
        try:
            for entry in data:
                created_ids.append(await self._insert(entry, owner, stamp))
        except Exception:
            await self.db.rollback()
            raise
        await self.db.commit()

        created: list[Event] = []
        for event_id in created_ids:
            event = await self.get(event_id)
            assert event is not None
            created.append(event)
        return created

    async def get(self, event_id: int) -> Event | None:
        async with self.db.execute("SELECT * FROM events WHERE id = ?", (event_id,)) as cursor:
            row = await cursor.fetchone()
        return _row_to_event(row) if row else None

    async def get_by_shortlink(self, token: str) -> Event | None:
        if not shortlink.is_valid(token):
            return None
        async with self.db.execute("SELECT * FROM events WHERE shortlink = ?", (token,)) as cursor:
            row = await cursor.fetchone()
        return _row_to_event(row) if row else None

    async def update(self, event_id: int, data: EventInput, *, now: int | None = None) -> Event | None:
        """Applies a validated payload to an existing event. Ownership and the
        shortlink never change."""
        stamp = int(now if now is not None else time.time())
        cursor = await self.db.execute(
            """
            UPDATE events
               SET title = ?, category = ?, visibility = ?, starts_at = ?, ends_at = ?, all_day = ?,
                   description = ?, location = ?, url = ?, project = ?, timezone = ?, updated_at = ?
             WHERE id = ?
            """,
            (
                data.title,
                data.category,
                data.visibility,
                data.start,
                data.end,
                int(data.all_day),
                data.description,
                data.location,
                data.url,
                data.project,
                data.timezone,
                stamp,
                event_id,
            ),
        )
        await self.db.commit()
        if cursor.rowcount == 0:
            return None
        return await self.get(event_id)

    async def delete(self, event_id: int) -> bool:
        cursor = await self.db.execute("DELETE FROM events WHERE id = ?", (event_id,))
        await self.db.commit()
        return bool(cursor.rowcount)

    async def query(
        self,
        session: SessionLike | None,
        *,
        start: int | None = None,
        end: int | None = None,
        categories: Iterable[str] | None = None,
        projects: Iterable[str] | None = None,
        visibility: str | None = None,
        owner: str | None = None,
        search: str | None = None,
        sort: str = DEFAULT_SORT,
        limit: int = MAX_LIMIT,
        offset: int = 0,
    ) -> list[Event]:
        """Lists events the session may see, narrowed by the given filters.

        ``start``/``end`` select events that overlap the half-open window
        [start, end), which is what a calendar grid wants.
        """
        where, params = visibility_sql(session)
        clauses = [where]

        if start is not None:
            clauses.append("ends_at > ?")
            params.append(int(start))
        if end is not None:
            clauses.append("starts_at < ?")
            params.append(int(end))

        category_list = _clean_list(categories)
        if category_list:
            clauses.append(f"category IN ({', '.join('?' for _ in category_list)})")
            params.extend(category_list)

        project_list = _clean_list(projects)
        if project_list:
            clauses.append(f"project IN ({', '.join('?' for _ in project_list)})")
            params.extend(project_list)

        if visibility in ("public", "private"):
            clauses.append("visibility = ?")
            params.append(visibility)

        if owner:
            clauses.append("owner = ?")
            params.append(owner)

        if search:
            needle = f"%{search.strip().lower()}%"
            clauses.append(
                "(lower(title) LIKE ? OR lower(description) LIKE ? OR lower(location) LIKE ? OR lower(project) LIKE ?)"
            )
            params.extend([needle] * 4)

        order = SORT_COLUMNS.get(sort, SORT_COLUMNS[DEFAULT_SORT])
        capped = max(1, min(int(limit), MAX_LIMIT))
        sql = f"SELECT * FROM events WHERE {' AND '.join(clauses)} ORDER BY {order} LIMIT ? OFFSET ?"
        params.extend([capped, max(0, int(offset))])

        async with self.db.execute(sql, params) as cursor:
            rows = await cursor.fetchall()
        return [_row_to_event(row) for row in rows]

    async def count(self, session: SessionLike | None) -> int:
        """Number of events visible to the session. Handy for smoke tests."""
        where, params = visibility_sql(session)
        async with self.db.execute(f"SELECT COUNT(*) AS n FROM events WHERE {where}", params) as cursor:
            row = await cursor.fetchone()
        return int(row["n"]) if row else 0


def _clean_list(values: Iterable[str] | None) -> Sequence[str]:
    if not values:
        return []
    cleaned = [str(value).strip().lower() for value in values]
    return [value for value in cleaned if value]
