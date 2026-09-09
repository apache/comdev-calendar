"""JSON API for the calendar.

Every endpoint under ``/api`` answers with JSON, including errors. Anonymous
requests are fine for reads; anything that changes data goes through
``asfquart.auth.require`` first and then through ``permissions.check_write``.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable, Iterable
from typing import Any, TypeVar, cast

import asfquart.auth
import asfquart.session
import quart
import yaml

from . import ics, icsimport, openapi
from .config import Config
from .models import (
    CATEGORIES,
    VISIBILITIES,
    Event,
    ValidationError,
    parse_event_payload,
    parse_timestamp,
)
from .permissions import (
    PermissionDenied,
    SessionLike,
    can_view,
    check_view,
    check_write,
    uid_of,
    visible_calendars,
)
from .storage import DEFAULT_SORT, MAX_LIMIT, SORT_COLUMNS, Storage

ViewFunc = TypeVar("ViewFunc", bound=Callable[..., Awaitable[quart.Response]])


def require_session(func: ViewFunc) -> ViewFunc:
    """asfquart's @auth.require, with type information attached.

    asfquart ships no type hints, so applying its decorator directly would
    erase the signature of every view it touches.
    """
    return cast(ViewFunc, asfquart.auth.require(func))


async def current_session() -> SessionLike | None:
    """The logged-in user, or None. Wrapped so tests have one thing to patch."""
    return await asfquart.session.read()  # type: ignore[no-any-return]


def _json(payload: Any, status: int = 200) -> quart.Response:
    response = quart.jsonify(payload)
    response.status_code = status
    return response


def _error(message: str, status: int, field: str | None = None) -> quart.Response:
    body: dict[str, Any] = {"error": message}
    if field:
        body["field"] = field
    return _json(body, status)


def _multi(args: Any, *names: str) -> list[str]:
    """Collects a filter that may be repeated (?category=a&category=b) or
    comma-separated (?categories=a,b)."""
    collected: list[str] = []
    for name in names:
        for raw in args.getlist(name):
            collected.extend(piece.strip() for piece in str(raw).split(","))
    return [piece for piece in collected if piece]


def _int_arg(args: Any, name: str, default: int) -> int:
    raw = args.get(name)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"'{name}' must be an integer", name) from exc


def _time_arg(args: Any, name: str) -> int | None:
    raw = args.get(name)
    if raw in (None, ""):
        return None
    return parse_timestamp(raw, name)


def create_blueprint(cfg: Config, store: Storage) -> quart.Blueprint:
    """Builds the /api blueprint bound to a config and a storage instance."""
    # The whole API moves under the deployment's mount point, so it stays on
    # the same origin and path prefix as the pages that call it.
    api = quart.Blueprint("api", __name__, url_prefix=cfg.url_path("/api"))

    def shortlink_url(event: Event) -> str:
        base = quart.request.host_url if quart.has_request_context() else ""
        return cfg.shortlink_url(event.shortlink, fallback_base=base)

    def dump(event: Event) -> dict[str, Any]:
        return event.to_json(shortlink_url(event))

    def dump_all(events: Iterable[Event], session: SessionLike | None) -> list[dict[str, Any]]:
        # Belt and braces: the SQL already filtered by visibility, but we do not
        # want a future query bug to turn into a disclosure bug.
        return [dump(event) for event in events if can_view(event, session)]

    # ---- error handling ---------------------------------------------------

    @api.errorhandler(ValidationError)
    async def _on_validation_error(error: ValidationError) -> quart.Response:
        return _error(error.message, 400, error.field)

    @api.errorhandler(PermissionDenied)
    async def _on_permission_denied(error: PermissionDenied) -> quart.Response:
        return _error(error.message, error.status)

    @api.errorhandler(asfquart.auth.AuthenticationFailed)
    async def _on_auth_failed(error: asfquart.auth.AuthenticationFailed) -> quart.Response:
        # 401 rather than 403 when there is simply no session, so the frontend
        # can offer a login link instead of an apology.
        status = 401 if error.message == asfquart.auth.Requirements.E_NOT_LOGGED_IN else error.errorcode
        return _error(error.message, status)

    @api.errorhandler(413)
    async def _on_too_large(_exception: Any) -> quart.Response:
        return _error(f"That upload is larger than the {icsimport.MAX_IMPORT_BYTES // 1024} KiB limit.", 413)

    @api.errorhandler(404)
    async def _on_404(_exception: Any) -> quart.Response:
        return _error("Not found", 404)

    # ---- session and calendars -------------------------------------------

    @api.route("/session")
    async def session_info() -> quart.Response:
        session = await current_session()
        oauth = cfg.url_path(cfg.oauth_uri)
        home = cfg.url_path("/")
        if session is None:
            return _json({"authenticated": False, "login_url": f"{oauth}?login={home}"})
        return _json(
            {
                "authenticated": True,
                "uid": uid_of(session),
                "fullname": getattr(session, "fullname", None),
                "email": getattr(session, "email", None),
                "is_member": bool(getattr(session, "isMember", False)),
                "is_chair": bool(getattr(session, "isChair", False)),
                "projects": sorted(getattr(session, "projects", []) or []),
                "committees": sorted(getattr(session, "committees", []) or []),
                "logout_url": f"{oauth}?logout={home}",
            }
        )

    @api.route("/calendars")
    async def calendars() -> quart.Response:
        session = await current_session()
        payload = visible_calendars(session)
        payload["title"] = cfg.app.title
        payload["default_display_zone"] = cfg.app.default_display_zone
        return _json(payload)

    @api.route("/healthz")
    async def healthz() -> quart.Response:
        return _json({"status": "ok", "time": int(time.time())})

    def _spec() -> dict[str, Any]:
        # Advertise the host the caller is already talking to, so "try it out"
        # in the docs UI hits this deployment rather than a configured guess.
        base = quart.request.host_url if quart.has_request_context() else ""
        return openapi.build(cfg, origin=base)

    @api.route("/openapi.json")
    async def openapi_json() -> quart.Response:
        return _json(_spec())

    @api.route("/openapi.yaml")
    async def openapi_yaml() -> quart.Response:
        body = yaml.safe_dump(_spec(), sort_keys=False, allow_unicode=True, width=100)
        return quart.Response(body, content_type="application/yaml; charset=utf-8")

    # ---- reading events ---------------------------------------------------

    async def _query_events(session: SessionLike | None) -> list[Event]:
        args = quart.request.args
        sort = args.get("sort", DEFAULT_SORT)
        if sort not in SORT_COLUMNS:
            raise ValidationError(f"'sort' must be one of: {', '.join(sorted(SORT_COLUMNS))}", "sort")
        visibility = args.get("visibility") or None
        if visibility not in (None, "public", "private"):
            raise ValidationError("'visibility' must be 'public' or 'private'", "visibility")
        owner = args.get("owner") or None
        if owner == "me":
            owner = uid_of(session)
            if owner is None:
                return []
        return await store.query(
            session,
            start=_time_arg(args, "start"),
            end=_time_arg(args, "end"),
            categories=_multi(args, "category", "categories"),
            projects=_multi(args, "project", "projects"),
            visibility=visibility,
            owner=owner,
            search=args.get("q"),
            sort=sort,
            limit=_int_arg(args, "limit", MAX_LIMIT),
            offset=_int_arg(args, "offset", 0),
        )

    @api.route("/events")
    async def list_events() -> quart.Response:
        session = await current_session()
        events = await _query_events(session)
        return _json({"events": dump_all(events, session), "count": len(events)})

    @api.route("/events.ics")
    async def list_events_ics() -> quart.Response:
        session = await current_session()
        events = [event for event in await _query_events(session) if can_view(event, session)]
        body = ics.render(
            events,
            name=cfg.app.title,
            shortlinks={event.id: shortlink_url(event) for event in events},
        )
        return quart.Response(body, content_type="text/calendar; charset=utf-8")

    @api.route("/events/<int:event_id>")
    async def get_event(event_id: int) -> quart.Response:
        session = await current_session()
        event = await store.get(event_id)
        if event is None:
            return _error("No such event", 404)
        check_view(event, session)
        return _json({"event": dump(event)})

    @api.route("/events/<int:event_id>.ics")
    async def get_event_ics(event_id: int) -> quart.Response:
        session = await current_session()
        event = await store.get(event_id)
        if event is None:
            return _error("No such event", 404)
        check_view(event, session)
        body = ics.render([event], name=event.title, shortlinks={event.id: shortlink_url(event)})
        return quart.Response(
            body,
            content_type="text/calendar; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="event-{event.shortlink}.ics"'},
        )

    @api.route("/shortlink/<token>")
    async def get_by_shortlink(token: str) -> quart.Response:
        session = await current_session()
        event = await store.get_by_shortlink(token)
        if event is None:
            return _error("No such event", 404)
        check_view(event, session)
        return _json({"event": dump(event)})

    # ---- importing an iCalendar file ---------------------------------------

    async def _uploaded_calendar() -> bytes | str:
        """The .ics file, however it was sent.

        A browser posts it as a multipart form; a script is more likely to pipe
        the file straight into the body, so both are accepted.
        """
        content_type = quart.request.content_type or ""
        if content_type.startswith("multipart/"):
            files = await quart.request.files
            upload = files.get("file")
            if upload is None:
                raise ValidationError("Attach the calendar as the 'file' part of the form.", "file")
            return cast("bytes | str", upload.read())
        body = await quart.request.get_data()
        if not body:
            raise ValidationError("The request body was empty; send an iCalendar file.", "file")
        return body

    async def _import_settings() -> tuple[str, str, str | None]:
        """Which calendar the imported events should land in.

        Taken from the form when there is one, and from the query string
        otherwise, so a script piping a file in can still say where it goes.
        """
        form: Any = {}
        if (quart.request.content_type or "").startswith("multipart/"):
            form = await quart.request.form

        def value(name: str) -> str | None:
            return form.get(name) or quart.request.args.get(name)

        category = (value("category") or "").strip()
        if category not in CATEGORIES:
            raise ValidationError(f"'category' is required and must be one of: {', '.join(CATEGORIES)}", "category")
        # Personal events are forced private later; for the others this matches
        # the default POST /api/events applies.
        visibility = (value("visibility") or "public").strip()
        if visibility not in VISIBILITIES:
            raise ValidationError(f"'visibility' must be one of: {', '.join(VISIBILITIES)}", "visibility")
        project = (value("project") or "").strip() or None
        return category, visibility, project

    @api.route("/import/preview", methods=["POST"])
    @require_session
    async def import_preview() -> quart.Response:
        """Reads a file and says what it holds, without writing anything."""
        result = icsimport.parse(await _uploaded_calendar())
        return _json(result.to_json())

    @api.route("/import", methods=["POST"])
    @require_session
    async def import_events() -> quart.Response:
        session = await current_session()
        data = await _uploaded_calendar()
        category, visibility, project = await _import_settings()
        result = icsimport.parse(data)

        # Every candidate goes through the same validation as a hand-typed
        # event, and all of them are checked before any of them is written.
        payloads = [
            parse_event_payload(candidate.to_payload(category, visibility, project))  # type: ignore[arg-type]
            for candidate in result.candidates
        ]
        # They all land in the same calendar, so one permission check covers
        # the batch.
        check_write(payloads[0], session)

        owner = uid_of(session)
        assert owner is not None  # @require_session guarantees a session
        created = await store.create_many(payloads, owner)
        return _json(
            {
                "created": dump_all(created, session),
                "count": len(created),
                "warnings": result.warnings,
            },
            201,
        )

    # ---- writing events ---------------------------------------------------
    #
    # The bare @require decorator only insists on a valid session; who may
    # touch which calendar is decided by permissions.check_write(), which uses
    # asfquart's Requirements.member for the foundation category.

    @api.route("/events", methods=["POST"])
    @require_session
    async def create_event() -> quart.Response:
        session = await current_session()
        payload = parse_event_payload(await _body())
        check_write(payload, session)
        owner = uid_of(session)
        assert owner is not None  # @require guarantees a session
        event = await store.create(payload, owner)
        return _json({"event": dump(event)}, 201)

    @api.route("/events/<int:event_id>", methods=["PUT", "PATCH"])
    @require_session
    async def update_event(event_id: int) -> quart.Response:
        session = await current_session()
        existing = await store.get(event_id)
        if existing is None:
            return _error("No such event", 404)
        # You must be allowed to change the event as it stands *and* as it
        # would be after the edit, so nobody can move an event into a calendar
        # they cannot write to (or out of one they can).
        check_write(existing, session)
        payload = parse_event_payload(await _body())
        check_write(payload, session)
        updated = await store.update(event_id, payload)
        if updated is None:
            return _error("No such event", 404)
        return _json({"event": dump(updated)})

    @api.route("/events/<int:event_id>", methods=["DELETE"])
    @require_session
    async def delete_event(event_id: int) -> quart.Response:
        session = await current_session()
        existing = await store.get(event_id)
        if existing is None:
            return _error("No such event", 404)
        check_write(existing, session)
        await store.delete(event_id)
        return _json({"deleted": event_id})

    return api


async def _body() -> Any:
    """Reads the request body as JSON, with a friendly error for junk."""
    try:
        return await quart.request.get_json(force=True)
    except Exception as exc:  # quart raises a werkzeug BadRequest subclass
        raise ValidationError("Request body must be valid JSON") from exc
