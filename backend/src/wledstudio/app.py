# SPDX-License-Identifier: EUPL-1.2
"""The FastAPI application: the API, and the built web UI as static files."""
from __future__ import annotations

from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, netcheck
from .api import router
from .effects import router as effects_router
from .live import default_live_url
from .live import router as live_router
from .stream import router as stream_router
from .firmware import router as firmware_router
from .config import Settings
from .devices import DeviceStore
from .library import LibraryStore
from .push import StateStore
from .security import SecurityMiddleware


def default_ddp_target(dev) -> tuple[str, int]:
    """DDP goes to the device's host (without the HTTP port), UDP port 4048."""
    from .ddp import DDP_PORT
    host, _ = netcheck.split_host(dev.host)
    return host, DDP_PORT


def create_app(settings: Settings | None = None, transport_for=None, resolver=netcheck.resolve,
               builder_transport=None, ddp_target_for=default_ddp_target, live_url_for=default_live_url) -> FastAPI:
    """transport_for(device) -> an httpx transport, or None for real HTTP (tests inject fakes)."""
    s = settings or Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="wled-studio", version=__version__, docs_url=None, redoc_url=None,
                  openapi_url="/api/openapi.json")
    app.state.settings = s
    app.state.devices = DeviceStore(s.data_dir)
    app.state.library = LibraryStore(s.data_dir)
    app.state.statestore = StateStore(s.data_dir)
    app.state.transport_for = transport_for or (lambda dev: None)
    app.state.resolver = resolver
    app.state.builder_transport = builder_transport
    app.state.ddp_target_for = ddp_target_for
    app.state.live_url_for = live_url_for
    app.state.live_hubs = {}
    app.add_middleware(SecurityMiddleware, settings=s)
    app.include_router(router)
    app.include_router(firmware_router)
    app.include_router(effects_router)
    app.include_router(stream_router)
    app.include_router(live_router)

    static = s.static_dir
    if static is not None and (static / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            # the single-page app: real files from the build, index.html for everything else
            candidate = (static / path).resolve()
            if path and candidate.is_file() and static.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(static / "index.html")

    return app


def http_transport(dev) -> httpx.AsyncBaseTransport | None:  # pragma: no cover - real network
    return None
