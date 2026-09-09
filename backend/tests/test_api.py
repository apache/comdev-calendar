"""End-to-end tests against the HTTP API, using the Quart test client."""

from __future__ import annotations

from typing import Any

import pytest

HOUR = 3600
JAN_1 = "2026-01-01T00:00:00Z"


async def post_event(client: Any, **fields: Any) -> Any:
    body = {"title": "An event", "category": "project", "project": "httpd", "start": JAN_1}
    body.update(fields)
    return await client.post("/api/events", json=body)


async def json_of(response: Any) -> Any:
    return await response.get_json()


class TestSessionEndpoint:
    async def test_anonymous(self, client: Any) -> None:
        response = await client.get("/api/session")
        assert response.status_code == 200
        body = await json_of(response)
        assert body["authenticated"] is False
        assert body["login_url"].startswith("/auth?login=")

    async def test_logged_in(self, client: Any, login: Any) -> None:
        await login("carol")
        body = await json_of(await client.get("/api/session"))
        assert body["authenticated"] is True
        assert body["uid"] == "carol"
        assert body["is_member"] is True
        assert body["committees"] == ["tomcat"]

    async def test_health(self, client: Any) -> None:
        body = await json_of(await client.get("/api/healthz"))
        assert body["status"] == "ok"


class TestCalendarsEndpoint:
    async def test_anonymous(self, client: Any) -> None:
        body = await json_of(await client.get("/api/calendars"))
        assert body["authenticated"] is False
        assert body["title"] == "Test Calendar"
        assert body["default_display_zone"] == "local"

    async def test_committer(self, client: Any, login: Any) -> None:
        await login("alice")
        body = await json_of(await client.get("/api/calendars"))
        assert body["can_create"]["project"] == ["httpd", "tomcat"]
        assert body["can_create"]["project_private"] == []
        assert body["can_create"]["foundation"] is False


class TestCreating:
    async def test_anonymous_cannot_create(self, client: Any) -> None:
        response = await post_event(client)
        assert response.status_code == 401
        assert "error" in await json_of(response)

    async def test_project_member_creates_a_public_event(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await post_event(client, title="Release party")
        assert response.status_code == 201
        event = (await json_of(response))["event"]
        assert event["title"] == "Release party"
        assert event["owner"] == "alice"
        assert event["visibility"] == "public"
        assert event["shortlink_url"].startswith("https://calendar.example.org/e/")

    async def test_a_non_member_cannot_create_for_a_project(self, client: Any, login: Any) -> None:
        await login("dave")
        response = await post_event(client, project="httpd")
        assert response.status_code == 403
        assert "httpd" in (await json_of(response))["error"]

    async def test_a_committer_cannot_create_a_private_project_event(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await post_event(client, project="httpd", visibility="private")
        assert response.status_code == 403
        assert "committee" in (await json_of(response))["error"]

    async def test_a_committee_member_can(self, client: Any, login: Any) -> None:
        await login("bob")
        response = await post_event(client, project="httpd", visibility="private")
        assert response.status_code == 201

    async def test_only_members_create_foundation_events(self, client: Any, login: Any) -> None:
        await login("alice")
        denied = await post_event(client, category="foundation", project=None)
        assert denied.status_code == 403

        await login("carol")
        allowed = await post_event(client, category="foundation", project=None)
        assert allowed.status_code == 201

    async def test_personal_events_are_private(self, client: Any, login: Any) -> None:
        await login("dave")
        response = await post_event(client, category="personal", project=None, visibility="public")
        assert response.status_code == 201
        assert (await json_of(response))["event"]["visibility"] == "private"

    @pytest.mark.parametrize(
        ("fields", "field"),
        [
            ({"title": ""}, "title"),
            ({"category": "nonsense"}, "category"),
            ({"start": "yesterday"}, "start"),
            ({"end": "2025-01-01T00:00:00Z"}, "end"),
            ({"project": None}, "project"),
            ({"url": "ftp://example.org"}, "url"),
        ],
    )
    async def test_validation_errors_name_the_field(
        self, client: Any, login: Any, fields: dict[str, Any], field: str
    ) -> None:
        await login("alice")
        response = await post_event(client, **fields)
        assert response.status_code == 400
        assert (await json_of(response))["field"] == field

    async def test_a_junk_body_is_a_400(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/events", data="not json", headers={"Content-Type": "application/json"})
        assert response.status_code == 400


class TestTimezones:
    async def test_an_event_keeps_the_organisers_timezone(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await post_event(client, timezone="Europe/Berlin")
        assert response.status_code == 201
        assert (await json_of(response))["event"]["timezone"] == "Europe/Berlin"

    async def test_it_defaults_to_utc(self, client: Any, login: Any) -> None:
        await login("alice")
        assert (await json_of(await post_event(client)))["event"]["timezone"] == "UTC"

    async def test_an_unknown_zone_is_rejected(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await post_event(client, timezone="Mars/Olympus")
        assert response.status_code == 400
        assert (await json_of(response))["field"] == "timezone"

    async def test_the_ics_export_notes_the_zone(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client, timezone="Asia/Tokyo")))["event"]
        body = (await (await client.get(f"/api/events/{created['id']}.ics")).get_data()).decode()
        assert "X-ASF-EVENT-TIMEZONE:Asia/Tokyo" in body

    async def test_a_naive_start_is_read_in_the_events_timezone(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await post_event(
            client, start="2026-07-10T15:00:00", end="2026-07-10T16:00:00", timezone="Europe/Berlin"
        )
        assert response.status_code == 201
        event = (await json_of(response))["event"]
        assert event["start"] == "2026-07-10T13:00:00Z"
        assert event["timezone"] == "Europe/Berlin"

    async def test_editing_can_move_an_event_to_another_zone(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client, timezone="Europe/Berlin")))["event"]
        response = await client.put(
            f"/api/events/{created['id']}",
            json={
                "title": "Moved",
                "category": "project",
                "project": "httpd",
                "start": JAN_1,
                "timezone": "America/New_York",
            },
        )
        assert (await json_of(response))["event"]["timezone"] == "America/New_York"


class TestReading:
    async def _seed(self, client: Any, login: Any) -> dict[str, int]:
        ids: dict[str, int] = {}
        await login("bob")
        ids["httpd_public"] = (await json_of(await post_event(client, title="httpd public")))["event"]["id"]
        ids["httpd_private"] = (await json_of(await post_event(client, title="httpd private", visibility="private")))[
            "event"
        ]["id"]
        await login("carol")
        ids["fdn_public"] = (
            await json_of(await post_event(client, title="fdn public", category="foundation", project=None))
        )["event"]["id"]
        ids["fdn_private"] = (
            await json_of(
                await post_event(client, title="fdn private", category="foundation", project=None, visibility="private")
            )
        )["event"]["id"]
        ids["carol_personal"] = (
            await json_of(await post_event(client, title="carol personal", category="personal", project=None))
        )["event"]["id"]
        return ids

    async def test_anonymous_listing_shows_only_public_events(self, client: Any, login: Any) -> None:
        await self._seed(client, login)
        await login(None)
        body = await json_of(await client.get("/api/events"))
        assert {event["title"] for event in body["events"]} == {"httpd public", "fdn public"}
        assert body["count"] == 2

    async def test_a_committee_member_sees_their_private_project_events(self, client: Any, login: Any) -> None:
        await self._seed(client, login)
        await login("bob")
        body = await json_of(await client.get("/api/events"))
        assert {event["title"] for event in body["events"]} == {"httpd public", "httpd private", "fdn public"}

    async def test_a_member_sees_private_foundation_events_and_their_own(self, client: Any, login: Any) -> None:
        await self._seed(client, login)
        await login("carol")
        titles = {event["title"] for event in (await json_of(await client.get("/api/events")))["events"]}
        assert titles == {"httpd public", "fdn public", "fdn private", "carol personal"}

    async def test_personal_events_stay_personal(self, client: Any, login: Any) -> None:
        ids = await self._seed(client, login)
        await login("bob")
        response = await client.get(f"/api/events/{ids['carol_personal']}")
        assert response.status_code == 403

    async def test_fetching_a_hidden_event_anonymously_is_401(self, client: Any, login: Any) -> None:
        ids = await self._seed(client, login)
        await login(None)
        response = await client.get(f"/api/events/{ids['fdn_private']}")
        assert response.status_code == 401

    async def test_a_missing_event_is_404(self, client: Any) -> None:
        assert (await client.get("/api/events/424242")).status_code == 404

    async def test_range_filter(self, client: Any, login: Any) -> None:
        await login("alice")
        await post_event(client, title="January", start="2026-01-15T10:00:00Z")
        await post_event(client, title="March", start="2026-03-15T10:00:00Z")
        body = await json_of(await client.get("/api/events?start=2026-01-01T00:00:00Z&end=2026-02-01T00:00:00Z"))
        assert [event["title"] for event in body["events"]] == ["January"]

    async def test_category_and_project_filters(self, client: Any, login: Any) -> None:
        await self._seed(client, login)
        await login("carol")
        body = await json_of(await client.get("/api/events?category=foundation"))
        assert {event["title"] for event in body["events"]} == {"fdn public", "fdn private"}

        body = await json_of(await client.get("/api/events?categories=project,personal"))
        assert {event["title"] for event in body["events"]} == {"httpd public", "carol personal"}

    async def test_repeated_filter_parameters(self, client: Any, login: Any) -> None:
        await self._seed(client, login)
        await login("carol")
        body = await json_of(await client.get("/api/events?category=foundation&category=personal"))
        assert len(body["events"]) == 3

    async def test_owner_me(self, client: Any, login: Any) -> None:
        await self._seed(client, login)
        await login("carol")
        body = await json_of(await client.get("/api/events?owner=me"))
        assert {event["title"] for event in body["events"]} == {"fdn public", "fdn private", "carol personal"}

    async def test_owner_me_while_anonymous_returns_nothing(self, client: Any, login: Any) -> None:
        await self._seed(client, login)
        await login(None)
        assert (await json_of(await client.get("/api/events?owner=me")))["events"] == []

    async def test_search(self, client: Any, login: Any) -> None:
        await self._seed(client, login)
        await login(None)
        body = await json_of(await client.get("/api/events?q=public"))
        assert len(body["events"]) == 2

    @pytest.mark.parametrize("query", ["sort=nonsense", "visibility=maybe", "limit=lots", "start=whenever"])
    async def test_bad_query_parameters_are_400(self, client: Any, query: str) -> None:
        assert (await client.get(f"/api/events?{query}")).status_code == 400

    async def test_shortlink_lookup(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client, title="Findable")))["event"]
        await login(None)
        body = await json_of(await client.get(f"/api/shortlink/{created['shortlink']}"))
        assert body["event"]["title"] == "Findable"

    async def test_shortlink_lookup_respects_visibility(self, client: Any, login: Any) -> None:
        await login("bob")
        created = (await json_of(await post_event(client, visibility="private")))["event"]
        await login("alice")
        assert (await client.get(f"/api/shortlink/{created['shortlink']}")).status_code == 403

    async def test_an_unknown_shortlink_is_404(self, client: Any) -> None:
        assert (await client.get("/api/shortlink/AbCd2345")).status_code == 404
        assert (await client.get("/api/shortlink/not-a-token")).status_code == 404


class TestUpdating:
    async def test_a_project_member_may_edit_a_colleagues_event(self, client: Any, login: Any) -> None:
        await login("bob")
        created = (await json_of(await post_event(client, title="Original")))["event"]
        await login("alice")
        response = await client.put(
            f"/api/events/{created['id']}",
            json={"title": "Edited", "category": "project", "project": "httpd", "start": JAN_1},
        )
        assert response.status_code == 200
        event = (await json_of(response))["event"]
        assert event["title"] == "Edited"
        assert event["owner"] == "bob"  # ownership does not transfer
        assert event["shortlink"] == created["shortlink"]

    async def test_an_outsider_may_not_edit(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client)))["event"]
        await login("dave")
        response = await client.put(
            f"/api/events/{created['id']}",
            json={"title": "Hijacked", "category": "project", "project": "httpd", "start": JAN_1},
        )
        assert response.status_code == 403

    async def test_an_event_cannot_be_moved_into_a_calendar_you_cannot_write(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client)))["event"]
        response = await client.put(
            f"/api/events/{created['id']}",
            json={"title": "Now foundational", "category": "foundation", "start": JAN_1},
        )
        assert response.status_code == 403
        # ...and the event is untouched.
        assert (await json_of(await client.get(f"/api/events/{created['id']}")))["event"]["category"] == "project"

    async def test_an_event_cannot_be_moved_out_of_a_calendar_you_cannot_write(self, client: Any, login: Any) -> None:
        await login("carol")
        created = (await json_of(await post_event(client, category="foundation", project=None)))["event"]
        await login("alice")
        response = await client.put(
            f"/api/events/{created['id']}",
            json={"title": "Mine now", "category": "project", "project": "httpd", "start": JAN_1},
        )
        assert response.status_code == 403

    async def test_patch_works_the_same_way(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client)))["event"]
        response = await client.patch(
            f"/api/events/{created['id']}",
            json={"title": "Patched", "category": "project", "project": "httpd", "start": JAN_1},
        )
        assert response.status_code == 200

    async def test_editing_a_missing_event(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.put(
            "/api/events/999",
            json={"title": "Ghost", "category": "project", "project": "httpd", "start": JAN_1},
        )
        assert response.status_code == 404

    async def test_anonymous_edits_are_refused(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client)))["event"]
        await login(None)
        response = await client.put(f"/api/events/{created['id']}", json={"title": "x"})
        assert response.status_code == 401


class TestDeleting:
    async def test_a_project_member_may_delete(self, client: Any, login: Any) -> None:
        await login("bob")
        created = (await json_of(await post_event(client)))["event"]
        await login("alice")
        assert (await client.delete(f"/api/events/{created['id']}")).status_code == 200
        assert (await client.get(f"/api/events/{created['id']}")).status_code == 404

    async def test_an_outsider_may_not_delete(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client)))["event"]
        await login("dave")
        assert (await client.delete(f"/api/events/{created['id']}")).status_code == 403

    async def test_deleting_someone_elses_personal_event(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client, category="personal", project=None)))["event"]
        await login("bob")
        assert (await client.delete(f"/api/events/{created['id']}")).status_code == 403

    async def test_deleting_a_missing_event(self, client: Any, login: Any) -> None:
        await login("alice")
        assert (await client.delete("/api/events/999")).status_code == 404


class TestIcsExport:
    async def test_single_event(self, client: Any, login: Any) -> None:
        await login("alice")
        created = (await json_of(await post_event(client, title="Release party")))["event"]
        response = await client.get(f"/api/events/{created['id']}.ics")
        assert response.status_code == 200
        assert response.headers["Content-Type"].startswith("text/calendar")
        assert "attachment" in response.headers["Content-Disposition"]
        body = (await response.get_data()).decode()
        assert "BEGIN:VEVENT" in body
        assert "SUMMARY:Release party" in body

    async def test_the_feed_respects_visibility(self, client: Any, login: Any) -> None:
        await login("bob")
        await post_event(client, title="Public one")
        await post_event(client, title="Secret one", visibility="private")
        await login(None)
        body = (await (await client.get("/api/events.ics")).get_data()).decode()
        assert "Public one" in body
        assert "Secret one" not in body

    async def test_hidden_events_cannot_be_exported(self, client: Any, login: Any) -> None:
        await login("bob")
        created = (await json_of(await post_event(client, visibility="private")))["event"]
        await login("dave")
        assert (await client.get(f"/api/events/{created['id']}.ics")).status_code == 403


class TestApiErrorShape:
    async def test_unknown_api_routes_return_json(self, client: Any) -> None:
        response = await client.get("/api/nope")
        assert response.status_code == 404
        assert response.headers["Content-Type"].startswith("application/json")
        assert "error" in await json_of(response)

    async def test_api_errors_do_not_redirect_to_oauth(self, client: Any) -> None:
        # asfquart would normally bounce an unauthenticated browser to the
        # OAuth flow; API calls must get a JSON 401 instead.
        response = await post_event(client)
        assert response.status_code == 401
        assert response.headers["Content-Type"].startswith("application/json")
