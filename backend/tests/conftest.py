"""Shared fixtures.

Sessions are injected through the real Quart session cookie rather than by
monkeypatching, so the tests exercise the same code path asfquart uses in
production.
"""

from __future__ import annotations

import pathlib
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
import pytest_asyncio
from asfquart.session import ClientSession

from asfcalendar.app import APP_ID, create_app
from asfcalendar.config import Config, from_dict
from asfcalendar.storage import Storage

# Personas used throughout the suite. The keys match asfquart's raw session
# dict, where committees arrive as "pmcs".
PERSONAS: dict[str, dict[str, Any]] = {
    # A committer on httpd and tomcat, on no committee, not a member.
    "alice": {"uid": "alice", "fullname": "Alice", "projects": ["httpd", "tomcat"], "pmcs": []},
    # On the httpd committee (and therefore also a project member).
    "bob": {"uid": "bob", "fullname": "Bob", "projects": ["httpd"], "pmcs": ["httpd"]},
    # A foundation member who is also on the tomcat committee.
    "carol": {
        "uid": "carol",
        "fullname": "Carol",
        "projects": ["tomcat"],
        "pmcs": ["tomcat"],
        "isMember": True,
    },
    # A committer with no overlap with the others.
    "dave": {"uid": "dave", "fullname": "Dave", "projects": ["maven"], "pmcs": []},
}


def session_for(name: str) -> ClientSession:
    """A ClientSession for one of the personas above."""
    return ClientSession(dict(PERSONAS[name]))


def cookie_payload(name: str) -> dict[str, Any]:
    """The raw dict asfquart stores in the signed session cookie."""
    now = time.time()
    return {**PERSONAS[name], "cts": now, "uts": now}


@pytest.fixture
def config(tmp_path: pathlib.Path) -> Config:
    return from_dict(
        {
            "database": {"path": "calendar.sqlite3"},
            "app": {"frontend_dist": "dist", "title": "Test Calendar"},
            "server": {"base_url": "https://calendar.example.org"},
        },
        root_dir=tmp_path,
    )


@pytest_asyncio.fixture
async def store(config: Config) -> AsyncIterator[Storage]:
    storage = Storage(config.database_path)
    await storage.connect()
    try:
        yield storage
    finally:
        await storage.close()


@pytest.fixture
def app(config: Config) -> Any:
    return create_app(config=config, testing=True, token_file=None)


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncIterator[Any]:
    async with app.test_app() as running:
        yield running.test_client()


@pytest.fixture
def login(client: Any) -> Any:
    """Returns an async helper that puts a persona into the session cookie."""

    async def _login(name: str | None) -> None:
        async with client.session_transaction() as session:
            if name is None:
                session.pop(APP_ID, None)
            else:
                session[APP_ID] = cookie_payload(name)

    return _login


@pytest.fixture
def dist_dir(config: Config) -> Iterator[pathlib.Path]:
    """Creates a minimal frontend build so the static routes have something
    to serve."""
    dist = config.frontend_dist_path
    dist.mkdir(parents=True, exist_ok=True)
    (dist / "index.html").write_text(
        "<!doctype html><html><head><title>Calendar</title></head><body><div id=app></div></body></html>",
        encoding="utf-8",
    )
    (dist / "assets").mkdir(exist_ok=True)
    (dist / "assets" / "app.js").write_text("console.log('hi')", encoding="utf-8")
    yield dist
