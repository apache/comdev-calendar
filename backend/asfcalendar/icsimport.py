"""Reading events out of an uploaded iCalendar file.

The counterpart to ``ics.py``, which writes them. Files arrive from Google
Calendar, Outlook, Thunderbird and hand-rolled scripts, so the parsing itself is
left to the ``icalendar`` package; what is here is the translation from what a
calendar file can say into what this application stores.

The translation is deliberately forgiving. An import that refuses a whole file
because one event has a 300-character title is no use to anybody, so fields are
trimmed to fit and the reader is told what was changed. Anything that cannot be
salvaged at all - an event with no start time - is skipped with a warning rather
than failing the upload.

A candidate is not an event yet. It has no calendar, no owner and no
visibility; the caller supplies those and puts the result through
``models.parse_event_payload``, exactly as it would for an event typed in by
hand.
"""

from __future__ import annotations

import dataclasses
import datetime
import zoneinfo
from typing import Any

import icalendar

from .models import (
    DAY_SECONDS,
    DEFAULT_TIMEZONE,
    MAX_DESCRIPTION_LENGTH,
    MAX_LOCATION_LENGTH,
    MAX_TITLE_LENGTH,
    MAX_URL_LENGTH,
    Category,
    ValidationError,
    Visibility,
    to_iso,
)

# An .ics file this big is either a mistake or an attack; the biggest real
# calendar exports are a few hundred kilobytes.
MAX_IMPORT_BYTES = 1024 * 1024
MAX_IMPORT_EVENTS = 200

UNTITLED = "Untitled event"


@dataclasses.dataclass(frozen=True, slots=True)
class ImportCandidate:
    """One event read out of a file, before it is given a calendar."""

    title: str
    start: int
    end: int
    all_day: bool
    description: str
    location: str
    url: str
    timezone: str
    uid: str | None
    warnings: tuple[str, ...]

    def to_json(self) -> dict[str, Any]:
        """What the preview endpoint shows."""
        return {
            "title": self.title,
            "start": to_iso(self.start),
            "end": to_iso(self.end),
            "all_day": self.all_day,
            "description": self.description,
            "location": self.location,
            "url": self.url,
            "timezone": self.timezone,
            "uid": self.uid,
            "warnings": list(self.warnings),
        }

    def to_payload(
        self,
        category: Category,
        visibility: Visibility,
        project: str | None,
    ) -> dict[str, Any]:
        """The body ``parse_event_payload`` would have received had somebody
        typed this event in, so an import goes through the same validation as
        anything else."""
        return {
            "title": self.title,
            "category": category,
            "visibility": visibility,
            "project": project,
            # Absolute instants, so the timezone below is only recorded, never
            # used to interpret these.
            "start": to_iso(self.start),
            "end": to_iso(self.end),
            "all_day": self.all_day,
            "description": self.description,
            "location": self.location,
            "url": self.url,
            "timezone": self.timezone,
        }


@dataclasses.dataclass(frozen=True)
class ImportResult:
    candidates: list[ImportCandidate]
    """Problems with the file as a whole, or with entries that were skipped."""
    warnings: list[str]

    def to_json(self) -> dict[str, Any]:
        return {
            "events": [candidate.to_json() for candidate in self.candidates],
            "count": len(self.candidates),
            "warnings": list(self.warnings),
        }


def decode(data: bytes | str) -> str:
    """Turns an uploaded file into text.

    iCalendar is specified as UTF-8, but exports with Latin-1 accents in them
    are common enough to be worth surviving.
    """
    if isinstance(data, str):
        return data.lstrip("\ufeff")
    if len(data) > MAX_IMPORT_BYTES:
        raise ValidationError(f"That file is larger than the {MAX_IMPORT_BYTES // 1024} KiB import limit.", "file")
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValidationError("That file is not text this importer can read.", "file")


def _text(component: icalendar.Component, name: str, limit: int, warnings: list[str]) -> str:
    raw = component.get(name)
    if raw is None:
        return ""
    value = str(raw).strip()
    if len(value) > limit:
        warnings.append(f"{name.capitalize()} was longer than {limit} characters and has been cut short.")
        return value[:limit].rstrip()
    return value


def _zone_of(value: datetime.datetime, warnings: list[str]) -> str:
    """The IANA name for a parsed timestamp's timezone.

    A file may carry a VTIMEZONE that does not correspond to any zone the
    system knows. The instant is still correct - icalendar has worked out the
    offset - so the event imports fine; only the label falls back to UTC.
    """
    tzinfo = value.tzinfo
    if tzinfo is None:
        warnings.append("This event had no timezone, so its times have been read as UTC.")
        return DEFAULT_TIMEZONE
    if isinstance(tzinfo, zoneinfo.ZoneInfo):
        return tzinfo.key
    name = str(getattr(tzinfo, "key", "") or tzinfo)
    try:
        zoneinfo.ZoneInfo(name)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError, KeyError):
        if name not in {DEFAULT_TIMEZONE, "UTC+00:00"}:
            warnings.append(f"Timezone {name!r} is not one this server knows; recorded as UTC.")
        return DEFAULT_TIMEZONE
    return name


def _epoch(value: datetime.date | datetime.datetime) -> int:
    """Epoch seconds for a date or datetime.

    A bare date is a calendar day rather than an instant, so it is anchored to
    UTC midnight, matching how this application stores all-day events.
    """
    if isinstance(value, datetime.datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=datetime.UTC)
        return int(moment.timestamp())
    return int(datetime.datetime(value.year, value.month, value.day, tzinfo=datetime.UTC).timestamp())


def _candidate(component: icalendar.Component) -> ImportCandidate | None:
    """Reads one VEVENT, or returns None if there is nothing usable in it."""
    warnings: list[str] = []

    start_property = component.get("DTSTART")
    if start_property is None:
        return None

    start_value = start_property.dt
    all_day = not isinstance(start_value, datetime.datetime)
    start = _epoch(start_value)

    timezone = (
        DEFAULT_TIMEZONE if all_day else _zone_of(start_value, warnings)  # type: ignore[arg-type]
    )

    end_property = component.get("DTEND")
    duration = component.get("DURATION")
    if end_property is not None:
        end = _epoch(end_property.dt)
    elif duration is not None and isinstance(duration.dt, datetime.timedelta):
        end = start + int(duration.dt.total_seconds())
    else:
        # RFC 5545: a date-only event with no end lasts one day, and a timed
        # one is instantaneous. An instant is no use in a grid, so give it an
        # hour, the same as an event created without an end.
        end = start + (DAY_SECONDS if all_day else 3600)

    if end <= start:
        warnings.append("This event ended before it started; it has been given a one-hour slot.")
        end = start + (DAY_SECONDS if all_day else 3600)

    title = _text(component, "SUMMARY", MAX_TITLE_LENGTH, warnings)
    if not title:
        title = UNTITLED
        warnings.append("This event had no title.")

    url = _text(component, "URL", MAX_URL_LENGTH, warnings)
    if url and not url.startswith(("http://", "https://")):
        warnings.append(f"Dropped a link that is not http or https: {url[:60]}")
        url = ""

    if component.get("RRULE") is not None:
        warnings.append(
            "This event repeats. The calendar does not support recurrence, so only the first "
            "occurrence has been imported."
        )

    uid = component.get("UID")

    return ImportCandidate(
        title=title,
        start=start,
        end=end,
        all_day=all_day,
        description=_text(component, "DESCRIPTION", MAX_DESCRIPTION_LENGTH, warnings),
        location=_text(component, "LOCATION", MAX_LOCATION_LENGTH, warnings),
        url=url,
        timezone=timezone,
        uid=str(uid) if uid else None,
        warnings=tuple(warnings),
    )


def parse(data: bytes | str, *, max_events: int = MAX_IMPORT_EVENTS) -> ImportResult:
    """Reads every usable event out of an iCalendar document."""
    text = decode(data)
    if "BEGIN:VCALENDAR" not in text.upper():
        raise ValidationError("That does not look like an iCalendar (.ics) file.", "file")

    try:
        calendar = icalendar.Calendar.from_ical(text)
    except Exception as exc:  # icalendar raises a variety of parse errors
        raise ValidationError(f"That iCalendar file could not be read: {exc}", "file") from exc

    warnings: list[str] = []
    candidates: list[ImportCandidate] = []
    skipped = 0

    for component in calendar.walk("VEVENT"):
        status = component.get("STATUS")
        if status is not None and str(status).upper() == "CANCELLED":
            skipped += 1
            continue
        candidate = _candidate(component)
        if candidate is None:
            skipped += 1
            continue
        candidates.append(candidate)
        if len(candidates) > max_events:
            raise ValidationError(
                f"That file holds more than {max_events} events. Split it up and import in batches.",
                "file",
            )

    if skipped:
        warnings.append(
            f"Skipped {skipped} entr{'y' if skipped == 1 else 'ies'} with no start time, or marked cancelled."
        )

    if not candidates:
        raise ValidationError("No events could be read from that file.", "file")

    return ImportResult(candidates=candidates, warnings=warnings)
