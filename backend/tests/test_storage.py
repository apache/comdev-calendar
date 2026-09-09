"""Storage layer: CRUD, range queries and the SQL visibility filter."""

from __future__ import annotations

import itertools
import pathlib
import sqlite3

import pytest

from asfcalendar.models import Category, EventInput, Visibility
from asfcalendar.permissions import can_view
from asfcalendar.storage import Storage, visibility_sql

from .conftest import session_for

HOUR = 3600
DAY = 86400
JAN_1 = 1767225600  # 2026-01-01T00:00:00Z


def an_event(
    title: str = "Event",
    category: Category = "project",
    visibility: Visibility = "public",
    project: str | None = "httpd",
    start: int = JAN_1,
    length: int = HOUR,
    **extra: object,
) -> EventInput:
    return EventInput(
        title=title,
        category=category,
        visibility=visibility,
        start=start,
        end=start + length,
        all_day=bool(extra.get("all_day", False)),
        description=str(extra.get("description", "")),
        location=str(extra.get("location", "")),
        url=str(extra.get("url", "")),
        project=project,
    )


class TestCrud:
    async def test_create_and_read_back(self, store: Storage) -> None:
        created = await store.create(an_event(title="Release party"), "alice")
        assert created.id > 0
        assert created.owner == "alice"
        assert len(created.shortlink) == 8
        assert created.created_at == created.updated_at

        fetched = await store.get(created.id)
        assert fetched == created

    async def test_lookup_by_shortlink(self, store: Storage) -> None:
        created = await store.create(an_event(), "alice")
        assert await store.get_by_shortlink(created.shortlink) == created
        assert await store.get_by_shortlink("AbCd2345") is None

    async def test_an_invalid_shortlink_never_hits_the_database(self, store: Storage) -> None:
        assert await store.get_by_shortlink("nope/../etc") is None

    async def test_shortlinks_are_unique(self, store: Storage) -> None:
        tokens = {(await store.create(an_event(), "alice")).shortlink for _ in range(50)}
        assert len(tokens) == 50

    async def test_update_changes_fields_but_not_identity(self, store: Storage) -> None:
        created = await store.create(an_event(title="Before"), "alice")
        updated = await store.update(created.id, an_event(title="After", project="tomcat"), now=created.created_at + 5)
        assert updated is not None
        assert updated.id == created.id
        assert updated.shortlink == created.shortlink
        assert updated.owner == "alice"
        assert updated.title == "After"
        assert updated.project == "tomcat"
        assert updated.updated_at > updated.created_at

    async def test_update_of_a_missing_event(self, store: Storage) -> None:
        assert await store.update(999, an_event()) is None

    async def test_delete(self, store: Storage) -> None:
        created = await store.create(an_event(), "alice")
        assert await store.delete(created.id) is True
        assert await store.get(created.id) is None
        assert await store.delete(created.id) is False

    async def test_an_owner_is_required(self, store: Storage) -> None:
        with pytest.raises(ValueError):
            await store.create(an_event(), "")

    async def test_using_storage_before_connecting(self, tmp_path: object) -> None:
        storage = Storage(":memory:")
        with pytest.raises(RuntimeError):
            _ = storage.db

    async def test_context_manager(self, config: object) -> None:
        async with Storage(":memory:") as storage:
            created = await storage.create(an_event(), "alice")
            assert created.id == 1


class TestRangeQueries:
    async def test_events_overlapping_the_window_are_returned(self, store: Storage) -> None:
        await store.create(an_event(title="before", start=JAN_1 - 5 * DAY), "alice")
        await store.create(an_event(title="inside", start=JAN_1 + HOUR), "alice")
        await store.create(an_event(title="straddling", start=JAN_1 - HOUR, length=3 * HOUR), "alice")
        await store.create(an_event(title="after", start=JAN_1 + 30 * DAY), "alice")

        found = await store.query(None, start=JAN_1, end=JAN_1 + DAY)
        assert {event.title for event in found} == {"inside", "straddling"}

    async def test_the_window_is_half_open(self, store: Storage) -> None:
        await store.create(an_event(title="ends at the boundary", start=JAN_1 - HOUR), "alice")
        await store.create(an_event(title="starts at the boundary", start=JAN_1), "alice")
        found = await store.query(None, start=JAN_1, end=JAN_1 + DAY)
        assert {event.title for event in found} == {"starts at the boundary"}

    async def test_open_ended_windows(self, store: Storage) -> None:
        await store.create(an_event(title="old", start=JAN_1 - 100 * DAY), "alice")
        await store.create(an_event(title="new", start=JAN_1 + 100 * DAY), "alice")
        assert len(await store.query(None, start=JAN_1)) == 1
        assert len(await store.query(None, end=JAN_1)) == 1
        assert len(await store.query(None)) == 2


class TestFilters:
    async def _seed(self, store: Storage) -> None:
        await store.create(an_event(title="httpd public", project="httpd"), "alice")
        await store.create(an_event(title="httpd private", project="httpd", visibility="private"), "bob")
        await store.create(an_event(title="tomcat public", project="tomcat"), "alice")
        await store.create(an_event(title="fdn public", category="foundation", project=None), "carol")
        await store.create(
            an_event(title="fdn private", category="foundation", project=None, visibility="private"), "carol"
        )
        await store.create(
            an_event(title="alice personal", category="personal", project=None, visibility="private"), "alice"
        )

    async def test_by_category(self, store: Storage) -> None:
        await self._seed(store)
        found = await store.query(session_for("carol"), categories=["foundation"])
        assert {event.title for event in found} == {"fdn public", "fdn private"}

    async def test_by_project(self, store: Storage) -> None:
        await self._seed(store)
        found = await store.query(session_for("bob"), projects=["httpd"])
        assert {event.title for event in found} == {"httpd public", "httpd private"}

    async def test_by_visibility(self, store: Storage) -> None:
        await self._seed(store)
        found = await store.query(session_for("carol"), visibility="private")
        assert {event.title for event in found} == {"fdn private"}

    async def test_by_owner(self, store: Storage) -> None:
        await self._seed(store)
        found = await store.query(session_for("alice"), owner="alice")
        assert {event.title for event in found} == {"httpd public", "tomcat public", "alice personal"}

    async def test_full_text_search(self, store: Storage) -> None:
        await store.create(an_event(title="Board meeting", description="Quarterly review"), "alice")
        await store.create(an_event(title="Hackathon", location="Berlin"), "alice")
        assert len(await store.query(None, search="quarterly")) == 1
        assert len(await store.query(None, search="BERLIN")) == 1
        assert len(await store.query(None, search="httpd")) == 2  # matches the project column
        assert len(await store.query(None, search="nothing here")) == 0

    async def test_sorting(self, store: Storage) -> None:
        await store.create(an_event(title="Zebra", start=JAN_1 + DAY), "alice")
        await store.create(an_event(title="apple", start=JAN_1), "alice")
        assert [e.title for e in await store.query(None, sort="start")] == ["apple", "Zebra"]
        assert [e.title for e in await store.query(None, sort="-start")] == ["Zebra", "apple"]
        assert [e.title for e in await store.query(None, sort="title")] == ["apple", "Zebra"]
        assert [e.title for e in await store.query(None, sort="-title")] == ["Zebra", "apple"]

    async def test_an_unknown_sort_falls_back_to_the_default(self, store: Storage) -> None:
        await store.create(an_event(title="a", start=JAN_1 + DAY), "alice")
        await store.create(an_event(title="b", start=JAN_1), "alice")
        assert [e.title for e in await store.query(None, sort="nonsense")] == ["b", "a"]

    async def test_limit_and_offset(self, store: Storage) -> None:
        for index in range(5):
            await store.create(an_event(title=f"e{index}", start=JAN_1 + index * DAY), "alice")
        assert [e.title for e in await store.query(None, limit=2)] == ["e0", "e1"]
        assert [e.title for e in await store.query(None, limit=2, offset=2)] == ["e2", "e3"]

    async def test_limit_is_capped_and_floored(self, store: Storage) -> None:
        await store.create(an_event(), "alice")
        assert len(await store.query(None, limit=10_000_000)) == 1
        assert len(await store.query(None, limit=0)) == 1
        assert len(await store.query(None, offset=-5)) == 1


class TestVisibilityFilter:
    """The SQL prefilter must agree with permissions.can_view, always."""

    async def _seed_everything(self, store: Storage) -> None:
        categories: list[Category] = ["personal", "project", "foundation"]
        visibilities: list[Visibility] = ["public", "private"]
        for category, visibility, project, owner in itertools.product(
            categories, visibilities, ["httpd", "tomcat", "maven"], ["alice", "bob", "carol", "dave"]
        ):
            if category == "personal" and visibility == "public":
                continue
            await store.create(
                an_event(
                    title=f"{category}/{visibility}/{project}/{owner}",
                    category=category,
                    visibility=visibility,
                    project=project if category == "project" else None,
                ),
                owner,
            )

    @pytest.mark.parametrize("persona", [None, "alice", "bob", "carol", "dave"])
    async def test_sql_matches_can_view(self, store: Storage, persona: str | None) -> None:
        await self._seed_everything(store)
        session = None if persona is None else session_for(persona)

        returned = await store.query(session, limit=2000)
        # Nothing the session may not see comes back...
        assert all(can_view(event, session) for event in returned)

        # ...and nothing it may see is missing.
        everything = await store.query(session_for("carol"), limit=2000)
        all_rows = await store.query(None, limit=2000)
        seen_ids = {event.id for event in returned}
        for event in {event.id: event for event in [*everything, *all_rows]}.values():
            if can_view(event, session):
                assert event.id in seen_ids, f"{event.title} should be visible to {persona}"

    async def test_anonymous_sees_only_public(self, store: Storage) -> None:
        await self._seed_everything(store)
        for event in await store.query(None, limit=2000):
            assert event.visibility == "public"
            assert event.category in ("project", "foundation")

    async def test_count(self, store: Storage) -> None:
        await store.create(an_event(), "alice")
        await store.create(an_event(category="personal", project=None, visibility="private"), "alice")
        assert await store.count(None) == 1
        assert await store.count(session_for("alice")) == 2

    def test_the_clause_is_parameterised(self) -> None:
        clause, params = visibility_sql(session_for("bob"))
        assert clause.count("?") == len(params)
        assert "bob" in params
        assert "httpd" in params

    def test_anonymous_clause_takes_no_parameters(self) -> None:
        clause, params = visibility_sql(None)
        assert params == []
        assert "personal" not in clause


class TestTimezoneColumn:
    async def test_the_timezone_round_trips(self, store: Storage) -> None:
        created = await store.create(
            EventInput(
                title="Berlin sync",
                category="project",
                visibility="public",
                start=JAN_1,
                end=JAN_1 + HOUR,
                all_day=False,
                project="httpd",
                timezone="Europe/Berlin",
            ),
            "alice",
        )
        assert created.timezone == "Europe/Berlin"
        fetched = await store.get(created.id)
        assert fetched is not None
        assert fetched.timezone == "Europe/Berlin"

    async def test_it_defaults_to_utc(self, store: Storage) -> None:
        created = await store.create(an_event(), "alice")
        assert created.timezone == "UTC"

    async def test_an_update_can_change_it(self, store: Storage) -> None:
        created = await store.create(an_event(), "alice")
        updated = await store.update(
            created.id,
            EventInput(
                title="Moved",
                category="project",
                visibility="public",
                start=JAN_1,
                end=JAN_1 + HOUR,
                all_day=False,
                project="httpd",
                timezone="Asia/Tokyo",
            ),
        )
        assert updated is not None
        assert updated.timezone == "Asia/Tokyo"

    async def test_a_database_from_before_the_column_existed_is_upgraded(self, tmp_path: pathlib.Path) -> None:
        path = tmp_path / "old.sqlite3"
        # Build the pre-timezone schema by hand and put a row in it.
        connection = sqlite3.connect(path)
        connection.executescript(
            """
            CREATE TABLE events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shortlink TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                visibility TEXT NOT NULL,
                starts_at INTEGER NOT NULL,
                ends_at INTEGER NOT NULL,
                all_day INTEGER NOT NULL DEFAULT 0,
                description TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                project TEXT,
                owner TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            INSERT INTO events (shortlink, title, category, visibility, starts_at, ends_at,
                                owner, created_at, updated_at)
            VALUES ('AbCd2345', 'Legacy', 'foundation', 'public', 0, 3600, 'carol', 0, 0);
            """
        )
        connection.commit()
        connection.close()

        async with Storage(path) as storage:
            existing = await storage.get(1)
            assert existing is not None
            assert existing.title == "Legacy"
            assert existing.timezone == "UTC"
            # ...and new rows can still be written.
            created = await storage.create(an_event(), "alice")
            assert created.timezone == "UTC"
