"""The OpenAPI description of the HTTP API.

The document is built here rather than kept as a checked-in YAML file, and it
is built out of the same constants the code enforces: the category and
visibility enums, the field length limits, the sort keys, the shortlink
alphabet. Change ``MAX_TITLE_LENGTH`` and the published schema follows on its
own, with nothing to remember.

What cannot be derived - descriptions, which status codes an endpoint can
return - is written out below. ``backend/tests/test_openapi.py`` closes that
gap by comparing this document against the application's real URL map and
against ``Event.to_json()``, so a route or field added without being documented
fails the build rather than quietly going missing.
"""

from __future__ import annotations

import dataclasses
import re
from typing import Any

from . import __version__, shortlink
from .config import Config
from .icsimport import MAX_IMPORT_BYTES, MAX_IMPORT_EVENTS
from .models import (
    CATEGORIES,
    DEFAULT_TIMEZONE,
    MAX_DESCRIPTION_LENGTH,
    MAX_LOCATION_LENGTH,
    MAX_TIMEZONE_LENGTH,
    MAX_TITLE_LENGTH,
    MAX_URL_LENGTH,
    PROJECT_RE,
    VISIBILITIES,
    Event,
)
from .storage import DEFAULT_SORT, MAX_LIMIT, SORT_COLUMNS

OPENAPI_VERSION = "3.1.0"

# Quart rules look like /api/events/<int:event_id>; OpenAPI wants {event_id}.
RULE_PARAMETER = re.compile(r"<(?:[^:<>]+:)?([^<>]+)>")

SHORTLINK_PATTERN = f"^[{re.escape(shortlink.ALPHABET)}]{{4,32}}$"

DESCRIPTION = """
The HTTP API behind the ASF Community Calendar.

Reads are open to anyone; anything that changes data needs a session. Log in by
sending a browser to `/auth?login=/`, which hands off to the foundation's OAuth
provider and sets a session cookie.

**Send `X-No-Redirect: 1` on every call.** Without it, an unauthenticated
request is answered with a redirect to the OAuth provider, which is right for a
browser following a link and useless for a script. With it you get a JSON 401.

Times go in and come out as ISO 8601 in UTC. A timestamp sent with no offset is
read in the event's own `timezone`, so `{"start": "2026-07-10T15:00:00",
"timezone": "Europe/Berlin"}` means what it looks like. All-day events are whole
UTC days with an exclusive end, the way iCalendar treats a date-only event.

Who may see and change what is decided by the calendar an event belongs to; the
project README has the full table.
"""


def openapi_path(rule: str) -> str:
    """Converts a Quart rule into an OpenAPI path template."""
    return RULE_PARAMETER.sub(r"{\1}", rule)


def _error_response(description: str) -> dict[str, Any]:
    return {
        "description": description,
        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
    }


def _event_response(description: str) -> dict[str, Any]:
    return {
        "description": description,
        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/EventEnvelope"}}},
    }


def _calendar_response(description: str) -> dict[str, Any]:
    return {
        "description": description,
        "content": {
            "text/calendar": {
                "schema": {"type": "string", "format": "iCalendar"},
                "example": "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n...\r\nEND:VCALENDAR\r\n",
            }
        },
    }


def _calendar_upload(with_settings: bool = False) -> dict[str, Any]:
    """The request body of an import: a multipart form, or the file itself."""
    form: dict[str, Any] = {"file": {"type": "string", "format": "binary"}}
    if with_settings:
        form |= {
            "category": {"type": "string", "enum": list(CATEGORIES)},
            "project": {"type": "string", "pattern": PROJECT_RE.pattern},
            "visibility": {"type": "string", "enum": list(VISIBILITIES), "default": "public"},
        }
    return {
        "required": True,
        "description": (
            "An iCalendar document, either as the `file` part of a multipart form or as the "
            f"whole request body. At most {MAX_IMPORT_BYTES // 1024} KiB."
        ),
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "required": ["file"] + (["category"] if with_settings else []),
                    "properties": form,
                }
            },
            "text/calendar": {"schema": {"type": "string"}},
        },
    }


def _schemas() -> dict[str, Any]:
    """The component schemas, with every limit taken from the real constant."""
    timestamp = {
        "type": "string",
        "description": (
            "ISO 8601. On the way in, a value with no offset is read in the event's timezone; "
            "epoch seconds are also accepted. On the way out, always UTC."
        ),
        "examples": ["2026-07-10T13:00:00Z"],
    }

    return {
        "Event": {
            "type": "object",
            "description": "An event as stored.",
            "required": [field.name for field in dataclasses.fields(Event)] + ["shortlink_url"],
            "properties": {
                "id": {"type": "integer", "readOnly": True, "examples": [42]},
                "shortlink": {
                    "type": "string",
                    "readOnly": True,
                    "pattern": SHORTLINK_PATTERN,
                    "description": "Short token identifying the event.",
                    "examples": ["AbCd2345"],
                },
                "shortlink_url": {
                    "type": "string",
                    "format": "uri",
                    "readOnly": True,
                    "description": "Absolute URL that opens the event.",
                    "examples": ["https://calendar.apache.org/e/AbCd2345"],
                },
                "title": {"type": "string", "minLength": 1, "maxLength": MAX_TITLE_LENGTH},
                "category": {
                    "type": "string",
                    "enum": list(CATEGORIES),
                    "description": "Which calendar the event belongs to. This decides who can see and change it.",
                },
                "visibility": {
                    "type": "string",
                    "enum": list(VISIBILITIES),
                    "description": (
                        "Personal events are always private; the value is forced regardless of what is sent."
                    ),
                },
                "start": timestamp,
                "end": {**timestamp, "description": "Exclusive for all-day events."},
                "all_day": {
                    "type": "boolean",
                    "description": "All-day events are snapped to whole UTC days and carry no organiser timezone.",
                },
                "description": {"type": "string", "maxLength": MAX_DESCRIPTION_LENGTH},
                "location": {"type": "string", "maxLength": MAX_LOCATION_LENGTH},
                "url": {
                    "type": "string",
                    "maxLength": MAX_URL_LENGTH,
                    "description": "Must be http or https if given.",
                },
                "project": {
                    "type": ["string", "null"],
                    "pattern": PROJECT_RE.pattern,
                    "description": "Required for project events, and rejected on the other categories.",
                    "examples": ["httpd"],
                },
                "timezone": {
                    "type": "string",
                    "maxLength": MAX_TIMEZONE_LENGTH,
                    "default": DEFAULT_TIMEZONE,
                    "description": (
                        "IANA zone the organiser entered the times in. Recorded for display; it does not "
                        f"change when the event happens. Forced to {DEFAULT_TIMEZONE} for all-day events."
                    ),
                    "examples": ["Europe/Berlin"],
                },
                "owner": {
                    "type": "string",
                    "readOnly": True,
                    "description": "uid of whoever added the event. Does not restrict who may edit it.",
                },
                "created_at": {**timestamp, "readOnly": True},
                "updated_at": {**timestamp, "readOnly": True},
            },
        },
        "EventInput": {
            "type": "object",
            "description": "The body of a create or update. Unset fields take their default.",
            "required": ["title", "category", "start"],
            "properties": {
                "title": {"type": "string", "minLength": 1, "maxLength": MAX_TITLE_LENGTH},
                "category": {"type": "string", "enum": list(CATEGORIES)},
                "visibility": {"type": "string", "enum": list(VISIBILITIES), "default": "public"},
                "start": timestamp,
                "end": {
                    **timestamp,
                    "description": "Defaults to an hour after start, or a day for an all-day event.",
                },
                "all_day": {"type": "boolean", "default": False},
                "description": {"type": "string", "maxLength": MAX_DESCRIPTION_LENGTH},
                "location": {"type": "string", "maxLength": MAX_LOCATION_LENGTH},
                "url": {"type": "string", "maxLength": MAX_URL_LENGTH},
                "project": {"type": ["string", "null"], "pattern": PROJECT_RE.pattern},
                "timezone": {"type": "string", "default": DEFAULT_TIMEZONE},
            },
        },
        "EventEnvelope": {
            "type": "object",
            "required": ["event"],
            "properties": {"event": {"$ref": "#/components/schemas/Event"}},
        },
        "EventList": {
            "type": "object",
            "required": ["events", "count"],
            "properties": {
                "events": {"type": "array", "items": {"$ref": "#/components/schemas/Event"}},
                "count": {"type": "integer", "description": "Number of events in this response."},
            },
        },
        "ImportCandidate": {
            "type": "object",
            "description": "An event read out of a file, before it is given a calendar.",
            "required": ["title", "start", "end", "all_day", "warnings"],
            "properties": {
                "title": {"type": "string"},
                "start": {"type": "string", "description": "ISO 8601 UTC."},
                "end": {"type": "string", "description": "ISO 8601 UTC, exclusive for all-day."},
                "all_day": {"type": "boolean"},
                "description": {"type": "string"},
                "location": {"type": "string"},
                "url": {"type": "string"},
                "timezone": {"type": "string"},
                "uid": {
                    "type": ["string", "null"],
                    "description": "The UID from the file. Not stored; shown so a reader can recognise the entry.",
                },
                "warnings": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "What had to be changed to make this event importable.",
                },
            },
        },
        "ImportPreview": {
            "type": "object",
            "required": ["events", "count", "warnings"],
            "properties": {
                "events": {
                    "type": "array",
                    "items": {"$ref": "#/components/schemas/ImportCandidate"},
                },
                "count": {"type": "integer"},
                "warnings": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Problems with the file as a whole, such as entries that were skipped.",
                },
            },
        },
        "ImportResult": {
            "type": "object",
            "required": ["created", "count", "warnings"],
            "properties": {
                "created": {"type": "array", "items": {"$ref": "#/components/schemas/Event"}},
                "count": {"type": "integer"},
                "warnings": {"type": "array", "items": {"type": "string"}},
            },
        },
        "Error": {
            "type": "object",
            "required": ["error"],
            "properties": {
                "error": {"type": "string", "description": "What went wrong, in a sentence."},
                "field": {
                    "type": "string",
                    "description": "Present when one field in particular was at fault.",
                    "examples": ["end"],
                },
            },
        },
        "Session": {
            "type": "object",
            "required": ["authenticated"],
            "properties": {
                "authenticated": {"type": "boolean"},
                "uid": {"type": ["string", "null"]},
                "fullname": {"type": ["string", "null"]},
                "email": {"type": ["string", "null"]},
                "is_member": {"type": "boolean", "description": "Foundation member."},
                "is_chair": {"type": "boolean"},
                "projects": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Projects the user commits to.",
                },
                "committees": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Committees (PMCs) the user sits on.",
                },
                "login_url": {"type": "string", "description": "Present when not authenticated."},
                "logout_url": {"type": "string", "description": "Present when authenticated."},
            },
        },
        "Calendars": {
            "type": "object",
            "description": "What the current session can read and write.",
            "required": ["authenticated", "can_create"],
            "properties": {
                "uid": {"type": ["string", "null"]},
                "authenticated": {"type": "boolean"},
                "is_member": {"type": "boolean"},
                "projects": {"type": "array", "items": {"type": "string"}},
                "committees": {"type": "array", "items": {"type": "string"}},
                "can_create": {
                    "type": "object",
                    "properties": {
                        "personal": {"type": "boolean"},
                        "project": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Projects whose public events this session may manage.",
                        },
                        "project_private": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Projects whose private events this session may manage.",
                        },
                        "foundation": {"type": "boolean"},
                    },
                },
                "title": {"type": "string"},
                "default_display_zone": {
                    "type": "string",
                    "description": "'local', or an IANA zone name the UI should open on.",
                },
            },
        },
        "Health": {
            "type": "object",
            "required": ["status", "time"],
            "properties": {
                "status": {"type": "string", "examples": ["ok"]},
                "time": {"type": "integer", "description": "Server time, epoch seconds."},
            },
        },
    }


def _list_parameters() -> list[dict[str, Any]]:
    """Query parameters of GET /events, shared with the iCalendar feed."""
    return [
        {
            "name": "start",
            "in": "query",
            "description": "Only events overlapping [start, end). ISO 8601 or epoch seconds.",
            "schema": {"type": "string"},
            "example": "2026-07-01T00:00:00Z",
        },
        {
            "name": "end",
            "in": "query",
            "description": "Exclusive end of the window.",
            "schema": {"type": "string"},
            "example": "2026-08-01T00:00:00Z",
        },
        {
            "name": "category",
            "in": "query",
            "description": "Repeat the parameter, or use `categories` with a comma-separated list.",
            "schema": {"type": "array", "items": {"type": "string", "enum": list(CATEGORIES)}},
            "explode": True,
        },
        {
            "name": "project",
            "in": "query",
            "description": "Repeat the parameter, or use `projects` with a comma-separated list.",
            "schema": {"type": "array", "items": {"type": "string"}},
            "explode": True,
        },
        {
            "name": "visibility",
            "in": "query",
            "schema": {"type": "string", "enum": list(VISIBILITIES)},
        },
        {
            "name": "owner",
            "in": "query",
            "description": "A uid, or `me` for the current session. Anonymous `me` returns nothing.",
            "schema": {"type": "string"},
        },
        {
            "name": "q",
            "in": "query",
            "description": "Text search over title, description, location and project.",
            "schema": {"type": "string"},
        },
        {
            "name": "sort",
            "in": "query",
            "schema": {
                "type": "string",
                "enum": sorted(SORT_COLUMNS),
                "default": DEFAULT_SORT,
            },
        },
        {
            "name": "limit",
            "in": "query",
            "schema": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": MAX_LIMIT},
        },
        {"name": "offset", "in": "query", "schema": {"type": "integer", "minimum": 0, "default": 0}},
    ]


EVENT_ID = {
    "name": "event_id",
    "in": "path",
    "required": True,
    "schema": {"type": "integer"},
}

TOKEN = {
    "name": "token",
    "in": "path",
    "required": True,
    "schema": {"type": "string", "pattern": SHORTLINK_PATTERN},
    "example": "AbCd2345",
}


def _paths() -> dict[str, Any]:
    unauthenticated = _error_response("No session. Log in and try again.")
    forbidden = _error_response("The session may not do that. The message says which rule stopped it.")
    missing = _error_response("No such event, or none this session may see.")
    invalid = _error_response("The body or a query parameter was rejected. `field` names the culprit.")

    write_responses = {
        "400": invalid,
        "401": unauthenticated,
        "403": forbidden,
        "404": missing,
    }

    return {
        "/api/session": {
            "get": {
                "tags": ["Session"],
                "summary": "Who is logged in",
                "description": "Never fails; an anonymous caller gets `authenticated: false` and a login URL.",
                "responses": {
                    "200": {
                        "description": "The current session.",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Session"}}},
                    }
                },
            }
        },
        "/api/calendars": {
            "get": {
                "tags": ["Session"],
                "summary": "What this session can read and write",
                "description": "Used by the UI to build its filters and decide which calendars to offer.",
                "responses": {
                    "200": {
                        "description": "Calendars and permissions.",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Calendars"}}},
                    }
                },
            }
        },
        "/api/healthz": {
            "get": {
                "tags": ["Service"],
                "summary": "Liveness check",
                "responses": {
                    "200": {
                        "description": "The service is up.",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Health"}}},
                    }
                },
            }
        },
        "/api/events": {
            "get": {
                "tags": ["Events"],
                "summary": "List events",
                "description": ("Returns only what the session may see. An anonymous caller gets public events."),
                "parameters": _list_parameters(),
                "responses": {
                    "200": {
                        "description": "Matching events.",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/EventList"}}},
                    },
                    "400": invalid,
                },
            },
            "post": {
                "tags": ["Events"],
                "summary": "Create an event",
                "description": (
                    "The session must be allowed to write to the calendar being created in: the project "
                    "for a project event, foundation membership for a foundation event."
                ),
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/EventInput"}}},
                },
                "responses": {
                    "201": _event_response("The event as stored."),
                    "400": invalid,
                    "401": unauthenticated,
                    "403": forbidden,
                },
            },
        },
        "/api/events.ics": {
            "get": {
                "tags": ["Events"],
                "summary": "iCalendar feed",
                "description": "The same events `GET /api/events` would return, as a subscribable calendar.",
                "parameters": _list_parameters(),
                "responses": {"200": _calendar_response("An iCalendar document."), "400": invalid},
            }
        },
        "/api/events/{event_id}": {
            "get": {
                "tags": ["Events"],
                "summary": "Fetch one event",
                "parameters": [EVENT_ID],
                "responses": {
                    "200": _event_response("The event."),
                    "401": unauthenticated,
                    "403": forbidden,
                    "404": missing,
                },
            },
            "put": {
                "tags": ["Events"],
                "summary": "Replace an event",
                "description": (
                    "The session must be allowed to write the event as it stands *and* as it would be "
                    "afterwards, so an event cannot be moved into or out of a calendar you cannot write."
                ),
                "parameters": [EVENT_ID],
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/EventInput"}}},
                },
                "responses": {"200": _event_response("The updated event."), **write_responses},
            },
            "patch": {
                "tags": ["Events"],
                "summary": "Replace an event",
                "description": "Identical to PUT; the whole event is replaced either way.",
                "parameters": [EVENT_ID],
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/EventInput"}}},
                },
                "responses": {"200": _event_response("The updated event."), **write_responses},
            },
            "delete": {
                "tags": ["Events"],
                "summary": "Delete an event",
                "parameters": [EVENT_ID],
                "responses": {
                    "200": {
                        "description": "Deleted.",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["deleted"],
                                    "properties": {"deleted": {"type": "integer"}},
                                }
                            }
                        },
                    },
                    "401": unauthenticated,
                    "403": forbidden,
                    "404": missing,
                },
            },
        },
        "/api/events/{event_id}.ics": {
            "get": {
                "tags": ["Events"],
                "summary": "One event as iCalendar",
                "parameters": [EVENT_ID],
                "responses": {
                    "200": _calendar_response("An iCalendar document with a single event."),
                    "401": unauthenticated,
                    "403": forbidden,
                    "404": missing,
                },
            }
        },
        "/api/shortlink/{token}": {
            "get": {
                "tags": ["Events"],
                "summary": "Fetch an event by its shortlink token",
                "parameters": [TOKEN],
                "responses": {
                    "200": _event_response("The event."),
                    "401": unauthenticated,
                    "403": forbidden,
                    "404": missing,
                },
            }
        },
        "/api/import/preview": {
            "post": {
                "tags": ["Import"],
                "summary": "Read an iCalendar file without saving anything",
                "description": (
                    "Says what the file holds, so a caller can show it before committing to it. "
                    "Nothing is written and no calendar is chosen yet."
                ),
                "requestBody": _calendar_upload(),
                "responses": {
                    "200": {
                        "description": "What was found in the file.",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ImportPreview"}}},
                    },
                    "400": invalid,
                    "401": unauthenticated,
                    "413": _error_response(f"The upload was larger than the {MAX_IMPORT_BYTES // 1024} KiB limit."),
                },
            }
        },
        "/api/import": {
            "post": {
                "tags": ["Import"],
                "summary": "Import an iCalendar file as events",
                "description": (
                    "Every event in the file lands in the same calendar, given by `category`, "
                    "`project` and `visibility`. Send them as form fields alongside the file, or "
                    "as query parameters when posting the file as the request body.\n\n"
                    "The import is all or nothing: every event is validated and the permission "
                    "checked before any of them is written, and the batch is one transaction.\n\n"
                    f"At most {MAX_IMPORT_EVENTS} events per file. Recurring events are imported as "
                    "a single occurrence, and entries with no start time, or marked cancelled, are "
                    "skipped; both are reported in `warnings`."
                ),
                "parameters": [
                    {
                        "name": "category",
                        "in": "query",
                        "description": "Required, unless sent as a form field.",
                        "schema": {"type": "string", "enum": list(CATEGORIES)},
                    },
                    {
                        "name": "project",
                        "in": "query",
                        "description": "Required for project events.",
                        "schema": {"type": "string", "pattern": PROJECT_RE.pattern},
                    },
                    {
                        "name": "visibility",
                        "in": "query",
                        "schema": {"type": "string", "enum": list(VISIBILITIES), "default": "public"},
                    },
                ],
                "requestBody": _calendar_upload(with_settings=True),
                "responses": {
                    "201": {
                        "description": "The events as stored.",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ImportResult"}}},
                    },
                    "400": invalid,
                    "401": unauthenticated,
                    "403": forbidden,
                    "413": _error_response(f"The upload was larger than the {MAX_IMPORT_BYTES // 1024} KiB limit."),
                },
            }
        },
        "/api/openapi.json": {
            "get": {
                "tags": ["Service"],
                "summary": "This document",
                "responses": {
                    "200": {
                        "description": "The OpenAPI description of this API.",
                        "content": {"application/json": {"schema": {"type": "object"}}},
                    }
                },
            }
        },
        "/api/openapi.yaml": {
            "get": {
                "tags": ["Service"],
                "summary": "This document, as YAML",
                "responses": {
                    "200": {
                        "description": "The OpenAPI description of this API.",
                        "content": {"application/yaml": {"schema": {"type": "string"}}},
                    }
                },
            }
        },
    }


def build(cfg: Config, origin: str = "") -> dict[str, Any]:
    """The complete OpenAPI document.

    ``origin`` is the scheme and host to advertise, normally taken from the
    incoming request so the "try it out" button in the docs UI calls the server
    the reader is already talking to.
    """
    server_url = f"{cfg.origin(origin)}{cfg.base_path}" or "/"
    return {
        "openapi": OPENAPI_VERSION,
        "info": {
            "title": f"{cfg.app.title} API",
            "version": __version__,
            "description": DESCRIPTION.strip(),
            "license": {"name": "Apache-2.0", "identifier": "Apache-2.0"},
            "contact": {"name": "ASF Community Development", "email": "dev@community.apache.org"},
        },
        "servers": [{"url": server_url, "description": "This deployment"}],
        "tags": [
            {"name": "Events", "description": "Reading and changing calendar events."},
            {"name": "Import", "description": "Turning an iCalendar file into events."},
            {"name": "Session", "description": "Who you are and what you may do."},
            {"name": "Service", "description": "Health and documentation."},
        ],
        "paths": _paths(),
        "components": {"schemas": _schemas()},
    }
