"""Configuration handling.

asfquart reads ``config.yaml`` from the application directory into ``app.cfg``
(an EasyDict). This module layers our defaults on top of whatever was found
there and turns the result into a plain, typed object so the rest of the code
does not have to deal with missing keys.
"""

from __future__ import annotations

import dataclasses
import pathlib
import re
import urllib.parse
from typing import Any

import yaml

CONFIG_FILENAME = "config.yaml"


@dataclasses.dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8080
    # Where the app is mounted in the URL space, if it is not at the root of
    # its host: "/calendar" to serve it at https://host/calendar/. Every route,
    # including the OAuth endpoint and the API, moves under it.
    base_path: str = ""
    # Public origin of the deployment, e.g. "https://calendar.apache.org".
    # Only the scheme and host are used; the path comes from base_path below,
    # so it does not matter whether you write the path here as well. Leave it
    # empty to take the origin from the incoming request instead, which is what
    # you want for local development.
    base_url: str = ""


@dataclasses.dataclass(frozen=True)
class DatabaseConfig:
    path: str = "calendar.sqlite3"


@dataclasses.dataclass(frozen=True)
class AppConfig:
    title: str = "ASF Community Calendar"
    # Directory holding the built Svelte frontend (vite build output).
    frontend_dist: str = "frontend/dist"
    # Which clock the calendar opens on for a visitor who has not chosen:
    # "local" for the browser's own timezone, "utc" for UTC. Individual
    # visitors can flip the switch and their choice is remembered.
    default_display_zone: str = "local"
    # Path prefix for event shortlinks, e.g. /e/AbCd1234
    shortlink_prefix: str = "/e"


DISPLAY_ZONES = ("local", "utc")

# A mount point is one or more path segments of unreserved URL characters.
BASE_PATH_RE = re.compile(r"^(/[A-Za-z0-9._~-]+)+$")


def normalise_base_path(value: str) -> str:
    """Tidies a configured mount point into "" or "/a/b" form."""
    trimmed = (value or "").strip().strip("/")
    if not trimmed:
        return ""
    candidate = f"/{trimmed}"
    if not BASE_PATH_RE.match(candidate):
        raise ValueError(f"server.base_path must be a simple URL path such as '/calendar', not {value!r}")
    return candidate


@dataclasses.dataclass(frozen=True)
class Config:
    server: ServerConfig = dataclasses.field(default_factory=ServerConfig)
    database: DatabaseConfig = dataclasses.field(default_factory=DatabaseConfig)
    app: AppConfig = dataclasses.field(default_factory=AppConfig)
    oauth_uri: str = "/auth"
    debug: bool = False
    # Directory the relative paths above are resolved against.
    root_dir: pathlib.Path = dataclasses.field(default_factory=pathlib.Path.cwd)

    def resolve(self, relative: str) -> pathlib.Path:
        """Resolves a possibly relative config path against the app root."""
        candidate = pathlib.Path(relative)
        if candidate.is_absolute():
            return candidate
        return self.root_dir / candidate

    @property
    def database_path(self) -> pathlib.Path:
        return self.resolve(self.database.path)

    @property
    def frontend_dist_path(self) -> pathlib.Path:
        return self.resolve(self.app.frontend_dist)

    @property
    def base_path(self) -> str:
        """The mount point, with no trailing slash. Empty at the root."""
        return self.server.base_path

    def url_path(self, path: str) -> str:
        """A route or URL path with the mount point in front of it.

        url_path("/api") is "/api" at the root and "/calendar/api" when mounted
        at /calendar. url_path("/") is "/" and "/calendar/" respectively.
        """
        suffix = path if path.startswith("/") else f"/{path}"
        return suffix if not self.base_path else f"{self.base_path}{suffix}"

    def shortlink_path(self, token: str) -> str:
        return self.url_path(f"{self.app.shortlink_prefix.rstrip('/')}/{token}")

    def origin(self, fallback: str = "") -> str:
        """The scheme and host to hang absolute URLs off, with no trailing slash.

        Any path in ``server.base_url`` is discarded: ``base_path`` is the
        authority on where the app lives, so writing the path in both places
        would otherwise produce /calendar/calendar/e/AbCd2345.
        """
        parsed = urllib.parse.urlsplit(self.server.base_url or fallback)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
        return (self.server.base_url or fallback).rstrip("/")

    def shortlink_url(self, token: str, fallback_base: str = "") -> str:
        """Absolute shortlink URL. ``fallback_base`` is used when the config
        does not pin an origin (typically ``request.host_url``)."""
        return f"{self.origin(fallback_base)}{self.shortlink_path(token)}"


def _section(raw: dict[str, Any], name: str) -> dict[str, Any]:
    value = raw.get(name)
    return value if isinstance(value, dict) else {}


def _pick(source: dict[str, Any], keys: dict[str, Any]) -> dict[str, Any]:
    """Returns only the keys we know about, so a stray config key is ignored
    rather than blowing up dataclass construction."""
    return {key: source[key] for key in keys if key in source and source[key] is not None}


def from_dict(raw: dict[str, Any] | None, root_dir: pathlib.Path | None = None) -> Config:
    """Builds a Config from a parsed YAML document. Missing keys use defaults."""
    raw = raw or {}
    server_raw = _pick(_section(raw, "server"), ServerConfig.__annotations__)
    if "base_path" in server_raw:
        server_raw["base_path"] = normalise_base_path(str(server_raw["base_path"]))
    server = ServerConfig(**server_raw)
    database = DatabaseConfig(**_pick(_section(raw, "database"), DatabaseConfig.__annotations__))
    app = AppConfig(**_pick(_section(raw, "app"), AppConfig.__annotations__))
    if app.default_display_zone not in DISPLAY_ZONES:
        raise ValueError(f"app.default_display_zone must be one of {', '.join(DISPLAY_ZONES)}")
    oauth = _section(raw, "oauth")
    return Config(
        server=server,
        database=database,
        app=app,
        oauth_uri=str(oauth.get("uri", "/auth")),
        debug=bool(raw.get("debug", False)),
        root_dir=root_dir or pathlib.Path.cwd(),
    )


def load(path: pathlib.Path) -> Config:
    """Reads a YAML config file. A missing file is not an error; the defaults
    are perfectly usable for local development."""
    if not path.is_file():
        return from_dict({}, root_dir=path.parent)
    with open(path, encoding="utf-8") as handle:
        parsed = yaml.safe_load(handle)
    if parsed is not None and not isinstance(parsed, dict):
        raise ValueError(f"{path} must contain a YAML mapping at the top level")
    return from_dict(parsed, root_dir=path.parent)
