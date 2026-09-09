"""Application wiring: static files, the SPA fallback and shortlink pages."""

from __future__ import annotations

import pathlib
from typing import Any

from asfcalendar.app import IndexPage, create_app, inject_head, meta_tags, repository_root
from asfcalendar.config import Config
from asfcalendar.models import Event

JAN_1 = 1767225600


def an_event(**overrides: Any) -> Event:
    fields: dict[str, Any] = {
        "id": 1,
        "shortlink": "AbCd2345",
        "title": "Board <meeting>",
        "category": "foundation",
        "visibility": "public",
        "start": JAN_1,
        "end": JAN_1 + 3600,
        "all_day": False,
        "description": 'Quarterly "review"',
        "location": "",
        "url": "",
        "project": None,
        "timezone": "UTC",
        "owner": "carol",
        "created_at": JAN_1,
        "updated_at": JAN_1,
    }
    fields.update(overrides)
    return Event(**fields)


class TestHeadInjection:
    def test_tags_are_inserted_before_head_closes(self) -> None:
        document = "<html><head><title>x</title></head><body></body></html>"
        result = inject_head(document, "<meta name=test>")
        assert result.index("<meta name=test>") < result.index("</head>")

    def test_a_document_without_a_head_is_untouched(self) -> None:
        assert inject_head("<p>hi</p>", "<meta>") == "<p>hi</p>"

    def test_meta_tags_escape_their_content(self) -> None:
        tags = meta_tags(an_event(), "https://example.org/e/AbCd2345")
        assert "Board &lt;meeting&gt;" in tags
        assert "&quot;review&quot;" in tags
        assert "<meeting>" not in tags

    def test_long_descriptions_are_truncated(self) -> None:
        tags = meta_tags(an_event(description="x" * 1000), "https://example.org/e/x")
        assert "x" * 300 in tags
        assert "x" * 301 not in tags


class TestIndexPage:
    def test_missing_file(self, tmp_path: pathlib.Path) -> None:
        assert IndexPage(tmp_path).read() is None

    def test_reads_and_refreshes(self, tmp_path: pathlib.Path) -> None:
        target = tmp_path / "index.html"
        target.write_text("one", encoding="utf-8")
        page = IndexPage(tmp_path)
        assert page.read() == "one"
        target.write_text("two", encoding="utf-8")
        # Force a different mtime rather than sleeping.
        import os

        stat = target.stat()
        os.utime(target, (stat.st_atime, stat.st_mtime + 10))
        assert page.read() == "two"


class TestStaticServing:
    async def test_without_a_build_we_explain_ourselves(self, client: Any) -> None:
        response = await client.get("/")
        assert response.status_code == 503
        body = (await response.get_data()).decode()
        assert "npm run build" in body

    async def test_index_is_served(self, client: Any, dist_dir: pathlib.Path) -> None:
        response = await client.get("/")
        assert response.status_code == 200
        assert "<div id=app>" in (await response.get_data()).decode()

    async def test_assets_are_served(self, client: Any, dist_dir: pathlib.Path) -> None:
        response = await client.get("/assets/app.js")
        assert response.status_code == 200
        assert b"console.log" in await response.get_data()

    async def test_unknown_paths_fall_back_to_the_spa(self, client: Any, dist_dir: pathlib.Path) -> None:
        response = await client.get("/month/2026-01")
        assert response.status_code == 200
        assert "<div id=app>" in (await response.get_data()).decode()

    async def test_path_traversal_does_not_escape_the_build(self, client: Any, dist_dir: pathlib.Path) -> None:
        secret = dist_dir.parent / "config.yaml"
        secret.write_text("secret: yes\n", encoding="utf-8")
        response = await client.get("/../config.yaml")
        assert b"secret: yes" not in await response.get_data()

    async def test_unknown_api_paths_stay_json(self, client: Any, dist_dir: pathlib.Path) -> None:
        response = await client.get("/api/does-not-exist")
        assert response.status_code == 404
        assert response.headers["Content-Type"].startswith("application/json")


class TestShortlinkPage:
    async def _create(self, client: Any, login: Any, **fields: Any) -> dict[str, Any]:
        await login("carol")
        body = {"title": "Board meeting", "category": "foundation", "start": "2026-01-01T00:00:00Z"}
        body.update(fields)
        response = await client.post("/api/events", json=body)
        assert response.status_code == 201
        return dict((await response.get_json())["event"])

    async def test_a_public_event_gets_opengraph_tags(self, client: Any, login: Any, dist_dir: pathlib.Path) -> None:
        event = await self._create(client, login)
        response = await client.get(f"/e/{event['shortlink']}")
        assert response.status_code == 200
        body = (await response.get_data()).decode()
        assert 'og:title" content="Board meeting"' in body
        assert "https://calendar.example.org/e/" in body

    async def test_a_private_event_leaks_nothing_to_link_previews(
        self, client: Any, login: Any, dist_dir: pathlib.Path
    ) -> None:
        event = await self._create(client, login, title="Secret plans", visibility="private")
        response = await client.get(f"/e/{event['shortlink']}")
        assert response.status_code == 200
        body = (await response.get_data()).decode()
        assert "Secret plans" not in body
        assert "og:title" not in body

    async def test_an_unknown_shortlink_still_serves_the_app(self, client: Any, dist_dir: pathlib.Path) -> None:
        response = await client.get("/e/AbCd2345")
        assert response.status_code == 200
        assert "<div id=app>" in (await response.get_data()).decode()

    async def test_a_malformed_shortlink_is_a_404(self, client: Any, dist_dir: pathlib.Path) -> None:
        assert (await client.get("/e/not a token")).status_code == 404


class TestFactory:
    def test_repository_root_holds_the_config_example(self) -> None:
        assert (repository_root() / "config.yaml.example").is_file()

    def test_the_config_is_reachable_from_the_app(self, config: Config) -> None:
        app = create_app(config=config, testing=True, token_file=None)
        assert app.calendar_config is config
        assert app.calendar_storage.path == config.database_path

    def test_oauth_endpoint_is_registered(self, config: Config) -> None:
        app = create_app(config=config, testing=True, token_file=None)
        rules = {rule.rule for rule in app.url_map.iter_rules()}
        assert "/auth" in rules
        assert "/api/events" in rules
        assert "/e/<token>" in rules

    async def test_the_oauth_endpoint_reports_no_session(self, client: Any) -> None:
        response = await client.get("/auth")
        assert response.status_code == 404
        assert b"No active session" in await response.get_data()

    async def test_the_oauth_endpoint_starts_a_login(self, client: Any) -> None:
        response = await client.get("/auth?login=/")
        assert response.status_code == 302
        assert "oauth.apache.org" in response.headers["Location"]
