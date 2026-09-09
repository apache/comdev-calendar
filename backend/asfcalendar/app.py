"""Application factory.

Builds the asfquart app: the JSON API, the shortlink handler and, in
production, the built Svelte frontend served as static files.
"""

from __future__ import annotations

import html
import logging
import os
import pathlib
from typing import Any

import asfquart
import asfquart.auth
import asfquart.generics
import asfquart.session
import quart

from . import __version__
from .api import create_blueprint, current_session
from .config import CONFIG_FILENAME, Config, load
from .models import Event
from .permissions import can_view
from .shortlink import is_valid as shortlink_is_valid
from .storage import Storage

LOGGER = logging.getLogger("asfcalendar")

APP_ID = "asf-community-calendar"

# Lets the hypercorn reloader, which re-imports the app in a fresh process,
# find the same config file the parent was started with.
CONFIG_ENV_VAR = "ASF_CALENDAR_CONFIG"

# Shown instead of the SPA when there is no build in frontend/dist. It is easy
# to forget the frontend build, and a blank page is a poor way to find out.
NO_BUILD_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ASF Community Calendar</title></head>
<body style="font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 40rem;">
<h1>ASF Community Calendar</h1>
<p>The backend is running, but no frontend build was found at
<code>{dist}</code>.</p>
<p>Either build it:</p>
<pre>cd frontend &amp;&amp; npm ci &amp;&amp; npm run build</pre>
<p>or run the Vite dev server, which proxies the API back to this process:</p>
<pre>cd frontend &amp;&amp; npm run dev</pre>
<p>The API itself is available under <a href="/api/healthz">/api</a>.</p>
</body></html>
"""


def repository_root() -> pathlib.Path:
    """The directory holding config.yaml, i.e. the checkout root."""
    return pathlib.Path(__file__).resolve().parents[2]


class IndexPage:
    """Reads frontend/dist/index.html, re-reading it when it changes."""

    def __init__(self, dist: pathlib.Path):
        self.path = dist / "index.html"
        self._cached: str | None = None
        self._mtime: float = -1.0

    def read(self) -> str | None:
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            self._cached, self._mtime = None, -1.0
            return None
        if self._cached is None or mtime != self._mtime:
            self._cached = self.path.read_text(encoding="utf-8")
            self._mtime = mtime
        return self._cached


def meta_tags(event: Event, url: str) -> str:
    """OpenGraph tags so a pasted shortlink unfurls with the event title."""
    title = html.escape(event.title, quote=True)
    description = html.escape((event.description or "").strip()[:300], quote=True)
    return (
        f'<meta property="og:type" content="website">'
        f'<meta property="og:title" content="{title}">'
        f'<meta property="og:description" content="{description}">'
        f'<meta property="og:url" content="{html.escape(url, quote=True)}">'
        f'<meta name="twitter:card" content="summary">'
    )


def inject_head(document: str, extra: str) -> str:
    """Inserts markup just before </head>, or leaves the document alone."""
    marker = "</head>"
    index = document.lower().find(marker)
    if index < 0:
        return document
    return document[:index] + extra + document[index:]


def create_app(
    config_path: pathlib.Path | str | None = None,
    *,
    config: Config | None = None,
    storage: Storage | None = None,
    testing: bool = False,
    token_file: str | None = "apptoken.txt",
) -> Any:
    """Constructs the Quart application.

    Arguments:
        config_path: path to config.yaml. Defaults to the repository root.
        config: a ready-made Config, which wins over config_path (used by tests).
        storage: a ready-made Storage, otherwise one is built from the config.
        testing: relaxes the secure-cookie requirement so the Quart test client
            can carry a session over plain http.
        token_file: where asfquart persists the session signing key. Pass None
            to keep it in memory only.
    """
    root = repository_root()
    if config is None:
        if config_path is None:
            config_path = os.environ.get(CONFIG_ENV_VAR) or (root / CONFIG_FILENAME)
        config = load(pathlib.Path(config_path))
    cfg = config

    # legacy OAuth, to be changed to OIDC once wired in
    import asfquart.generics
    asfquart.generics.OAUTH_URL_INIT = "https://oauth.apache.org/auth?state=%s&redirect_uri=%s"
    asfquart.generics.OAUTH_URL_CALLBACK = "https://oauth.apache.org/token?code=%s"

    app: quart.Quart = asfquart.construct(
        APP_ID,
        app_dir=str(cfg.root_dir),
        oauth=cfg.oauth_uri,
        force_login=True,
        token_file=token_file,
    )
    app.cfg.update({"calendar": cfg})  # type: ignore[attr-defined]

    if testing:
        app.config["TESTING"] = True
        app.config["SESSION_COOKIE_SECURE"] = False
        app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    store = storage or Storage(cfg.database_path)
    app.calendar_config = cfg  # type: ignore[attr-defined]
    app.calendar_storage = store  # type: ignore[attr-defined]

    @app.before_serving
    async def _open_storage() -> None:
        await store.connect()
        LOGGER.info("ASF Community Calendar %s using database %s", __version__, cfg.database_path)

    @app.after_serving
    async def _close_storage() -> None:
        await store.close()

    app.register_blueprint(create_blueprint(cfg, store))

    dist = cfg.frontend_dist_path
    index = IndexPage(dist)

    def _no_build() -> quart.Response:
        return quart.Response(NO_BUILD_PAGE.format(dist=html.escape(str(dist))), status=503, content_type="text/html")

    async def _send_index(extra_head: str = "") -> quart.Response:
        document = index.read()
        if document is None:
            return _no_build()
        if extra_head:
            document = inject_head(document, extra_head)
        return quart.Response(
            document,
            content_type="text/html; charset=utf-8",
            headers={"Cache-Control": "no-cache"},
        )

    @app.route("/")
    async def home() -> quart.Response:
        return await _send_index()

    shortlink_prefix = cfg.app.shortlink_prefix.rstrip("/")

    @app.route(f"{shortlink_prefix}/<token>")
    async def shortlink_page(token: str) -> quart.Response:
        """Shortlink landing page.

        We always serve the SPA, which fetches the event itself and can show a
        login prompt if needed. The OpenGraph tags are only added for events
        that anyone may read, so private titles do not leak to link previews.
        """
        if not shortlink_is_valid(token):
            return quart.Response("Not a valid shortlink.", status=404, content_type="text/plain; charset=utf-8")
        event = await store.get_by_shortlink(token)
        extra = ""
        if event is not None and can_view(event, None):
            url = cfg.shortlink_url(token, fallback_base=quart.request.host_url)
            extra = meta_tags(event, url)
        return await _send_index(extra)

    @app.route("/<path:requested>")
    async def static_or_spa(requested: str) -> quart.Response:
        """Serves a file from the frontend build, falling back to the SPA so
        client-side routes survive a page reload."""
        if requested.startswith("api/"):
            # An unknown /api route must not fall through to the SPA, or a
            # typo in a fetch() would come back as a page of HTML.
            return quart.Response('{"error": "Not found"}', status=404, content_type="application/json")
        if index.read() is None:
            return _no_build()
        try:
            target = (dist / requested).resolve()
            target.relative_to(dist.resolve())
        except (ValueError, OSError):
            return await _send_index()
        if target.is_file():
            return await quart.send_file(target)  # type: ignore[no-any-return]
        return await _send_index()

    @app.errorhandler(404)
    async def _not_found(_exception: Any) -> quart.Response:
        if quart.request.path.startswith("/api/"):
            return quart.Response('{"error": "Not found"}', status=404, content_type="application/json")
        return await _send_index()

    return app


__all__ = ["create_app", "current_session", "inject_head", "meta_tags", "repository_root"]
