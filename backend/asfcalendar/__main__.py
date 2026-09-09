"""Command line entry point: ``uv run asf-calendar``.

The app is served with hypercorn, which is the ASGI server asfquart itself
suggests. ``--reload`` hands over to hypercorn's multiprocess runner, which is
where its reloader lives; the plain path runs the app in this process.

asfquart also offers ``app.runx()``, which adds its own file watcher. We do not
use it here: asfquart 0.1.12's reload path calls ``quart.utils.restart()``,
which newer Quart releases renamed, so the process dies the first time a file
changes. Hypercorn's reloader does the same job without that problem.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import pathlib
import sys

import hypercorn.run
from hypercorn.asyncio import serve
from hypercorn.config import Config as HypercornConfig

from .app import CONFIG_ENV_VAR, create_app, repository_root
from .config import CONFIG_FILENAME, Config, load

# How the reloader's worker processes find the application again.
APPLICATION_PATH = "asfcalendar.app:create_app()"

LOGGER = logging.getLogger("asfcalendar")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="asf-calendar", description="Run the ASF Community Calendar backend")
    parser.add_argument(
        "-c",
        "--config",
        type=pathlib.Path,
        default=None,
        help=f"path to the YAML config file (default: {CONFIG_FILENAME} in the repository root)",
    )
    parser.add_argument("--host", default=None, help="address to bind to (overrides the config file)")
    parser.add_argument("--port", type=int, default=None, help="port to bind to (overrides the config file)")
    parser.add_argument("--reload", action="store_true", help="restart when a source file changes")
    parser.add_argument("--debug", action="store_true", help="enable Quart debug mode")
    parser.add_argument("-v", "--verbose", action="store_true", help="log at DEBUG level")
    parser.add_argument("--access-log", action="store_true", help="log every request to stdout")
    return parser


def hypercorn_config(cfg: Config, host: str, port: int, *, reload: bool, access_log: bool) -> HypercornConfig:
    config = HypercornConfig()
    config.bind = [f"{host}:{port}"]
    config.accesslog = "-" if access_log else None
    config.errorlog = "-"
    if reload:
        # hypercorn only reloads from its multiprocess runner, which reimports
        # the app by path in each worker rather than being handed an instance.
        config.use_reloader = True
        config.workers = 1
        config.application_path = APPLICATION_PATH
    return config


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )

    config_path = args.config or (repository_root() / CONFIG_FILENAME)
    if not config_path.is_file():
        LOGGER.warning(
            "No config file at %s; using built-in defaults. Copy config.yaml.example to config.yaml "
            "to change anything.",
            config_path,
        )
    cfg = load(config_path)

    host = args.host or cfg.server.host
    port = args.port or cfg.server.port
    LOGGER.info("Starting %s on http://%s:%d", cfg.app.title, host, port)
    if not cfg.frontend_dist_path.is_file() and not (cfg.frontend_dist_path / "index.html").is_file():
        LOGGER.warning(
            "No frontend build at %s. Run 'npm ci && npm run build' in frontend/, or use the Vite dev server.",
            cfg.frontend_dist_path,
        )

    server_config = hypercorn_config(cfg, host, port, reload=args.reload, access_log=args.access_log)
    try:
        if args.reload:
            # The worker processes build their own app, so point them at the
            # same config file we just read.
            os.environ[CONFIG_ENV_VAR] = str(config_path)
            hypercorn.run.run(server_config)
        else:
            app = create_app(config=cfg)
            app.debug = args.debug or cfg.debug
            asyncio.run(serve(app, server_config))
    except KeyboardInterrupt:
        LOGGER.info("Shutting down.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
