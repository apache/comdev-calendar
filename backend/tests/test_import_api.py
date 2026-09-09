"""The import endpoints, over HTTP."""

from __future__ import annotations

import io
from typing import Any

import pytest
from werkzeug.datastructures import FileStorage

CALENDAR = (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n"
    "BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:Community call\r\n"
    "DTSTART;TZID=Europe/Berlin:20260710T150000\r\nDTEND;TZID=Europe/Berlin:20260710T160000\r\n"
    "LOCATION:Room 3\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nUID:2@t\r\nSUMMARY:ApacheCon\r\n"
    "DTSTART;VALUE=DATE:20260901\r\nDTEND;VALUE=DATE:20260904\r\nEND:VEVENT\r\n"
    "END:VCALENDAR\r\n"
)


def upload(content: str = CALENDAR, **fields: str) -> dict[str, Any]:
    """A multipart form the way a browser would send it.

    Spread into the call: ``await client.post(path, **upload(category="..."))``.
    """
    storage = FileStorage(
        stream=io.BytesIO(content.encode()),
        filename="calendar.ics",
        content_type="text/calendar",
    )
    return {"files": {"file": storage}, "form": dict(fields)}


async def json_of(response: Any) -> Any:
    return await response.get_json()


class TestPreview:
    async def test_it_needs_a_session(self, client: Any) -> None:
        response = await client.post("/api/import/preview", **upload())
        assert response.status_code == 401

    async def test_it_reads_the_file(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import/preview", **upload())
        assert response.status_code == 200
        body = await json_of(response)
        assert body["count"] == 2
        assert [event["title"] for event in body["events"]] == ["Community call", "ApacheCon"]

    async def test_it_shows_the_times_it_worked_out(self, client: Any, login: Any) -> None:
        await login("alice")
        body = await json_of(await client.post("/api/import/preview", **upload()))
        first = body["events"][0]
        assert first["start"] == "2026-07-10T13:00:00Z"
        assert first["timezone"] == "Europe/Berlin"
        assert first["location"] == "Room 3"
        assert body["events"][1]["all_day"] is True

    async def test_it_writes_nothing(self, client: Any, login: Any) -> None:
        await login("alice")
        await client.post("/api/import/preview", **upload())
        assert (await json_of(await client.get("/api/events")))["count"] == 0

    async def test_it_does_not_ask_which_calendar(self, client: Any, login: Any) -> None:
        # Choosing a calendar is the second step; a preview should work before
        # the reader has decided.
        await login("alice")
        assert (await client.post("/api/import/preview", **upload())).status_code == 200

    async def test_it_reports_what_it_had_to_change(self, client: Any, login: Any) -> None:
        await login("alice")
        document = (
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            "BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:Weekly\r\nDTSTART:20260710T090000Z\r\n"
            "RRULE:FREQ=WEEKLY;COUNT=5\r\nEND:VEVENT\r\n"
            "BEGIN:VEVENT\r\nUID:2@t\r\nSUMMARY:No start\r\nEND:VEVENT\r\n"
            "END:VCALENDAR\r\n"
        )
        body = await json_of(await client.post("/api/import/preview", **upload(document)))
        assert body["count"] == 1
        assert any("repeats" in warning for warning in body["events"][0]["warnings"])
        assert any("Skipped 1 entry" in warning for warning in body["warnings"])

    async def test_a_file_that_is_not_a_calendar(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import/preview", **upload("just some text"))
        assert response.status_code == 400
        assert (await json_of(response))["field"] == "file"

    async def test_a_missing_file_part(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import/preview", form={"category": "foundation"})
        assert response.status_code == 400
        assert "file" in (await json_of(response))["error"]

    async def test_the_raw_body_works_too(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import/preview", data=CALENDAR, headers={"Content-Type": "text/calendar"})
        assert response.status_code == 200
        assert (await json_of(response))["count"] == 2

    async def test_an_empty_body(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import/preview", data="", headers={"Content-Type": "text/calendar"})
        assert response.status_code == 400


class TestImporting:
    async def test_it_needs_a_session(self, client: Any) -> None:
        response = await client.post("/api/import", **upload(category="foundation"))
        assert response.status_code == 401

    async def test_it_creates_every_event_in_the_file(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import", **upload(category="project", project="httpd", visibility="public"))
        assert response.status_code == 201
        body = await json_of(response)
        assert body["count"] == 2
        assert {event["title"] for event in body["created"]} == {"Community call", "ApacheCon"}
        assert all(event["project"] == "httpd" for event in body["created"])
        assert all(event["owner"] == "alice" for event in body["created"])

        listed = await json_of(await client.get("/api/events"))
        assert listed["count"] == 2

    async def test_the_imported_events_keep_their_own_timezone(self, client: Any, login: Any) -> None:
        await login("alice")
        body = await json_of(await client.post("/api/import", **upload(category="project", project="httpd")))
        first = next(e for e in body["created"] if e["title"] == "Community call")
        assert first["timezone"] == "Europe/Berlin"
        assert first["start"] == "2026-07-10T13:00:00Z"

    async def test_each_event_gets_its_own_shortlink(self, client: Any, login: Any) -> None:
        await login("alice")
        body = await json_of(await client.post("/api/import", **upload(category="project", project="httpd")))
        tokens = {event["shortlink"] for event in body["created"]}
        assert len(tokens) == 2

    async def test_warnings_come_back_with_the_result(self, client: Any, login: Any) -> None:
        await login("alice")
        document = (
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            "BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:x\r\nDTSTART:20260710T090000Z\r\nEND:VEVENT\r\n"
            "BEGIN:VEVENT\r\nUID:2@t\r\nSUMMARY:No start\r\nEND:VEVENT\r\n"
            "END:VCALENDAR\r\n"
        )
        body = await json_of(await client.post("/api/import", **upload(document, category="project", project="httpd")))
        assert body["count"] == 1
        assert any("Skipped" in warning for warning in body["warnings"])


class TestWhereTheEventsLand:
    async def test_a_category_is_required(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import", **upload())
        assert response.status_code == 400
        assert (await json_of(response))["field"] == "category"

    async def test_an_unknown_category(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import", **upload(category="nonsense"))
        assert response.status_code == 400

    async def test_an_unknown_visibility(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import", **upload(category="project", project="httpd", visibility="maybe"))
        assert response.status_code == 400
        assert (await json_of(response))["field"] == "visibility"

    async def test_a_project_event_needs_a_project(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import", **upload(category="project"))
        assert response.status_code == 400
        assert (await json_of(response))["field"] == "project"

    async def test_settings_can_come_from_the_query_string(self, client: Any, login: Any) -> None:
        # Which is how a script piping the file into the body has to send them.
        await login("alice")
        response = await client.post(
            "/api/import?category=project&project=httpd",
            data=CALENDAR,
            headers={"Content-Type": "text/calendar"},
        )
        assert response.status_code == 201
        assert (await json_of(response))["count"] == 2

    async def test_visibility_defaults_the_same_way_a_single_event_does(self, client: Any, login: Any) -> None:
        await login("alice")
        body = await json_of(await client.post("/api/import", **upload(category="project", project="httpd")))
        assert all(event["visibility"] == "public" for event in body["created"])

    async def test_personal_events_are_forced_private(self, client: Any, login: Any) -> None:
        await login("dave")
        body = await json_of(await client.post("/api/import", **upload(category="personal", visibility="public")))
        assert all(event["visibility"] == "private" for event in body["created"])


class TestPermissions:
    async def test_you_cannot_import_into_a_project_you_are_not_in(self, client: Any, login: Any) -> None:
        await login("dave")
        response = await client.post("/api/import", **upload(category="project", project="httpd"))
        assert response.status_code == 403
        assert "httpd" in (await json_of(response))["error"]

    async def test_a_committer_cannot_import_private_project_events(self, client: Any, login: Any) -> None:
        await login("alice")
        response = await client.post("/api/import", **upload(category="project", project="httpd", visibility="private"))
        assert response.status_code == 403
        assert "committee" in (await json_of(response))["error"]

    async def test_a_committee_member_can(self, client: Any, login: Any) -> None:
        await login("bob")
        response = await client.post("/api/import", **upload(category="project", project="httpd", visibility="private"))
        assert response.status_code == 201

    async def test_only_members_can_import_foundation_events(self, client: Any, login: Any) -> None:
        await login("alice")
        assert (await client.post("/api/import", **upload(category="foundation"))).status_code == 403
        await login("carol")
        assert (await client.post("/api/import", **upload(category="foundation"))).status_code == 201

    async def test_a_refused_import_writes_nothing(self, client: Any, login: Any) -> None:
        await login("dave")
        await client.post("/api/import", **upload(category="project", project="httpd"))
        await login("bob")
        assert (await json_of(await client.get("/api/events")))["count"] == 0


class TestItIsAllOrNothing:
    async def test_a_file_with_one_bad_entry_imports_nothing(self, client: Any, login: Any) -> None:
        # The parser repairs what it can, so reaching the validation step with a
        # bad entry takes something it cannot fix: an event lasting over a year.
        await login("alice")
        document = (
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            "BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:Fine\r\nDTSTART:20260710T090000Z\r\nEND:VEVENT\r\n"
            "BEGIN:VEVENT\r\nUID:2@t\r\nSUMMARY:Endless\r\n"
            "DTSTART:20260710T090000Z\r\nDTEND:20300710T090000Z\r\nEND:VEVENT\r\n"
            "END:VCALENDAR\r\n"
        )
        response = await client.post("/api/import", **upload(document, category="project", project="httpd"))
        assert response.status_code == 400
        assert (await json_of(await client.get("/api/events")))["count"] == 0


class TestSize:
    async def test_an_oversized_upload_is_refused(self, client: Any, login: Any) -> None:
        await login("alice")
        giant = "BEGIN:VCALENDAR\r\n" + ("X-PADDING:" + "y" * 200 + "\r\n") * 8000 + "END:VCALENDAR\r\n"
        response = await client.post("/api/import/preview", data=giant, headers={"Content-Type": "text/calendar"})
        assert response.status_code in {400, 413}
        body = await json_of(response)
        assert "limit" in body["error"].lower()


@pytest.mark.parametrize("path", ["/api/import", "/api/import/preview"])
class TestBothEndpoints:
    async def test_they_answer_in_json(self, client: Any, path: str) -> None:
        response = await client.post(path, **upload(category="foundation"))
        assert response.headers["Content-Type"].startswith("application/json")

    async def test_they_do_not_redirect_an_anonymous_caller(self, client: Any, path: str) -> None:
        response = await client.post(path, **upload(category="foundation"))
        assert response.status_code == 401
