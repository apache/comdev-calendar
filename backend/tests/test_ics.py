"""iCalendar rendering."""

from __future__ import annotations

from asfcalendar import ics
from asfcalendar.models import Event

JAN_1 = 1767225600


def make_event(**overrides: object) -> Event:
    fields: dict[str, object] = {
        "id": 1,
        "shortlink": "AbCd2345",
        "title": "Board meeting",
        "category": "foundation",
        "visibility": "public",
        "start": JAN_1,
        "end": JAN_1 + 3600,
        "all_day": False,
        "description": "",
        "location": "",
        "url": "",
        "project": None,
        "timezone": "UTC",
        "owner": "carol",
        "created_at": JAN_1,
        "updated_at": JAN_1,
    }
    fields.update(overrides)
    return Event(**fields)  # type: ignore[arg-type]


def test_escaping() -> None:
    assert ics.escape("a;b") == r"a\;b"
    assert ics.escape("a,b") == "a\\,b"
    assert ics.escape("a\\b") == "a\\\\b"
    assert ics.escape("line1\nline2") == "line1\\nline2"
    assert ics.escape("line1\r\nline2") == "line1\\nline2"


def test_short_lines_are_left_alone() -> None:
    assert ics.fold("SUMMARY:hello") == "SUMMARY:hello"


def test_long_lines_are_folded_to_75_octets() -> None:
    folded = ics.fold("SUMMARY:" + "x" * 200)
    pieces = folded.split("\r\n")
    assert len(pieces) > 1
    assert len(pieces[0].encode()) <= 75
    for piece in pieces[1:]:
        assert piece.startswith(" ")
        assert len(piece.encode()) <= 75
    assert "".join([pieces[0], *[p[1:] for p in pieces[1:]]]) == "SUMMARY:" + "x" * 200


def test_folding_does_not_split_multibyte_characters() -> None:
    folded = ics.fold("SUMMARY:" + "æ" * 100)
    for piece in folded.split("\r\n"):
        assert len(piece.encode()) <= 75
        piece.encode("utf-8").decode("utf-8")  # would raise on a split codepoint


def test_calendar_envelope() -> None:
    body = ics.render([make_event()], name="My Calendar")
    assert body.startswith("BEGIN:VCALENDAR\r\n")
    assert body.endswith("END:VCALENDAR\r\n")
    assert "VERSION:2.0" in body
    assert "X-WR-CALNAME:My Calendar" in body


def test_timed_event() -> None:
    body = ics.render([make_event(location="Room 3", description="Agenda")])
    assert "DTSTART:20260101T000000Z" in body
    assert "DTEND:20260101T010000Z" in body
    assert "LOCATION:Room 3" in body
    assert "DESCRIPTION:Agenda" in body
    assert "CLASS:PUBLIC" in body


def test_all_day_event_uses_dates() -> None:
    body = ics.render([make_event(all_day=True, end=JAN_1 + 86400)])
    assert "DTSTART;VALUE=DATE:20260101" in body
    assert "DTEND;VALUE=DATE:20260102" in body


def test_private_events_are_marked_private() -> None:
    assert "CLASS:PRIVATE" in ics.render([make_event(visibility="private")])


def test_categories_include_the_project() -> None:
    body = ics.render([make_event(category="project", project="httpd")])
    assert "CATEGORIES:project\\,httpd" in body


def test_shortlink_is_appended_to_the_description() -> None:
    body = ics.render([make_event(description="Agenda")], shortlinks={1: "https://example.org/e/AbCd2345"})
    assert "https://example.org/e/AbCd2345" in body
    assert "URL:https://example.org/e/AbCd2345" in body


def test_uid_is_stable_and_unique() -> None:
    first = ics.render([make_event(id=1, shortlink="AAAA2345")])
    second = ics.render([make_event(id=2, shortlink="BBBB2345")])
    assert "UID:event-1-AAAA2345@calendar.apache.org" in first
    assert "UID:event-2-BBBB2345@calendar.apache.org" in second


def test_several_events() -> None:
    body = ics.render([make_event(id=1), make_event(id=2, title="Another")])
    assert body.count("BEGIN:VEVENT") == 2
    assert body.count("END:VEVENT") == 2


def test_an_empty_calendar_is_still_valid() -> None:
    body = ics.render([])
    assert "BEGIN:VEVENT" not in body
    assert "END:VCALENDAR" in body


def test_every_line_ends_with_crlf() -> None:
    body = ics.render([make_event(description="A really long description " * 10)])
    for line in body.split("\r\n"):
        assert "\n" not in line


def test_the_organisers_timezone_is_recorded() -> None:
    body = ics.render([make_event(timezone="Europe/Berlin")])
    # The times themselves stay in UTC so every client reads them correctly.
    assert "DTSTART:20260101T000000Z" in body
    assert "X-ASF-EVENT-TIMEZONE:Europe/Berlin" in body


def test_a_utc_event_gets_no_extra_property() -> None:
    assert "X-ASF-EVENT-TIMEZONE" not in ics.render([make_event(timezone="UTC")])


def test_all_day_events_carry_no_timezone() -> None:
    body = ics.render([make_event(all_day=True, end=JAN_1 + 86400, timezone="Europe/Berlin")])
    assert "X-ASF-EVENT-TIMEZONE" not in body
