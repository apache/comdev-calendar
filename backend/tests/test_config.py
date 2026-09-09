"""Configuration loading."""

from __future__ import annotations

import pathlib

import pytest

from asfcalendar import config as config_module


def test_defaults_when_file_is_missing(tmp_path: pathlib.Path) -> None:
    cfg = config_module.load(tmp_path / "nope.yaml")
    assert cfg.server.port == 8080
    assert cfg.app.title == "ASF Community Calendar"
    assert cfg.oauth_uri == "/auth"
    assert cfg.debug is False


def test_reads_yaml(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(
        """
server:
  host: 0.0.0.0
  port: 9001
  base_url: https://calendar.apache.org
database:
  path: /var/lib/calendar.sqlite3
app:
  title: Custom Title
  shortlink_prefix: /x
oauth:
  uri: /session
debug: true
""",
        encoding="utf-8",
    )
    cfg = config_module.load(path)
    assert cfg.server.host == "0.0.0.0"
    assert cfg.server.port == 9001
    assert cfg.app.title == "Custom Title"
    assert cfg.oauth_uri == "/session"
    assert cfg.debug is True
    assert cfg.database_path == pathlib.Path("/var/lib/calendar.sqlite3")


def test_unknown_keys_are_ignored(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text("server:\n  port: 8000\n  nonsense: yes\nspurious: 1\n", encoding="utf-8")
    cfg = config_module.load(path)
    assert cfg.server.port == 8000


def test_empty_file_is_fine(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text("", encoding="utf-8")
    assert config_module.load(path).server.port == 8080


def test_non_mapping_document_is_rejected(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text("- one\n- two\n", encoding="utf-8")
    with pytest.raises(ValueError):
        config_module.load(path)


def test_relative_paths_resolve_against_the_config_directory(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text("database:\n  path: data/cal.sqlite3\n", encoding="utf-8")
    cfg = config_module.load(path)
    assert cfg.database_path == tmp_path / "data" / "cal.sqlite3"


def test_shortlink_url_prefers_configured_base() -> None:
    cfg = config_module.from_dict({"server": {"base_url": "https://calendar.apache.org/"}})
    assert cfg.shortlink_url("AbCd2345", "http://localhost/") == "https://calendar.apache.org/e/AbCd2345"


def test_shortlink_url_falls_back_to_the_request_host() -> None:
    cfg = config_module.from_dict({})
    assert cfg.shortlink_url("AbCd2345", "http://localhost:8080/") == "http://localhost:8080/e/AbCd2345"


def test_default_display_zone_defaults_to_local() -> None:
    assert config_module.from_dict({}).app.default_display_zone == "local"


def test_default_display_zone_can_be_utc() -> None:
    cfg = config_module.from_dict({"app": {"default_display_zone": "utc"}})
    assert cfg.app.default_display_zone == "utc"


def test_an_unknown_display_zone_is_rejected() -> None:
    with pytest.raises(ValueError, match="default_display_zone"):
        config_module.from_dict({"app": {"default_display_zone": "Europe/Berlin"}})
