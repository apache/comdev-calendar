"""iCalendar (RFC 5545) export.

Just enough of the format to hand a single event, or a filtered list of them,
to Thunderbird / Google Calendar / Apple Calendar.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterable

from .models import Event

PRODID = "-//Apache Software Foundation//ASF Community Calendar//EN"
LINE_LIMIT = 75


def _stamp(epoch: int) -> str:
    return datetime.datetime.fromtimestamp(epoch, tz=datetime.UTC).strftime("%Y%m%dT%H%M%SZ")


def _date(epoch: int) -> str:
    return datetime.datetime.fromtimestamp(epoch, tz=datetime.UTC).strftime("%Y%m%d")


def escape(text: str) -> str:
    """Escapes a value for a TEXT property (RFC 5545 section 3.3.11)."""
    return (
        text.replace("\\", "\\\\")
        .replace(";", r"\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
    )


def fold(line: str) -> str:
    """Folds a content line to 75 octets, continuation lines starting with a space."""
    encoded = line.encode("utf-8")
    if len(encoded) <= LINE_LIMIT:
        return line
    pieces: list[str] = []
    chunk = bytearray()
    limit = LINE_LIMIT
    for character in line:
        raw = character.encode("utf-8")
        if len(chunk) + len(raw) > limit:
            pieces.append(chunk.decode("utf-8"))
            chunk = bytearray()
            limit = LINE_LIMIT - 1  # continuation lines carry a leading space
        chunk.extend(raw)
    pieces.append(chunk.decode("utf-8"))
    return "\r\n ".join(pieces)


def event_lines(event: Event, shortlink_url: str | None = None) -> list[str]:
    """The VEVENT block for a single event."""
    lines = [
        "BEGIN:VEVENT",
        f"UID:event-{event.id}-{event.shortlink}@calendar.apache.org",
        f"DTSTAMP:{_stamp(event.updated_at)}",
        f"SUMMARY:{escape(event.title)}",
    ]
    if event.all_day:
        # DTEND is exclusive for all-day events.
        lines.append(f"DTSTART;VALUE=DATE:{_date(event.start)}")
        lines.append(f"DTEND;VALUE=DATE:{_date(event.end)}")
    else:
        lines.append(f"DTSTART:{_stamp(event.start)}")
        lines.append(f"DTEND:{_stamp(event.end)}")

    description = event.description
    if shortlink_url:
        description = f"{description}\n\n{shortlink_url}".strip()
    if description:
        lines.append(f"DESCRIPTION:{escape(description)}")
    if event.location:
        lines.append(f"LOCATION:{escape(event.location)}")
    if event.url or shortlink_url:
        lines.append(f"URL:{escape(event.url or shortlink_url or '')}")

    categories: list[str] = [event.category]
    if event.project:
        categories.append(event.project)
    lines.append(f"CATEGORIES:{escape(','.join(categories))}")
    if not event.all_day and event.timezone and event.timezone != "UTC":
        # DTSTART/DTEND above are in UTC, which every client understands. This
        # extra property records the zone the organiser entered the times in,
        # for anyone who cares which working day the event belongs to.
        lines.append(f"X-ASF-EVENT-TIMEZONE:{escape(event.timezone)}")
    lines.append("CLASS:" + ("PUBLIC" if event.visibility == "public" else "PRIVATE"))
    lines.append("END:VEVENT")
    return lines


def render(
    events: Iterable[Event],
    name: str = "ASF Community Calendar",
    shortlinks: dict[int, str] | None = None,
) -> str:
    """Renders a full VCALENDAR document."""
    shortlinks = shortlinks or {}
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape(name)}",
    ]
    for event in events:
        lines.extend(event_lines(event, shortlinks.get(event.id)))
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"
