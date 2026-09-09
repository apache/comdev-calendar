"""Payload validation and timestamp handling."""

from __future__ import annotations

import datetime
from typing import Any

import pytest

from asfcalendar.models import (
    DAY_SECONDS,
    Event,
    ValidationError,
    day_bounds,
    parse_event_payload,
    parse_timestamp,
    parse_timezone,
    to_iso,
)

JAN_1_2026 = 1767225600  # 2026-01-01T00:00:00Z


def payload(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "title": "Board meeting",
        "category": "foundation",
        "start": "2026-01-01T15:00:00Z",
        "end": "2026-01-01T17:00:00Z",
    }
    base.update(overrides)
    return base


class TestTimestamps:
    def test_iso_with_zulu(self) -> None:
        assert parse_timestamp("2026-01-01T00:00:00Z", "start") == JAN_1_2026

    def test_iso_with_offset(self) -> None:
        assert parse_timestamp("2026-01-01T01:00:00+01:00", "start") == JAN_1_2026

    def test_naive_iso_is_treated_as_utc(self) -> None:
        assert parse_timestamp("2026-01-01T00:00:00", "start") == JAN_1_2026

    def test_plain_date(self) -> None:
        assert parse_timestamp("2026-01-01", "start") == JAN_1_2026

    def test_epoch_seconds(self) -> None:
        assert parse_timestamp(JAN_1_2026, "start") == JAN_1_2026

    def test_round_trip(self) -> None:
        assert to_iso(JAN_1_2026) == "2026-01-01T00:00:00Z"

    @pytest.mark.parametrize("value", ["", "   ", "not a date", None, True, [], {}])
    def test_rubbish_is_refused(self, value: Any) -> None:
        with pytest.raises(ValidationError):
            parse_timestamp(value, "start")

    def test_day_bounds_span_exactly_one_day(self) -> None:
        start, end = day_bounds(JAN_1_2026 + 3600 * 13)
        assert start == JAN_1_2026
        assert end - start == DAY_SECONDS


class TestEventPayload:
    def test_minimal_payload(self) -> None:
        event = parse_event_payload(payload())
        assert event.title == "Board meeting"
        assert event.category == "foundation"
        assert event.visibility == "public"
        assert event.all_day is False
        assert event.end - event.start == 7200

    def test_missing_end_defaults_to_one_hour(self) -> None:
        event = parse_event_payload(payload(end=None))
        assert event.end - event.start == 3600

    def test_missing_end_on_an_all_day_event_is_one_day(self) -> None:
        event = parse_event_payload(payload(end=None, all_day=True))
        assert event.end - event.start == DAY_SECONDS

    def test_all_day_snaps_to_utc_day_boundaries(self) -> None:
        event = parse_event_payload(payload(start="2026-01-01T15:00:00Z", end="2026-01-02T09:00:00Z", all_day=True))
        assert to_iso(event.start) == "2026-01-01T00:00:00Z"
        assert to_iso(event.end) == "2026-01-03T00:00:00Z"

    def test_title_is_trimmed_and_required(self) -> None:
        assert parse_event_payload(payload(title="  spaced  ")).title == "spaced"
        with pytest.raises(ValidationError) as caught:
            parse_event_payload(payload(title="   "))
        assert caught.value.field == "title"

    def test_overlong_title(self) -> None:
        with pytest.raises(ValidationError):
            parse_event_payload(payload(title="x" * 500))

    def test_end_must_follow_start(self) -> None:
        with pytest.raises(ValidationError) as caught:
            parse_event_payload(payload(start="2026-01-02T00:00:00Z", end="2026-01-01T00:00:00Z"))
        assert caught.value.field == "end"

    def test_events_may_not_run_forever(self) -> None:
        with pytest.raises(ValidationError):
            parse_event_payload(payload(start="2026-01-01T00:00:00Z", end="2030-01-01T00:00:00Z"))

    def test_unknown_category(self) -> None:
        with pytest.raises(ValidationError) as caught:
            parse_event_payload(payload(category="secret"))
        assert caught.value.field == "category"

    def test_personal_events_are_forced_private(self) -> None:
        event = parse_event_payload(payload(category="personal", visibility="public"))
        assert event.visibility == "private"

    def test_project_events_need_a_project(self) -> None:
        with pytest.raises(ValidationError) as caught:
            parse_event_payload(payload(category="project"))
        assert caught.value.field == "project"

    def test_project_name_is_normalised(self) -> None:
        event = parse_event_payload(payload(category="project", project="  HTTPD "))
        assert event.project == "httpd"

    @pytest.mark.parametrize("name", ["Not A Project", "-leading", "x" * 80, "semi;colon"])
    def test_bad_project_names(self, name: str) -> None:
        with pytest.raises(ValidationError):
            parse_event_payload(payload(category="project", project=name))

    def test_project_may_not_be_set_on_other_categories(self) -> None:
        with pytest.raises(ValidationError) as caught:
            parse_event_payload(payload(category="foundation", project="httpd"))
        assert caught.value.field == "project"

    def test_url_must_be_http(self) -> None:
        with pytest.raises(ValidationError) as caught:
            parse_event_payload(payload(url="javascript:alert(1)"))
        assert caught.value.field == "url"
        assert parse_event_payload(payload(url="https://apache.org")).url == "https://apache.org"

    def test_all_day_must_be_boolean(self) -> None:
        with pytest.raises(ValidationError):
            parse_event_payload(payload(all_day="yes"))

    def test_body_must_be_an_object(self) -> None:
        with pytest.raises(ValidationError):
            parse_event_payload(["not", "an", "object"])


def test_event_to_json_shape() -> None:
    event = Event(
        id=7,
        shortlink="AbCd2345",
        title="Talk",
        category="project",
        visibility="public",
        start=JAN_1_2026,
        end=JAN_1_2026 + 3600,
        all_day=False,
        description="d",
        location="l",
        url="",
        project="httpd",
        timezone="Europe/Berlin",
        owner="alice",
        created_at=JAN_1_2026,
        updated_at=JAN_1_2026,
    )
    as_json = event.to_json("https://example.org/e/AbCd2345")
    assert as_json["start"] == "2026-01-01T00:00:00Z"
    assert as_json["shortlink_url"] == "https://example.org/e/AbCd2345"
    # Every field the frontend types expect must be present.
    expected = {
        "id",
        "shortlink",
        "title",
        "category",
        "visibility",
        "start",
        "end",
        "all_day",
        "description",
        "location",
        "url",
        "project",
        "timezone",
        "owner",
        "created_at",
        "updated_at",
        "shortlink_url",
    }
    assert expected == set(as_json)


def test_to_iso_matches_datetime() -> None:
    now = int(datetime.datetime.now(tz=datetime.UTC).timestamp())
    assert to_iso(now).endswith("Z")
    assert parse_timestamp(to_iso(now), "start") == now


class TestTimezones:
    def test_default_is_utc(self) -> None:
        assert parse_event_payload(payload()).timezone == "UTC"

    def test_an_iana_name_is_kept(self) -> None:
        assert parse_event_payload(payload(timezone="Europe/Berlin")).timezone == "Europe/Berlin"

    def test_surrounding_whitespace_is_trimmed(self) -> None:
        assert parse_event_payload(payload(timezone="  Asia/Tokyo ")).timezone == "Asia/Tokyo"

    @pytest.mark.parametrize("name", ["Mars/Olympus", "Not A Zone", "../../etc/passwd", "x" * 100])
    def test_an_unknown_zone_is_refused(self, name: str) -> None:
        with pytest.raises(ValidationError) as caught:
            parse_event_payload(payload(timezone=name))
        assert caught.value.field == "timezone"

    def test_a_non_string_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            parse_event_payload(payload(timezone=42))

    def test_an_empty_value_falls_back_to_utc(self) -> None:
        assert parse_event_payload(payload(timezone="")).timezone == "UTC"
        assert parse_event_payload(payload(timezone=None)).timezone == "UTC"

    def test_all_day_events_are_always_utc(self) -> None:
        # An all-day event is a date, not an instant, so an organiser timezone
        # would only be misleading.
        event = parse_event_payload(payload(all_day=True, timezone="Europe/Berlin"))
        assert event.timezone == "UTC"

    def test_parse_timezone_directly(self) -> None:
        assert parse_timezone("UTC") == "UTC"
        assert parse_timezone(None) == "UTC"
        with pytest.raises(ValidationError):
            parse_timezone("Nowhere/Special")


class TestNaiveTimestampsUseTheEventTimezone:
    """A timestamp with no offset is read in the event's own timezone."""

    def test_summer_time(self) -> None:
        event = parse_event_payload(
            payload(start="2026-07-10T15:00:00", end="2026-07-10T16:00:00", timezone="Europe/Berlin")
        )
        assert to_iso(event.start) == "2026-07-10T13:00:00Z"  # CEST is UTC+2

    def test_winter_time(self) -> None:
        event = parse_event_payload(
            payload(start="2026-01-10T15:00:00", end="2026-01-10T16:00:00", timezone="Europe/Berlin")
        )
        assert to_iso(event.start) == "2026-01-10T14:00:00Z"  # CET is UTC+1

    def test_a_zulu_timestamp_is_taken_at_face_value(self) -> None:
        event = parse_event_payload(
            payload(start="2026-07-10T15:00:00Z", end="2026-07-10T16:00:00Z", timezone="Europe/Berlin")
        )
        assert to_iso(event.start) == "2026-07-10T15:00:00Z"

    def test_an_explicit_offset_wins_over_the_timezone(self) -> None:
        event = parse_event_payload(
            payload(start="2026-07-10T15:00:00+09:00", end="2026-07-10T16:00:00+09:00", timezone="Europe/Berlin")
        )
        assert to_iso(event.start) == "2026-07-10T06:00:00Z"

    def test_without_a_timezone_naive_still_means_utc(self) -> None:
        event = parse_event_payload(payload(start="2026-07-10T15:00:00", end="2026-07-10T16:00:00"))
        assert to_iso(event.start) == "2026-07-10T15:00:00Z"

    def test_the_end_is_read_in_the_same_zone(self) -> None:
        event = parse_event_payload(
            payload(start="2026-07-10T15:00:00", end="2026-07-10T17:30:00", timezone="Asia/Tokyo")
        )
        assert event.end - event.start == 9000
        assert to_iso(event.start) == "2026-07-10T06:00:00Z"

    def test_epoch_seconds_are_unaffected(self) -> None:
        event = parse_event_payload(payload(start=JAN_1_2026, end=None, timezone="Asia/Tokyo"))
        assert event.start == JAN_1_2026

    def test_all_day_dates_stay_on_the_utc_day(self) -> None:
        event = parse_event_payload(payload(start="2026-07-10", end=None, all_day=True, timezone="Asia/Tokyo"))
        assert to_iso(event.start) == "2026-07-10T00:00:00Z"
        assert event.timezone == "UTC"

    def test_parse_timestamp_takes_a_zone_directly(self) -> None:
        assert parse_timestamp("2026-07-10T15:00:00", "start", "Europe/Berlin") == 1783688400
        assert parse_timestamp("2026-07-10T15:00:00", "start", "UTC") == 1783695600

    def test_an_unusable_zone_falls_back_to_utc_rather_than_failing(self) -> None:
        assert parse_timestamp("2026-07-10T15:00:00", "start", "Mars/Olympus") == 1783695600
