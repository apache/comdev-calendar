"""Serving the app from a sub-directory of a host.

The calendar normally sits at the root of its host, but a deployment can mount
it at, say, https://calendar.apache.org/calendar/ instead. Every route moves
under the prefix, and the served index.html gets a <base href> pointing at it so
one committed frontend build works either way.
"""

from __future__ import annotations

import pathlib
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio

from asfcalendar.app import APP_ID, create_app, set_base_href
from asfcalendar.config import Config, from_dict, normalise_base_path

from .conftest import cookie_payload

MOUNT = "/calendar"


@pytest.fixture
def mounted_config(tmp_path: pathlib.Path) -> Config:
    return from_dict(
        {
            "server": {"base_path": MOUNT, "base_url": "https://calendar.example.org/calendar"},
            "database": {"path": "calendar.sqlite3"},
            "app": {"frontend_dist": "dist", "title": "Test Calendar"},
        },
        root_dir=tmp_path,
    )


@pytest.fixture
def mounted_dist(mounted_config: Config) -> pathlib.Path:
    dist = mounted_config.frontend_dist_path
    dist.mkdir(parents=True, exist_ok=True)
    (dist / "index.html").write_text(
        '<!doctype html><html><head><base href="/" />'
        "<title>Calendar</title></head><body><div id=app></div></body></html>",
        encoding="utf-8",
    )
    (dist / "assets").mkdir(exist_ok=True)
    (dist / "assets" / "app.js").write_text("console.log('hi')", encoding="utf-8")
    return dist


@pytest_asyncio.fixture
async def mounted_client(mounted_config: Config) -> AsyncIterator[Any]:
    app = create_app(config=mounted_config, testing=True, token_file=None)
    async with app.test_app() as running:
        yield running.test_client()


class TestConfig:
    @pytest.mark.parametrize(
        ("given", "expected"),
        [
            ("", ""),
            ("/", ""),
            ("calendar", "/calendar"),
            ("/calendar", "/calendar"),
            ("/calendar/", "/calendar"),
            ("  /calendar/  ", "/calendar"),
            ("tools/calendar", "/tools/calendar"),
            ("//calendar//", "/calendar"),
        ],
    )
    def test_normalising_a_mount_point(self, given: str, expected: str) -> None:
        assert normalise_base_path(given) == expected

    @pytest.mark.parametrize("given", ["/has space", "/query?bits", "/frag#ment", "/a//b"])
    def test_rubbish_is_refused(self, given: str) -> None:
        with pytest.raises(ValueError, match="base_path"):
            normalise_base_path(given)

    def test_the_config_normalises_on_the_way_in(self) -> None:
        cfg = from_dict({"server": {"base_path": "calendar/"}})
        assert cfg.base_path == "/calendar"

    def test_url_path_at_the_root(self) -> None:
        cfg = from_dict({})
        assert cfg.base_path == ""
        assert cfg.url_path("/") == "/"
        assert cfg.url_path("/api") == "/api"
        assert cfg.url_path("auth") == "/auth"

    def test_url_path_when_mounted(self) -> None:
        cfg = from_dict({"server": {"base_path": MOUNT}})
        assert cfg.url_path("/") == "/calendar/"
        assert cfg.url_path("/api") == "/calendar/api"
        assert cfg.url_path("auth") == "/calendar/auth"

    def test_shortlinks_carry_the_mount_point(self) -> None:
        cfg = from_dict({"server": {"base_path": MOUNT}})
        assert cfg.shortlink_path("AbCd2345") == "/calendar/e/AbCd2345"
        assert cfg.shortlink_url("AbCd2345", "http://localhost:8080/") == "http://localhost:8080/calendar/e/AbCd2345"


class TestBaseHref:
    def test_the_tag_is_rewritten_in_place(self) -> None:
        document = '<html><head><base href="/" /><title>x</title></head></html>'
        assert '<base href="/calendar/">' in set_base_href(document, MOUNT)
        assert '<base href="/" />' not in set_base_href(document, MOUNT)

    def test_the_root_deployment_gets_a_plain_slash(self) -> None:
        document = '<html><head><base href="/calendar/"></head></html>'
        assert '<base href="/">' in set_base_href(document, "")

    def test_a_document_without_the_tag_has_one_added(self) -> None:
        result = set_base_href("<html><head><title>x</title></head></html>", MOUNT)
        assert '<base href="/calendar/">' in result
        assert result.index("<base") < result.index("<title>")

    def test_a_document_without_a_head_is_left_alone(self) -> None:
        assert set_base_href("<p>hi</p>", MOUNT) == "<p>hi</p>"

    def test_only_the_first_tag_is_touched(self) -> None:
        document = '<html><head><base href="/"></head><body>&lt;base href="/"&gt;</body></html>'
        assert set_base_href(document, MOUNT).count('<base href="/calendar/">') == 1

    def test_the_value_is_escaped(self) -> None:
        # normalise_base_path rejects a value like this, so it should never get
        # here; the escaping is what stops a bad config becoming injected markup.
        result = set_base_href('<html><head><base href="/"></head></html>', '/a"b')
        assert '<base href="/a&quot;b/">' in result


class TestRoutes:
    async def test_the_home_page_is_under_the_prefix(self, mounted_client: Any, mounted_dist: pathlib.Path) -> None:
        response = await mounted_client.get(f"{MOUNT}/")
        assert response.status_code == 200
        assert "<div id=app>" in (await response.get_data()).decode()

    async def test_the_served_page_points_at_the_mount_point(
        self, mounted_client: Any, mounted_dist: pathlib.Path
    ) -> None:
        body = (await (await mounted_client.get(f"{MOUNT}/")).get_data()).decode()
        assert '<base href="/calendar/">' in body

    async def test_the_api_moves_too(self, mounted_client: Any) -> None:
        assert (await mounted_client.get(f"{MOUNT}/api/healthz")).status_code == 200
        assert (await mounted_client.get(f"{MOUNT}/api/events")).status_code == 200
        assert (await mounted_client.get(f"{MOUNT}/api/calendars")).status_code == 200

    async def test_static_files_move_too(self, mounted_client: Any, mounted_dist: pathlib.Path) -> None:
        response = await mounted_client.get(f"{MOUNT}/assets/app.js")
        assert response.status_code == 200
        assert b"console.log" in await response.get_data()

    async def test_client_side_routes_still_fall_back_to_the_app(
        self, mounted_client: Any, mounted_dist: pathlib.Path
    ) -> None:
        response = await mounted_client.get(f"{MOUNT}/month/2026-01")
        assert response.status_code == 200
        assert "<div id=app>" in (await response.get_data()).decode()

    async def test_the_oauth_endpoint_moves_too(self, mounted_client: Any) -> None:
        response = await mounted_client.get(f"{MOUNT}/auth?login={MOUNT}/")
        assert response.status_code == 302
        assert "oauth.apache.org" in response.headers["Location"]

    async def test_the_login_url_handed_to_the_frontend_is_prefixed(self, mounted_client: Any) -> None:
        body = await (await mounted_client.get(f"{MOUNT}/api/session")).get_json()
        assert body["login_url"] == "/calendar/auth?login=/calendar/"

    async def test_an_unknown_api_route_under_the_prefix_is_json(self, mounted_client: Any) -> None:
        response = await mounted_client.get(f"{MOUNT}/api/nope")
        assert response.status_code == 404
        assert response.headers["Content-Type"].startswith("application/json")

    async def test_the_rules_are_registered_under_the_prefix(self, mounted_config: Config) -> None:
        app = create_app(config=mounted_config, testing=True, token_file=None)
        rules = {rule.rule for rule in app.url_map.iter_rules()}
        assert "/calendar/api/events" in rules
        assert "/calendar/e/<token>" in rules
        assert "/calendar/auth" in rules
        assert "/api/events" not in rules


class TestOffTheMountPoint:
    """A reverse proxy that strips the prefix is the usual cause. Say so."""

    async def test_the_bare_root_redirects_to_the_app(self, mounted_client: Any) -> None:
        response = await mounted_client.get("/")
        assert response.status_code == 302
        assert response.headers["Location"] == "/calendar/"

    async def test_other_paths_explain_themselves(self, mounted_client: Any) -> None:
        response = await mounted_client.get("/api/healthz")
        assert response.status_code == 404
        body = (await response.get_data()).decode()
        assert "/calendar/" in body
        assert "ProxyPass" in body

    async def test_a_sibling_directory_is_not_mistaken_for_the_app(self, mounted_client: Any) -> None:
        response = await mounted_client.get("/calendarium/help")
        assert response.status_code == 404
        assert "ProxyPass" in (await response.get_data()).decode()


class TestShortlinks:
    async def _create(self, client: Any) -> dict[str, Any]:
        async with client.session_transaction() as session:
            session[APP_ID] = cookie_payload("carol")
        response = await client.post(
            f"{MOUNT}/api/events",
            json={"title": "Mounted", "category": "foundation", "start": "2026-01-01T00:00:00Z"},
        )
        assert response.status_code == 201
        return dict((await response.get_json())["event"])

    async def test_the_shortlink_url_carries_the_prefix(self, mounted_client: Any) -> None:
        event = await self._create(mounted_client)
        assert event["shortlink_url"].endswith(f"/calendar/e/{event['shortlink']}")

    async def test_the_shortlink_page_is_under_the_prefix(
        self, mounted_client: Any, mounted_dist: pathlib.Path
    ) -> None:
        event = await self._create(mounted_client)
        response = await mounted_client.get(f"{MOUNT}/e/{event['shortlink']}")
        assert response.status_code == 200
        body = (await response.get_data()).decode()
        assert '<base href="/calendar/">' in body
        assert f'og:url" content="https://calendar.example.org/calendar/e/{event["shortlink"]}"' in body

    async def test_the_unprefixed_shortlink_does_not_resolve(self, mounted_client: Any) -> None:
        event = await self._create(mounted_client)
        assert (await mounted_client.get(f"/e/{event['shortlink']}")).status_code == 404


class TestRootDeploymentIsUnchanged:
    async def test_routes_stay_where_they_were(self, client: Any) -> None:
        assert (await client.get("/api/healthz")).status_code == 200
        body = await (await client.get("/api/session")).get_json()
        assert body["login_url"] == "/auth?login=/"

    async def test_the_page_says_the_root(self, client: Any, dist_dir: pathlib.Path) -> None:
        body = (await (await client.get("/")).get_data()).decode()
        assert '<base href="/">' in body
