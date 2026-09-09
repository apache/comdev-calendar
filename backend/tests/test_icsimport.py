"""Reading events out of an uploaded iCalendar file."""

from __future__ import annotations

import pytest

from asfcalendar.icsimport import (
    MAX_IMPORT_BYTES,
    UNTITLED,
    ImportCandidate,
    decode,
    parse,
)
from asfcalendar.models import (
    MAX_DESCRIPTION_LENGTH,
    MAX_TITLE_LENGTH,
    ValidationError,
    parse_event_payload,
    to_iso,
)


def calendar(*events: str) -> str:
    body = "\r\n".join(events)
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n{body}\r\nEND:VCALENDAR\r\n"


def event(**properties: str) -> str:
    lines = ["BEGIN:VEVENT"]
    lines.extend(f"{name.replace('_', '-')}:{value}" for name, value in properties.items())
    lines.append("END:VEVENT")
    return "\r\n".join(lines)


TIMED = event(UID="1@test", SUMMARY="Community call", DTSTART="20260710T090000Z", DTEND="20260710T100000Z")


def only(document: str) -> ImportCandidate:
    result = parse(document)
    assert len(result.candidates) == 1
    return result.candidates[0]


class TestDecoding:
    def test_plain_utf8(self) -> None:
        assert decode(b"BEGIN:VCALENDAR") == "BEGIN:VCALENDAR"

    def test_a_byte_order_mark_is_stripped(self) -> None:
        assert decode("BEGIN".encode("utf-8-sig")) == "BEGIN"
        assert decode("\ufeffBEGIN") == "BEGIN"

    def test_latin1_survives(self) -> None:
        # Not spec-compliant, but exporters do it.
        assert "\u00c5sa" in decode("SUMMARY:\u00c5sa".encode("latin-1"))

    def test_an_oversized_upload_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="import limit"):
            decode(b"x" * (MAX_IMPORT_BYTES + 1))


class TestRejectingRubbish:
    def test_something_that_is_not_a_calendar(self) -> None:
        with pytest.raises(ValidationError, match="iCalendar"):
            parse("hello, I am a text file")

    def test_a_calendar_with_no_events(self) -> None:
        with pytest.raises(ValidationError, match="No events"):
            parse(calendar())

    def test_a_calendar_of_nothing_but_unusable_entries(self) -> None:
        with pytest.raises(ValidationError, match="No events"):
            parse(calendar(event(UID="1@t", SUMMARY="No start time at all")))

    def test_more_events_than_the_limit(self) -> None:
        many = calendar(
            *[event(UID=f"{index}@t", SUMMARY=f"Event {index}", DTSTART="20260710T090000Z") for index in range(6)]
        )
        with pytest.raises(ValidationError, match="more than 5 events"):
            parse(many, max_events=5)

    def test_the_limit_itself_is_allowed(self) -> None:
        many = calendar(
            *[event(UID=f"{index}@t", SUMMARY=f"Event {index}", DTSTART="20260710T090000Z") for index in range(5)]
        )
        assert len(parse(many, max_events=5).candidates) == 5


class TestTimes:
    def test_a_zulu_timestamp(self) -> None:
        candidate = only(calendar(TIMED))
        assert to_iso(candidate.start) == "2026-07-10T09:00:00Z"
        assert to_iso(candidate.end) == "2026-07-10T10:00:00Z"
        assert candidate.all_day is False
        assert candidate.timezone == "UTC"

    def test_a_zone_is_kept_as_the_organisers_timezone(self) -> None:
        document = calendar(
            "BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:Berlin\r\n"
            "DTSTART;TZID=Europe/Berlin:20260710T150000\r\n"
            "DTEND;TZID=Europe/Berlin:20260710T160000\r\nEND:VEVENT"
        )
        candidate = only(document)
        assert candidate.timezone == "Europe/Berlin"
        # 15:00 in Berlin in July is 13:00 UTC.
        assert to_iso(candidate.start) == "2026-07-10T13:00:00Z"

    def test_an_all_day_event(self) -> None:
        document = calendar(
            "BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:ApacheCon\r\n"
            "DTSTART;VALUE=DATE:20260710\r\nDTEND;VALUE=DATE:20260713\r\nEND:VEVENT"
        )
        candidate = only(document)
        assert candidate.all_day is True
        assert to_iso(candidate.start) == "2026-07-10T00:00:00Z"
        assert to_iso(candidate.end) == "2026-07-13T00:00:00Z"
        assert candidate.timezone == "UTC"

    def test_a_duration_instead_of_an_end(self) -> None:
        document = calendar(event(UID="1@t", SUMMARY="Sync", DTSTART="20260710T090000Z", DURATION="PT90M"))
        assert only(document).end - only(document).start == 5400

    def test_no_end_at_all_gets_an_hour(self) -> None:
        document = calendar(event(UID="1@t", SUMMARY="Sync", DTSTART="20260710T090000Z"))
        assert only(document).end - only(document).start == 3600

    def test_an_all_day_event_with_no_end_gets_a_day(self) -> None:
        document = calendar("BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:x\r\nDTSTART;VALUE=DATE:20260710\r\nEND:VEVENT")
        assert only(document).end - only(document).start == 86400

    def test_a_floating_time_is_read_as_utc_and_says_so(self) -> None:
        document = calendar(event(UID="1@t", SUMMARY="Floating", DTSTART="20260710T090000"))
        candidate = only(document)
        assert to_iso(candidate.start) == "2026-07-10T09:00:00Z"
        assert any("no timezone" in warning for warning in candidate.warnings)

    def test_an_end_before_the_start_is_repaired(self) -> None:
        document = calendar(event(UID="1@t", SUMMARY="Backwards", DTSTART="20260710T100000Z", DTEND="20260710T090000Z"))
        candidate = only(document)
        assert candidate.end > candidate.start
        assert any("ended before it started" in warning for warning in candidate.warnings)


class TestFields:
    def test_the_ordinary_ones(self) -> None:
        document = calendar(
            event(
                UID="1@t",
                SUMMARY="Community call",
                DTSTART="20260710T090000Z",
                LOCATION="Room 3",
                DESCRIPTION="Agenda attached",
                URL="https://apache.org",
            )
        )
        candidate = only(document)
        assert candidate.title == "Community call"
        assert candidate.location == "Room 3"
        assert candidate.description == "Agenda attached"
        assert candidate.url == "https://apache.org"
        assert candidate.uid == "1@t"

    def test_escaped_text_is_unescaped(self) -> None:
        document = calendar(
            "BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:Tea\\, biscuits\r\n"
            "DESCRIPTION:Line one\\nLine two\r\nDTSTART:20260710T090000Z\r\nEND:VEVENT"
        )
        candidate = only(document)
        assert candidate.title == "Tea, biscuits"
        assert candidate.description == "Line one\nLine two"

    def test_folded_lines_are_joined(self) -> None:
        document = calendar(
            "BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:A title that was too long for one\r\n"
            "  line in the file\r\nDTSTART:20260710T090000Z\r\nEND:VEVENT"
        )
        assert only(document).title == "A title that was too long for one line in the file"

    def test_a_missing_title_gets_a_placeholder(self) -> None:
        document = calendar(event(UID="1@t", DTSTART="20260710T090000Z"))
        candidate = only(document)
        assert candidate.title == UNTITLED
        assert any("no title" in warning for warning in candidate.warnings)

    def test_an_overlong_title_is_trimmed_rather_than_rejected(self) -> None:
        document = calendar(event(UID="1@t", SUMMARY="x" * 500, DTSTART="20260710T090000Z"))
        candidate = only(document)
        assert len(candidate.title) <= MAX_TITLE_LENGTH
        assert any("cut short" in warning for warning in candidate.warnings)

    def test_an_overlong_description_is_trimmed_too(self) -> None:
        document = calendar(event(UID="1@t", SUMMARY="x", DTSTART="20260710T090000Z", DESCRIPTION="y" * 30000))
        assert len(only(document).description) <= MAX_DESCRIPTION_LENGTH

    def test_a_link_that_is_not_http_is_dropped(self) -> None:
        document = calendar(event(UID="1@t", SUMMARY="x", DTSTART="20260710T090000Z", URL="mailto:nobody@apache.org"))
        candidate = only(document)
        assert candidate.url == ""
        assert any("not http" in warning for warning in candidate.warnings)


class TestThingsThisCalendarCannotDo:
    def test_a_repeating_event_comes_in_once_and_says_so(self) -> None:
        document = calendar(event(UID="1@t", SUMMARY="Weekly", DTSTART="20260710T090000Z", RRULE="FREQ=WEEKLY;COUNT=5"))
        result = parse(document)
        assert len(result.candidates) == 1
        assert any("repeats" in warning for warning in result.candidates[0].warnings)

    def test_cancelled_events_are_left_out(self) -> None:
        document = calendar(
            TIMED,
            event(UID="2@t", SUMMARY="Called off", DTSTART="20260710T090000Z", STATUS="CANCELLED"),
        )
        result = parse(document)
        assert [candidate.title for candidate in result.candidates] == ["Community call"]
        assert any("Skipped 1 entry" in warning for warning in result.warnings)

    def test_entries_with_no_start_are_left_out(self) -> None:
        result = parse(calendar(TIMED, event(UID="2@t", SUMMARY="No start")))
        assert len(result.candidates) == 1
        assert any("Skipped 1 entry" in warning for warning in result.warnings)

    def test_several_skipped_entries_are_counted_together(self) -> None:
        result = parse(calendar(TIMED, event(UID="2@t", SUMMARY="a"), event(UID="3@t", SUMMARY="b")))
        assert any("Skipped 2 entries" in warning for warning in result.warnings)

    def test_a_todo_or_journal_is_not_an_event(self) -> None:
        document = (
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            "BEGIN:VTODO\r\nUID:1@t\r\nSUMMARY:Not an event\r\nEND:VTODO\r\n" + TIMED + "\r\nEND:VCALENDAR\r\n"
        )
        assert [candidate.title for candidate in parse(document).candidates] == ["Community call"]


class TestHandingOverToTheNormalValidation:
    """A candidate is only useful if the ordinary event validation accepts it."""

    def test_a_candidate_becomes_a_valid_payload(self) -> None:
        candidate = only(calendar(TIMED))
        payload = parse_event_payload(candidate.to_payload("project", "public", "httpd"))
        assert payload.title == "Community call"
        assert payload.category == "project"
        assert payload.project == "httpd"
        assert payload.visibility == "public"

    def test_every_candidate_from_an_awkward_file_still_validates(self) -> None:
        document = calendar(
            TIMED,
            event(UID="2@t", SUMMARY="x" * 500, DTSTART="20260710T090000Z"),
            event(UID="3@t", DTSTART="20260710T090000Z", URL="mailto:x@y"),
            "BEGIN:VEVENT\r\nUID:4@t\r\nSUMMARY:All day\r\nDTSTART;VALUE=DATE:20260710\r\nEND:VEVENT",
            event(UID="5@t", SUMMARY="Backwards", DTSTART="20260710T100000Z", DTEND="20260710T090000Z"),
        )
        for candidate in parse(document).candidates:
            parse_event_payload(candidate.to_payload("foundation", "private", None))

    def test_the_timezone_survives_into_the_payload(self) -> None:
        document = calendar(
            "BEGIN:VEVENT\r\nUID:1@t\r\nSUMMARY:Berlin\r\nDTSTART;TZID=Europe/Berlin:20260710T150000\r\nEND:VEVENT"
        )
        payload = parse_event_payload(only(document).to_payload("foundation", "public", None))
        assert payload.timezone == "Europe/Berlin"
        # The instant is unchanged by the round trip.
        assert to_iso(payload.start) == "2026-07-10T13:00:00Z"

    def test_the_preview_shape_is_what_the_ui_expects(self) -> None:
        as_json = only(calendar(TIMED)).to_json()
        assert set(as_json) == {
            "title",
            "start",
            "end",
            "all_day",
            "description",
            "location",
            "url",
            "timezone",
            "uid",
            "warnings",
        }
