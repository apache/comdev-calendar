"""Event data model and payload validation.

Times are stored as integer epoch seconds in UTC. The API accepts and returns
ISO 8601 strings; the conversion happens here so the storage layer only ever
deals with plain integers, which keeps range queries simple.
"""

from __future__ import annotations

import dataclasses
import datetime
import re
import zoneinfo
from collections.abc import Mapping
from typing import Any, Final, Literal, get_args

Category = Literal["personal", "project", "foundation"]
Visibility = Literal["public", "private"]

CATEGORIES: Final[tuple[str, ...]] = get_args(Category)
VISIBILITIES: Final[tuple[str, ...]] = get_args(Visibility)

MAX_TITLE_LENGTH: Final = 200
MAX_DESCRIPTION_LENGTH: Final = 20000
MAX_LOCATION_LENGTH: Final = 300
MAX_URL_LENGTH: Final = 2048
MAX_TIMEZONE_LENGTH: Final = 64
DEFAULT_TIMEZONE: Final = "UTC"
# 20 years either side of "now" is plenty and keeps obvious nonsense out.
MAX_DURATION_SECONDS: Final = 366 * 24 * 3600

# Projects are LDAP-ish names: lowercase letters, digits, dashes.
PROJECT_RE: Final = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
DAY_SECONDS: Final = 86400


class ValidationError(ValueError):
    """Raised when a client-supplied event payload cannot be used."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.field = field


@dataclasses.dataclass(frozen=True, slots=True)
class EventInput:
    """A validated event payload, ready to be stored."""

    title: str
    category: Category
    visibility: Visibility
    start: int
    end: int
    all_day: bool
    description: str = ""
    location: str = ""
    url: str = ""
    project: str | None = None
    # The IANA zone the organiser entered the times in. The times themselves
    # are always stored in UTC; this records what the organiser meant, so the
    # UI can say "15:00 Europe/Berlin" alongside the viewer's own clock.
    timezone: str = DEFAULT_TIMEZONE


@dataclasses.dataclass(frozen=True, slots=True)
class Event:
    """An event as it exists in the database."""

    id: int
    shortlink: str
    title: str
    category: Category
    visibility: Visibility
    start: int
    end: int
    all_day: bool
    description: str
    location: str
    url: str
    project: str | None
    timezone: str
    owner: str
    created_at: int
    updated_at: int

    def to_json(self, shortlink_url: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.id,
            "shortlink": self.shortlink,
            "title": self.title,
            "category": self.category,
            "visibility": self.visibility,
            "start": to_iso(self.start),
            "end": to_iso(self.end),
            "all_day": self.all_day,
            "description": self.description,
            "location": self.location,
            "url": self.url,
            "project": self.project,
            "timezone": self.timezone,
            "owner": self.owner,
            "created_at": to_iso(self.created_at),
            "updated_at": to_iso(self.updated_at),
        }
        if shortlink_url is not None:
            payload["shortlink_url"] = shortlink_url
        return payload


def to_iso(epoch: int) -> str:
    """Formats epoch seconds as an ISO 8601 UTC timestamp."""
    return datetime.datetime.fromtimestamp(epoch, tz=datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_timestamp(value: Any, field: str, default_zone: str = DEFAULT_TIMEZONE) -> int:
    """Accepts an ISO 8601 string, a date string, or epoch seconds.

    A string carrying no offset is read in ``default_zone``, which is the
    event's own timezone, so that ``{"start": "2026-07-10T15:00:00",
    "timezone": "Europe/Berlin"}`` means what it looks like it means. Anything
    with an explicit offset, or a trailing "Z", is taken at face value.
    """
    if isinstance(value, bool):  # bool is an int subclass; reject it explicitly.
        raise ValidationError(f"'{field}' must be a timestamp", field)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"'{field}' must be an ISO 8601 timestamp or epoch seconds", field)
    text = value.strip()
    # datetime.fromisoformat() on 3.11+ handles "Z", but be explicit for clarity.
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValidationError(f"'{field}' is not a valid ISO 8601 timestamp: {value!r}", field) from exc
    if parsed.tzinfo is None:
        try:
            parsed = parsed.replace(tzinfo=zoneinfo.ZoneInfo(default_zone))
        except (zoneinfo.ZoneInfoNotFoundError, ValueError, KeyError):
            parsed = parsed.replace(tzinfo=datetime.UTC)
    return int(parsed.timestamp())


def day_bounds(epoch: int) -> tuple[int, int]:
    """Returns the UTC midnight-to-midnight bounds of the day containing epoch."""
    start = epoch - (epoch % DAY_SECONDS)
    return start, start + DAY_SECONDS


def _text(payload: Mapping[str, Any], field: str, *, maximum: int, required: bool = False) -> str:
    raw = payload.get(field, "")
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raise ValidationError(f"'{field}' must be a string", field)
    value = raw.strip()
    if required and not value:
        raise ValidationError(f"'{field}' is required", field)
    if len(value) > maximum:
        raise ValidationError(f"'{field}' must be at most {maximum} characters", field)
    return value


def _choice(payload: Mapping[str, Any], field: str, allowed: tuple[str, ...], default: str | None = None) -> str:
    raw = payload.get(field, default)
    if raw is None:
        raise ValidationError(f"'{field}' is required", field)
    if not isinstance(raw, str) or raw not in allowed:
        raise ValidationError(f"'{field}' must be one of: {', '.join(allowed)}", field)
    return raw


def parse_timezone(value: Any, field: str = "timezone") -> str:
    """Validates an IANA timezone name such as "Europe/Berlin"."""
    if value in (None, ""):
        return DEFAULT_TIMEZONE
    if not isinstance(value, str):
        raise ValidationError(f"'{field}' must be an IANA timezone name", field)
    name = value.strip()
    if len(name) > MAX_TIMEZONE_LENGTH:
        raise ValidationError(f"'{field}' must be at most {MAX_TIMEZONE_LENGTH} characters", field)
    try:
        zoneinfo.ZoneInfo(name)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError, KeyError) as exc:
        raise ValidationError(f"'{name}' is not a known timezone", field) from exc
    return name


def parse_event_payload(payload: Any) -> EventInput:
    """Validates a JSON body into an EventInput, or raises ValidationError."""
    if not isinstance(payload, Mapping):
        raise ValidationError("Request body must be a JSON object")

    category = _choice(payload, "category", CATEGORIES)
    title = _text(payload, "title", maximum=MAX_TITLE_LENGTH, required=True)
    description = _text(payload, "description", maximum=MAX_DESCRIPTION_LENGTH)
    location = _text(payload, "location", maximum=MAX_LOCATION_LENGTH)
    url = _text(payload, "url", maximum=MAX_URL_LENGTH)
    if url and not url.startswith(("http://", "https://")):
        raise ValidationError("'url' must be an http(s) URL", "url")

    all_day = payload.get("all_day", False)
    if not isinstance(all_day, bool):
        raise ValidationError("'all_day' must be a boolean", "all_day")

    # All-day events are whole UTC days, the way iCalendar treats a date-only
    # event, so there is no organiser timezone to record for them.
    timezone = DEFAULT_TIMEZONE if all_day else parse_timezone(payload.get("timezone"))

    if "start" not in payload:
        raise ValidationError("'start' is required", "start")
    start = parse_timestamp(payload["start"], "start", timezone)
    if all_day:
        # Snap to whole UTC days so day-grid rendering is unambiguous. DTEND is
        # exclusive, so a single-day event ends at midnight of the next day.
        start = day_bounds(start)[0]

    explicit_end = payload.get("end") not in (None, "")
    if not explicit_end:
        # An event without an explicit end lasts one hour, or one day if all-day.
        end = start + (DAY_SECONDS if all_day else 3600)
    else:
        end = parse_timestamp(payload["end"], "end", timezone)
        if all_day:
            end = day_bounds(max(end - 1, start))[1]

    if end <= start:
        raise ValidationError("'end' must be after 'start'", "end")
    if end - start > MAX_DURATION_SECONDS:
        raise ValidationError("Events may not span more than a year", "end")

    # Personal events are always private to their owner; there is no public
    # variant, so we do not let a client claim otherwise.
    visibility = "private" if category == "personal" else _choice(payload, "visibility", VISIBILITIES, "public")

    project_raw = payload.get("project")
    project: str | None = None
    if category == "project":
        if not isinstance(project_raw, str) or not project_raw.strip():
            raise ValidationError("'project' is required for project events", "project")
        project = project_raw.strip().lower()
        if not PROJECT_RE.match(project):
            raise ValidationError(f"'{project}' is not a valid project name", "project")
    elif project_raw:
        raise ValidationError(f"'project' may only be set on project events, not {category} events", "project")

    return EventInput(
        title=title,
        category=category,  # type: ignore[arg-type]
        visibility=visibility,  # type: ignore[arg-type]
        start=start,
        end=end,
        all_day=all_day,
        description=description,
        location=location,
        url=url,
        project=project,
        timezone=timezone,
    )
