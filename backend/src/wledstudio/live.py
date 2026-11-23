# SPDX-License-Identifier: EUPL-1.2
"""The device's live view, relayed to the browser: what the strip shows right now.

WLED serves its live view on its own websocket (/ws): after {"lv": true} it sends
binary frames: 'L', version 1, then R, G, B per LED (white folded into RGB; every
n-th LED above 1024). It serves one live-view client at a time, so the backend
keeps one connection per device (a hub) and fans the frames out to any number of
browser tabs; the connection opens with the first viewer and closes after the last.

The browser side (/api/devices/<id>/live) has the same handshake checks as the
stream endpoint (Host, Origin, token as subprotocol).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging

import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .netcheck import split_host
from .stream import _allowed, _protocols

log = logging.getLogger(__name__)
router = APIRouter()


class Hub:
    """One device connection, many viewers."""

    def __init__(self, url: str):
        self.url = url
        self.viewers: set[asyncio.Queue] = set()
        self.task: asyncio.Task | None = None

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=4)
        self.viewers.add(q)
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._run())
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.viewers.discard(q)
        if not self.viewers and self.task is not None:
            self.task.cancel()

    async def _run(self) -> None:
        try:
            async with websockets.connect(self.url, open_timeout=5, max_size=1 << 16) as dev:
                await dev.send(json.dumps({"lv": True}))
                async for msg in dev:
                    if isinstance(msg, (bytes, bytearray)) and len(msg) > 2 and msg[0] == ord("L"):
                        for q in list(self.viewers):
                            if q.full():
                                with contextlib.suppress(asyncio.QueueEmpty):
                                    q.get_nowait()  # drop the oldest frame for slow viewers
                            q.put_nowait(bytes(msg))
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - tell the viewers, then stop
            log.info("live view of %s ended: %s", self.url, e.__class__.__name__)
            for q in list(self.viewers):
                with contextlib.suppress(asyncio.QueueFull):
                    q.put_nowait(None)


def hub_for(app, dev) -> Hub:
    hubs = app.state.live_hubs
    url = app.state.live_url_for(dev)
    if url not in hubs:
        hubs[url] = Hub(url)
    return hubs[url]


def default_live_url(dev) -> str:
    host, port = split_host(dev.host)
    shown = f"[{host}]" if ":" in host else host
    return f"ws://{shown}{':' + str(port) if port else ''}/ws"


@router.websocket("/api/devices/{device_id}/live")
async def live(ws: WebSocket, device_id: str):
    reason = _allowed(ws)
    dev = ws.app.state.devices.get(device_id)
    if reason or dev is None:
        await ws.close(code=1008, reason=reason or "no such device")
        return
    await ws.accept(subprotocol="wledstudio" if "wledstudio" in _protocols(ws) else None)
    hub = hub_for(ws.app, dev)
    q = hub.subscribe()

    async def watch_close():
        with contextlib.suppress(WebSocketDisconnect):
            while True:
                await ws.receive()

    closer = asyncio.create_task(watch_close())
    try:
        while not closer.done():
            getter = asyncio.create_task(q.get())
            done, _ = await asyncio.wait({getter, closer}, return_when=asyncio.FIRST_COMPLETED)
            if getter not in done:
                getter.cancel()
                break
            frame = getter.result()
            if frame is None:
                await ws.close(code=1011, reason="the device's live view ended")
                break
            await ws.send_bytes(frame)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        closer.cancel()
        hub.unsubscribe(q)
