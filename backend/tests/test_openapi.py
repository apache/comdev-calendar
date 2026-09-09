"""The OpenAPI document, and the checks that keep it honest.

A hand-maintained API description rots. The tests here are the reason this one
should not: they compare the published document against the application's real
URL map and against the dataclass the API actually returns, so adding a route or
a field without describing it fails the build.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
from typing import Any

import pytest
import yaml
from openapi_spec_validator import validate as validate_spec

from asfcalendar import __version__, openapi
from asfcalendar.app import create_app
from asfcalendar.config import Config, from_dict
from asfcalendar.models import CATEGORIES, MAX_TITLE_LENGTH, VISIBILITIES, Event
from asfcalendar.storage import DEFAULT_SORT, MAX_LIMIT, SORT_COLUMNS

# Methods Quart adds by itself, which are not part of the described API.
IMPLICIT_METHODS = {"HEAD", "OPTIONS"}


@pytest.fixture
def document(config: Config) -> dict[str, Any]:
    return openapi.build(config)


def api_operations(app: Any, base_path: str = "") -> set[tuple[str, str]]:
    """Every (path, method) the application actually serves under /api."""
    prefix = f"{base_path}/api/"
    found: set[tuple[str, str]] = set()
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith(prefix):
            continue
        path = openapi.openapi_path(rule.rule[len(base_path) :] if base_path else rule.rule)
        for method in rule.methods or set():
            if method not in IMPLICIT_METHODS:
                found.add((path, method.lower()))
    return found


def documented_operations(document: dict[str, Any]) -> set[tuple[str, str]]:
    return {
        (path, method)
        for path, operations in document["paths"].items()
        for method in operations
        if method in {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
    }


class TestItIsAValidDocument:
    def test_it_passes_a_real_openapi_validator(self, document: dict[str, Any]) -> None:
        # The checks below are about this API in particular; this one is about
        # the document being OpenAPI at all, so that Swagger UI and any other
        # tool a consumer points at it will accept it.
        validate_spec(document)

    def test_it_is_still_valid_when_mounted_in_a_subdirectory(self, tmp_path: pathlib.Path) -> None:
        cfg = from_dict(
            {"server": {"base_url": "https://calendar.apache.org", "base_path": "/calendar"}},
            root_dir=tmp_path,
        )
        validate_spec(openapi.build(cfg))

    def test_it_is_still_valid_with_no_configured_origin(self, tmp_path: pathlib.Path) -> None:
        validate_spec(openapi.build(from_dict({}, root_dir=tmp_path)))

    def test_top_level_shape(self, document: dict[str, Any]) -> None:
        assert document["openapi"].startswith("3.")
        assert set(document) >= {"openapi", "info", "servers", "paths", "components"}

    def test_info(self, document: dict[str, Any]) -> None:
        assert document["info"]["version"] == __version__
        assert "Test Calendar" in document["info"]["title"]
        assert document["info"]["license"]["identifier"] == "Apache-2.0"
        assert len(document["info"]["description"]) > 200

    def test_every_operation_has_a_summary_and_at_least_one_response(self, document: dict[str, Any]) -> None:
        for path, operations in document["paths"].items():
            for method, operation in operations.items():
                where = f"{method.upper()} {path}"
                assert operation.get("summary"), f"{where} has no summary"
                assert operation.get("responses"), f"{where} has no responses"
                assert operation.get("tags"), f"{where} has no tag"

    def test_every_operation_uses_a_declared_tag(self, document: dict[str, Any]) -> None:
        declared = {tag["name"] for tag in document["tags"]}
        for operations in document["paths"].values():
            for operation in operations.values():
                assert set(operation["tags"]) <= declared

    def test_every_reference_resolves(self, document: dict[str, Any]) -> None:
        schemas = document["components"]["schemas"]

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                target = node.get("$ref")
                if isinstance(target, str):
                    assert target.startswith("#/components/schemas/"), target
                    assert target.rsplit("/", 1)[-1] in schemas, f"dangling {target}"
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(document)

    def test_no_schema_is_declared_and_never_used(self, document: dict[str, Any]) -> None:
        text = json.dumps(document["paths"])
        for name in document["components"]["schemas"]:
            referenced = f'#/components/schemas/{name}"' in text
            nested = f'#/components/schemas/{name}"' in json.dumps(document["components"]["schemas"])
            assert referenced or nested, f"{name} is described but never referenced"

    def test_it_survives_a_round_trip_through_json_and_yaml(self, document: dict[str, Any]) -> None:
        assert json.loads(json.dumps(document)) == document
        assert yaml.safe_load(yaml.safe_dump(document)) == document


class TestItMatchesTheRealApi:
    """The anti-drift checks. These are the point of the whole module."""

    def test_every_route_is_documented(self, config: Config, document: dict[str, Any]) -> None:
        app = create_app(config=config, testing=True, token_file=None)
        undocumented = api_operations(app) - documented_operations(document)
        assert not undocumented, "These endpoints exist but are missing from openapi.py: " + ", ".join(
            f"{method.upper()} {path}" for path, method in sorted(undocumented)
        )

    def test_nothing_is_documented_that_does_not_exist(self, config: Config, document: dict[str, Any]) -> None:
        app = create_app(config=config, testing=True, token_file=None)
        imaginary = documented_operations(document) - api_operations(app)
        assert not imaginary, "These endpoints are documented but not served: " + ", ".join(
            f"{method.upper()} {path}" for path, method in sorted(imaginary)
        )

    def test_the_check_works_when_the_app_is_mounted_in_a_subdirectory(self, tmp_path: pathlib.Path) -> None:
        cfg = from_dict({"server": {"base_path": "/calendar"}}, root_dir=tmp_path)
        app = create_app(config=cfg, testing=True, token_file=None)
        document = openapi.build(cfg)
        # Paths in the document stay mount-point free; the prefix lives in
        # `servers`, so the same document describes either deployment.
        assert api_operations(app, "/calendar") == documented_operations(document)
        assert all(path.startswith("/api/") for path in document["paths"])

    def test_the_event_schema_matches_what_the_api_returns(self, document: dict[str, Any]) -> None:
        event = Event(
            id=1,
            shortlink="AbCd2345",
            title="t",
            category="foundation",
            visibility="public",
            start=0,
            end=3600,
            all_day=False,
            description="",
            location="",
            url="",
            project=None,
            timezone="UTC",
            owner="carol",
            created_at=0,
            updated_at=0,
        )
        returned = set(event.to_json("https://example.org/e/AbCd2345"))
        described = set(document["components"]["schemas"]["Event"]["properties"])
        assert returned == described, (
            f"Event.to_json() and the Event schema disagree: "
            f"only in the API {returned - described}, only in the docs {described - returned}"
        )

    def test_the_schema_lists_every_dataclass_field_as_required(self, document: dict[str, Any]) -> None:
        required = set(document["components"]["schemas"]["Event"]["required"])
        assert {field.name for field in dataclasses.fields(Event)} <= required

    def test_the_writable_fields_are_a_subset_of_the_event(self, document: dict[str, Any]) -> None:
        schemas = document["components"]["schemas"]
        writable = set(schemas["EventInput"]["properties"])
        readable = set(schemas["Event"]["properties"])
        assert writable <= readable, writable - readable

    def test_read_only_fields_cannot_be_written(self, document: dict[str, Any]) -> None:
        schemas = document["components"]["schemas"]
        read_only = {name for name, schema in schemas["Event"]["properties"].items() if schema.get("readOnly")}
        assert read_only & set(schemas["EventInput"]["properties"]) == set()
        # The fields the API refuses to take from a client really are these.
        assert read_only == {"id", "shortlink", "shortlink_url", "owner", "created_at", "updated_at"}


class TestItTracksTheConstants:
    """Change a limit in the code and the published schema follows."""

    def test_categories_and_visibilities(self, document: dict[str, Any]) -> None:
        properties = document["components"]["schemas"]["Event"]["properties"]
        assert properties["category"]["enum"] == list(CATEGORIES)
        assert properties["visibility"]["enum"] == list(VISIBILITIES)

    def test_field_lengths(self, document: dict[str, Any]) -> None:
        properties = document["components"]["schemas"]["Event"]["properties"]
        assert properties["title"]["maxLength"] == MAX_TITLE_LENGTH

    def test_sort_keys_and_the_limit_cap(self, document: dict[str, Any]) -> None:
        parameters = {
            parameter["name"]: parameter for parameter in document["paths"]["/api/events"]["get"]["parameters"]
        }
        assert parameters["sort"]["schema"]["enum"] == sorted(SORT_COLUMNS)
        assert parameters["sort"]["schema"]["default"] == DEFAULT_SORT
        assert parameters["limit"]["schema"]["maximum"] == MAX_LIMIT

    def test_the_feed_takes_the_same_filters_as_the_listing(self, document: dict[str, Any]) -> None:
        listing = document["paths"]["/api/events"]["get"]["parameters"]
        feed = document["paths"]["/api/events.ics"]["get"]["parameters"]
        assert [parameter["name"] for parameter in listing] == [parameter["name"] for parameter in feed]

    def test_the_shortlink_pattern_accepts_a_real_token(self, document: dict[str, Any]) -> None:
        import re

        from asfcalendar import shortlink

        pattern = document["components"]["schemas"]["Event"]["properties"]["shortlink"]["pattern"]
        for _attempt in range(20):
            assert re.match(pattern, shortlink.generate())
        assert not re.match(pattern, "has space")


class TestServers:
    def test_it_advertises_the_configured_origin(self, tmp_path: pathlib.Path) -> None:
        cfg = from_dict({"server": {"base_url": "https://calendar.apache.org"}}, root_dir=tmp_path)
        assert openapi.build(cfg)["servers"][0]["url"] == "https://calendar.apache.org"

    def test_it_includes_the_mount_point(self, tmp_path: pathlib.Path) -> None:
        cfg = from_dict(
            {"server": {"base_url": "https://calendar.apache.org", "base_path": "/calendar"}},
            root_dir=tmp_path,
        )
        assert openapi.build(cfg)["servers"][0]["url"] == "https://calendar.apache.org/calendar"

    def test_it_falls_back_to_the_caller_host(self, tmp_path: pathlib.Path) -> None:
        cfg = from_dict({}, root_dir=tmp_path)
        assert openapi.build(cfg, origin="http://localhost:8080/")["servers"][0]["url"] == ("http://localhost:8080")

    def test_it_is_never_empty(self, tmp_path: pathlib.Path) -> None:
        cfg = from_dict({}, root_dir=tmp_path)
        assert openapi.build(cfg)["servers"][0]["url"] == "/"


class TestTheEndpoints:
    async def test_the_json_document_is_served(self, client: Any) -> None:
        response = await client.get("/api/openapi.json")
        assert response.status_code == 200
        assert response.headers["Content-Type"].startswith("application/json")
        body = await response.get_json()
        assert body["openapi"].startswith("3.")
        assert "/api/events" in body["paths"]

    async def test_the_yaml_document_is_served(self, client: Any) -> None:
        response = await client.get("/api/openapi.yaml")
        assert response.status_code == 200
        assert response.headers["Content-Type"].startswith("application/yaml")
        body = yaml.safe_load(await response.get_data())
        assert body["openapi"].startswith("3.")

    async def test_both_formats_describe_the_same_api(self, client: Any) -> None:
        as_json = await (await client.get("/api/openapi.json")).get_json()
        as_yaml = yaml.safe_load(await (await client.get("/api/openapi.yaml")).get_data())
        assert as_json == as_yaml

    async def test_it_needs_no_session(self, client: Any) -> None:
        # The docs page is public; an anonymous reader should be able to load it.
        assert (await client.get("/api/openapi.json")).status_code == 200

    async def test_the_server_url_follows_the_request(self, client: Any) -> None:
        body = await (await client.get("/api/openapi.json")).get_json()
        # The test client calls http://localhost, and base_url is set in the
        # fixture config, so the configured origin wins.
        assert body["servers"][0]["url"] == "https://calendar.example.org"

    async def test_what_is_served_validates_too(self, client: Any) -> None:
        # The document the tests build and the document a caller receives are
        # produced the same way, but only one of them is what anybody uses.
        validate_spec(await (await client.get("/api/openapi.json")).get_json())

    async def test_it_describes_itself(self, client: Any) -> None:
        body = await (await client.get("/api/openapi.json")).get_json()
        assert "/api/openapi.json" in body["paths"]
        assert "/api/openapi.yaml" in body["paths"]
