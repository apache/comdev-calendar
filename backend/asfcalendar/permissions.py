"""Access rules for calendar events.

Everything in here is a pure function over (event, session), which makes the
rules straightforward to unit test without spinning up the web app. The session
is an ``asfquart.session.ClientSession`` (or ``None`` for anonymous visitors).

The rules, in short:

personal
    Only the owner may see or change the event. Personal events are always
    private; there is no public variant.

project (public)
    Anyone may read, including anonymous visitors. Any member of the project
    (``session.projects``) or its committee (``session.committees``) may
    create, edit or delete.

project (private)
    Only the project's committee (``session.committees``) may read or write.

foundation (public)
    Anyone may read. Only foundation members may create, edit or delete.

foundation (private)
    Only foundation members may read or write.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from asfquart.auth import Requirements as R

from .models import Event, EventInput


@runtime_checkable
class SessionLike(Protocol):
    """The subset of asfquart's ClientSession that we rely on."""

    uid: str | None
    isMember: bool
    committees: list[str]
    projects: list[str]


class PermissionDenied(Exception):
    """Raised when the current session may not perform the requested action."""

    def __init__(self, message: str, status: int = 403):
        super().__init__(message)
        self.message = message
        self.status = status


def _names(value: Any) -> set[str]:
    """Normalises a session's project/committee list into a lowercase set."""
    if not value:
        return set()
    if isinstance(value, str):
        value = [value]
    return {str(item).strip().lower() for item in value if str(item).strip()}


def is_member(session: SessionLike | None) -> bool:
    """True if the session belongs to a foundation member.

    Uses asfquart's own ``Requirements.member`` test so this app agrees with
    whatever ``@asfquart.auth.require({R.member})`` would decide.
    """
    if session is None:
        return False
    passes, _reason = R.member(session)  # type: ignore[arg-type]
    return bool(passes)


def committees_of(session: SessionLike | None) -> set[str]:
    """Committees (PMCs) the session is a member of."""
    if session is None:
        return set()
    return _names(getattr(session, "committees", None))


def projects_of(session: SessionLike | None) -> set[str]:
    """Projects the session is a committer on.

    Committee membership implies project membership for our purposes: a PMC
    member who is somehow missing from the committer list should still be able
    to manage their project's public events.
    """
    if session is None:
        return set()
    return _names(getattr(session, "projects", None)) | committees_of(session)


def writable_projects(session: SessionLike | None) -> set[str]:
    """Projects whose public events the session may create/edit/delete."""
    return projects_of(session)


def uid_of(session: SessionLike | None) -> str | None:
    if session is None:
        return None
    uid = getattr(session, "uid", None)
    return str(uid) if uid else None


def can_view(event: Event, session: SessionLike | None) -> bool:
    """Whether this session (possibly anonymous) may read the event."""
    if event.category == "personal":
        owner = uid_of(session)
        return owner is not None and owner == event.owner

    if event.category == "foundation":
        if event.visibility == "public":
            return True
        return is_member(session)

    # Project events.
    if event.visibility == "public":
        return True
    if not event.project:
        # Defensive: a private project event without a project is unreachable.
        return False
    return event.project.lower() in committees_of(session)


def can_write(event_or_input: Event | EventInput, session: SessionLike | None) -> bool:
    """Whether this session may create, edit or delete the event.

    For an existing Event this checks the event as stored; for an EventInput it
    checks the event the client is asking us to create.
    """
    if session is None:
        return False

    category = event_or_input.category
    if category == "personal":
        owner = uid_of(session)
        if owner is None:
            return False
        if isinstance(event_or_input, Event):
            return owner == event_or_input.owner
        return True

    if category == "foundation":
        return is_member(session)

    project = (event_or_input.project or "").lower()
    if not project:
        return False
    if event_or_input.visibility == "private":
        return project in committees_of(session)
    return project in writable_projects(session)


def check_write(event_or_input: Event | EventInput, session: SessionLike | None) -> None:
    """can_write(), but raises PermissionDenied with a useful message."""
    if can_write(event_or_input, session):
        return
    if session is None:
        raise PermissionDenied("You need to be logged in to do that.", status=401)

    category = event_or_input.category
    if category == "foundation":
        raise PermissionDenied(R.E_NOT_MEMBER)
    if category == "personal":
        raise PermissionDenied("Personal events may only be changed by their owner.")
    project = event_or_input.project or "?"
    if event_or_input.visibility == "private":
        raise PermissionDenied(f"Private {project} events may only be managed by the {project} committee.")
    raise PermissionDenied(f"You are not a member of the {project} project.")


def check_view(event: Event, session: SessionLike | None) -> None:
    """can_view(), but raises PermissionDenied.

    Anonymous visitors get a 401 so the frontend knows logging in might help;
    logged-in users get a 404-ish 403 that does not confirm much.
    """
    if can_view(event, session):
        return
    if session is None:
        raise PermissionDenied("You need to be logged in to view this event.", status=401)
    raise PermissionDenied("You do not have access to this event.")


def visible_calendars(session: SessionLike | None) -> dict[str, Any]:
    """Describes what the current session can see and write.

    The frontend uses this to build its filter list and to decide which
    calendars to offer in the "new event" form.
    """
    committees = sorted(committees_of(session))
    projects = sorted(projects_of(session))
    member = is_member(session)
    uid = uid_of(session)
    return {
        "uid": uid,
        "authenticated": uid is not None,
        "is_member": member,
        "projects": projects,
        "committees": committees,
        "can_create": {
            "personal": uid is not None,
            "project": projects,
            "project_private": committees,
            "foundation": member,
        },
    }
