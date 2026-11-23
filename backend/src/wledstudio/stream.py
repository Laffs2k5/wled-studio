# SPDX-License-Identifier: EUPL-1.2
"""Stream frames from the browser (the Effect studio's preview) to a device over DDP.

A websocket at /api/devices/<id>/stream takes binary messages: one byte for the
channel count (3 = RGB, 4 = RGBW), then the pixels. Each becomes one DDP frame.
WLED shows realtime data instead of its own effect while frames arrive, and goes
back to its effect a few seconds after they stop; on close the backend also tells
it so ("live": false).

HTTP middleware doesn't see websockets, so this endpoint checks the Host header,
the Origin (cross-site websocket hijacking) and the token itself. The token, if
set, comes as the subprotocol "bearer.<token>" (browsers can't set headers on a
websocket); the accepted subprotocol is "wledstudio".
"""
from __future__ import annotations

import hmac
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from . import ddp
from .security import host_allowed
from .wled import WLEDClient, WLEDError

router = APIRouter()
MAX_FPS = 60
MAX_PIXELS = 4096


def _protocols(ws: WebSocket) -> list[str]:
    """The subprotocols the client offered (from the scope; servers parse the header)."""
    return [p.strip() for p in ws.scope.get("subprotocols", [])]


def _allowed(ws: WebSocket) -> str | None:
    """None if the handshake may proceed, else the reason to refuse it."""
    s = ws.app.state.settings
    host = ws.headers.get("host", "")
    if not host_allowed(host, s.allowed_hosts):
        return "host not allowed"
    origin = ws.headers.get("origin")
    if origin is None or urlsplit(origin).netloc.lower() != host.lower():
        return "cross-origin websocket refused"
    if s.token is not None:
        given = next((p[7:] for p in _protocols(ws) if p.startswith("bearer.")), "")
        if not hmac.compare_digest(given.encode(), s.token.encode()):
            return "missing or wrong token"
    return None


@router.websocket("/api/devices/{device_id}/stream")
async def stream(ws: WebSocket, device_id: str):
    reason = _allowed(ws)
    dev = ws.app.state.devices.get(device_id)
    if reason or dev is None:
        await ws.close(code=1008, reason=reason or "no such device")
        return
    await ws.accept(subprotocol="wledstudio" if "wledstudio" in _protocols(ws) else None)
    host, port = ws.app.state.ddp_target_for(dev)
    sender = ddp.Sender(host, port)
    await sender.open()
    min_gap = 1.0 / MAX_FPS
    last = 0.0
    frames = 0
    try:
        while True:
            msg = await ws.receive_bytes()
            now = time.monotonic()
            if now - last < min_gap:
                continue  # over the frame-rate limit: drop
            if len(msg) < 4 or msg[0] not in (3, 4) or (len(msg) - 1) % msg[0] or (len(msg) - 1) // msg[0] > MAX_PIXELS:
                await ws.close(code=1003, reason="bad frame")
                return
            sender.send(msg[1:], msg[0])
            last = now
            frames += 1
    except WebSocketDisconnect:
        pass
    finally:
        sender.close()
        if frames:
            client = WLEDClient(dev.base_url, transport=ws.app.state.transport_for(dev))
            try:
                await client.set_state({"live": False})  # back to the device's own effect now
            except WLEDError:
                pass
            finally:
                await client.aclose()
