"""Configuration handling.

asfquart reads ``config.yaml`` from the application directory into ``app.cfg``
(an EasyDict). This module layers our defaults on top of whatever was found
there and turns the result into a plain, typed object so the rest of the code
does not have to deal with missing keys.
"""

from __future__ import annotations

import dataclasses
import pathlib
from typing import Any

import yaml

CONFIG_FILENAME = "config.yaml"


@dataclasses.dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8080
    # Absolute base URL of the deployment, e.g. "https://calendar.apache.org".
    # Leave it empty to derive the base from the incoming request instead,
    # which is what you want for local development.
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

    def shortlink_path(self, token: str) -> str:
        return f"{self.app.shortlink_prefix.rstrip('/')}/{token}"

    def shortlink_url(self, token: str, fallback_base: str = "") -> str:
        """Absolute shortlink URL. ``fallback_base`` is used when the config
        does not pin a base URL (typically ``request.host_url``)."""
        base = (self.server.base_url or fallback_base).rstrip("/")
        return f"{base}{self.shortlink_path(token)}"


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
    server = ServerConfig(**_pick(_section(raw, "server"), ServerConfig.__annotations__))
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
