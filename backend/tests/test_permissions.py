"""The access rules, checked exhaustively.

These are the rules the whole application hangs on, so the matrix below spells
out every combination rather than being clever about it.
"""

from __future__ import annotations

import itertools

import pytest
from asfquart.session import ClientSession

from asfcalendar.models import Category, Event, EventInput, Visibility
from asfcalendar.permissions import (
    PermissionDenied,
    can_view,
    can_write,
    check_view,
    check_write,
    committees_of,
    is_member,
    projects_of,
    uid_of,
    visible_calendars,
)

from .conftest import session_for

NOW = 1767225600


def make_event(
    category: Category,
    visibility: Visibility = "public",
    project: str | None = None,
    owner: str = "alice",
    event_id: int = 1,
) -> Event:
    return Event(
        id=event_id,
        shortlink="AbCd2345",
        title="An event",
        category=category,
        visibility=visibility,
        start=NOW,
        end=NOW + 3600,
        all_day=False,
        description="",
        location="",
        url="",
        project=project,
        timezone="UTC",
        owner=owner,
        created_at=NOW,
        updated_at=NOW,
    )


def make_input(
    category: Category,
    visibility: Visibility = "public",
    project: str | None = None,
) -> EventInput:
    return EventInput(
        title="An event",
        category=category,
        visibility=visibility,
        start=NOW,
        end=NOW + 3600,
        all_day=False,
        project=project,
    )


ANONYMOUS = None
ALL_PERSONAS = [None, "alice", "bob", "carol", "dave"]


def as_session(name: str | None) -> ClientSession | None:
    return None if name is None else session_for(name)


class TestSessionHelpers:
    def test_anonymous(self) -> None:
        assert uid_of(None) is None
        assert not is_member(None)
        assert committees_of(None) == set()
        assert projects_of(None) == set()

    def test_member_flag(self) -> None:
        assert is_member(session_for("carol"))
        assert not is_member(session_for("alice"))

    def test_committee_membership_implies_project_membership(self) -> None:
        # Bob is on the httpd committee, so httpd is writable for him even if
        # the committer list were empty.
        session = ClientSession({"uid": "bob", "pmcs": ["httpd"], "projects": []})
        assert projects_of(session) == {"httpd"}

    def test_names_are_lowercased(self) -> None:
        session = ClientSession({"uid": "x", "pmcs": ["HTTPD"], "projects": ["Tomcat "]})
        assert committees_of(session) == {"httpd"}
        assert projects_of(session) == {"httpd", "tomcat"}

    def test_a_bare_string_is_accepted(self) -> None:
        session = ClientSession({"uid": "x", "pmcs": "httpd", "projects": ""})
        assert committees_of(session) == {"httpd"}


class TestPersonalEvents:
    @pytest.mark.parametrize("persona", ALL_PERSONAS)
    def test_only_the_owner_can_see_it(self, persona: str | None) -> None:
        event = make_event("personal", "private", owner="alice")
        assert can_view(event, as_session(persona)) is (persona == "alice")

    @pytest.mark.parametrize("persona", ALL_PERSONAS)
    def test_only_the_owner_can_change_it(self, persona: str | None) -> None:
        event = make_event("personal", "private", owner="alice")
        assert can_write(event, as_session(persona)) is (persona == "alice")

    def test_anyone_logged_in_may_create_their_own(self) -> None:
        assert can_write(make_input("personal", "private"), session_for("dave"))
        assert not can_write(make_input("personal", "private"), ANONYMOUS)


class TestPublicProjectEvents:
    @pytest.mark.parametrize("persona", ALL_PERSONAS)
    def test_everyone_can_see_them(self, persona: str | None) -> None:
        event = make_event("project", "public", project="httpd")
        assert can_view(event, as_session(persona)) is True

    @pytest.mark.parametrize(
        ("persona", "allowed"),
        [(None, False), ("alice", True), ("bob", True), ("carol", False), ("dave", False)],
    )
    def test_only_project_members_can_change_them(self, persona: str | None, allowed: bool) -> None:
        event = make_event("project", "public", project="httpd")
        assert can_write(event, as_session(persona)) is allowed

    def test_membership_is_per_project(self) -> None:
        alice = session_for("alice")  # httpd + tomcat
        assert can_write(make_event("project", "public", project="tomcat"), alice)
        assert not can_write(make_event("project", "public", project="maven"), alice)

    def test_authorship_does_not_matter(self) -> None:
        # Any project member may edit any of the project's events, not only
        # the ones they created.
        event = make_event("project", "public", project="httpd", owner="someone-else")
        assert can_write(event, session_for("alice"))


class TestPrivateProjectEvents:
    @pytest.mark.parametrize(
        ("persona", "allowed"),
        [(None, False), ("alice", False), ("bob", True), ("carol", False), ("dave", False)],
    )
    def test_only_the_committee_can_see_them(self, persona: str | None, allowed: bool) -> None:
        event = make_event("project", "private", project="httpd")
        assert can_view(event, as_session(persona)) is allowed

    @pytest.mark.parametrize(
        ("persona", "allowed"),
        [(None, False), ("alice", False), ("bob", True), ("carol", False), ("dave", False)],
    )
    def test_only_the_committee_can_change_them(self, persona: str | None, allowed: bool) -> None:
        event = make_event("project", "private", project="httpd")
        assert can_write(event, as_session(persona)) is allowed

    def test_being_a_committer_is_not_enough(self) -> None:
        # Alice is a committer on httpd but not on the committee.
        assert not can_view(make_event("project", "private", project="httpd"), session_for("alice"))

    def test_foundation_membership_grants_no_project_access(self) -> None:
        # Carol is a member and on the tomcat committee, but not httpd's.
        assert not can_view(make_event("project", "private", project="httpd"), session_for("carol"))
        assert can_view(make_event("project", "private", project="tomcat"), session_for("carol"))

    def test_an_event_without_a_project_is_not_viewable(self) -> None:
        assert not can_view(make_event("project", "private", project=None), session_for("bob"))
        assert not can_write(make_event("project", "private", project=None), session_for("bob"))


class TestFoundationEvents:
    @pytest.mark.parametrize("persona", ALL_PERSONAS)
    def test_public_ones_are_visible_to_everyone(self, persona: str | None) -> None:
        assert can_view(make_event("foundation", "public"), as_session(persona)) is True

    @pytest.mark.parametrize(
        ("persona", "allowed"),
        [(None, False), ("alice", False), ("bob", False), ("carol", True), ("dave", False)],
    )
    def test_private_ones_need_membership(self, persona: str | None, allowed: bool) -> None:
        assert can_view(make_event("foundation", "private"), as_session(persona)) is allowed

    @pytest.mark.parametrize(
        ("persona", "allowed"),
        [(None, False), ("alice", False), ("bob", False), ("carol", True), ("dave", False)],
    )
    @pytest.mark.parametrize("visibility", ["public", "private"])
    def test_only_members_may_write(self, persona: str | None, allowed: bool, visibility: Visibility) -> None:
        assert can_write(make_event("foundation", visibility), as_session(persona)) is allowed

    def test_being_a_chair_is_not_membership(self) -> None:
        chair = ClientSession({"uid": "chair", "isChair": True, "pmcs": ["httpd"], "projects": ["httpd"]})
        assert not can_write(make_event("foundation", "public"), chair)

    def test_a_truthy_non_true_member_flag_does_not_pass(self) -> None:
        # asfquart's Requirements.member insists on `is True`; we defer to it.
        odd = ClientSession({"uid": "odd", "isMember": "yes"})
        assert not is_member(odd)


class TestErrorMessages:
    def test_anonymous_write_is_401(self) -> None:
        with pytest.raises(PermissionDenied) as caught:
            check_write(make_input("foundation"), None)
        assert caught.value.status == 401

    def test_non_member_write_mentions_membership(self) -> None:
        with pytest.raises(PermissionDenied) as caught:
            check_write(make_input("foundation"), session_for("alice"))
        assert caught.value.status == 403
        assert "member" in caught.value.message.lower()

    def test_wrong_project_is_named(self) -> None:
        with pytest.raises(PermissionDenied) as caught:
            check_write(make_input("project", "public", "maven"), session_for("alice"))
        assert "maven" in caught.value.message

    def test_private_project_message_mentions_the_committee(self) -> None:
        with pytest.raises(PermissionDenied) as caught:
            check_write(make_input("project", "private", "httpd"), session_for("alice"))
        assert "committee" in caught.value.message

    def test_personal_message(self) -> None:
        with pytest.raises(PermissionDenied) as caught:
            check_write(make_event("personal", "private", owner="alice"), session_for("bob"))
        assert "owner" in caught.value.message

    def test_anonymous_view_is_401_but_logged_in_view_is_403(self) -> None:
        event = make_event("foundation", "private")
        with pytest.raises(PermissionDenied) as anon:
            check_view(event, None)
        assert anon.value.status == 401
        with pytest.raises(PermissionDenied) as logged_in:
            check_view(event, session_for("alice"))
        assert logged_in.value.status == 403

    def test_allowed_checks_do_not_raise(self) -> None:
        check_view(make_event("foundation", "public"), None)
        check_write(make_event("foundation", "public"), session_for("carol"))


class TestWriteImpliesView:
    """Anyone allowed to edit an event must also be allowed to read it."""

    @pytest.mark.parametrize(
        ("category", "visibility", "project"),
        [
            ("personal", "private", None),
            ("project", "public", "httpd"),
            ("project", "private", "httpd"),
            ("project", "public", "tomcat"),
            ("project", "private", "tomcat"),
            ("foundation", "public", None),
            ("foundation", "private", None),
        ],
    )
    @pytest.mark.parametrize("persona", ALL_PERSONAS)
    def test_matrix(self, category: Category, visibility: Visibility, project: str | None, persona: str | None) -> None:
        event = make_event(category, visibility, project=project, owner="alice")
        session = as_session(persona)
        if can_write(event, session):
            assert can_view(event, session), f"{persona} can write but not view {category}/{visibility}/{project}"


def test_every_combination_is_decided_without_error() -> None:
    """No combination of inputs should raise; every one gets a yes or a no."""
    categories: list[Category] = ["personal", "project", "foundation"]
    visibilities: list[Visibility] = ["public", "private"]
    projects = [None, "httpd", "tomcat", "maven"]
    for category, visibility, project, persona in itertools.product(categories, visibilities, projects, ALL_PERSONAS):
        event = make_event(category, visibility, project=project)
        session = as_session(persona)
        assert isinstance(can_view(event, session), bool)
        assert isinstance(can_write(event, session), bool)


class TestVisibleCalendars:
    def test_anonymous(self) -> None:
        summary = visible_calendars(None)
        assert summary["authenticated"] is False
        assert summary["projects"] == []
        assert summary["can_create"] == {
            "personal": False,
            "project": [],
            "project_private": [],
            "foundation": False,
        }

    def test_committer(self) -> None:
        summary = visible_calendars(session_for("alice"))
        assert summary["uid"] == "alice"
        assert summary["projects"] == ["httpd", "tomcat"]
        assert summary["committees"] == []
        assert summary["can_create"]["personal"] is True
        assert summary["can_create"]["foundation"] is False

    def test_member_on_a_committee(self) -> None:
        summary = visible_calendars(session_for("carol"))
        assert summary["is_member"] is True
        assert summary["can_create"]["foundation"] is True
        assert summary["can_create"]["project_private"] == ["tomcat"]
