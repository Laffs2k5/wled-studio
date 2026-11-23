# SPDX-License-Identifier: EUPL-1.2
"""Editing sessions: the device's state when editing started, put back when it ends.

WLED's live state is shared with Home Assistant, remotes and playlists. An editing session
takes a snapshot of /json/state when it starts. Ending it with restore writes that state
back: segments with their effects and bounds, brightness, the mic. Segments added meanwhile
are deleted, and a playlist that was running is started again. Ending it without restore
keeps the edits.

Sessions live in memory, one per device, and are shared by everyone using the app (a second
start is refused while one runs). Restarting the app ends them without restoring.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from .library import SEG_CHECKS, SEG_PASSTHROUGH, SEG_SLIDERS

# what a segment is restored with: WLED's preset fields, by id, less the read-only "lc"
SEG_RESTORE = tuple(k for k in ("id", "fx", "pal") + SEG_PASSTHROUGH + SEG_SLIDERS + SEG_CHECKS if k != "lc")
TOP_RESTORE = ("on", "bri", "transition", "mainseg", "bs")


@dataclass
class Session:
    snapshot: dict
    started: float = field(default_factory=time.time)


def restore_payload(snapshot: dict, current: dict) -> dict:
    """The /json/state body that puts the device back as it was in the snapshot."""
    pl = snapshot.get("pl", -1)
    if isinstance(pl, int) and pl > 0:
        return {"ps": pl}  # a playlist was running: start it again, rather than freeze one of its looks
    segs = [{k: s[k] for k in SEG_RESTORE if k in s} for s in snapshot.get("seg", []) if isinstance(s, dict)]
    keep = {s.get("id") for s in segs}
    segs += [{"id": s["id"], "stop": 0} for s in current.get("seg", [])
             if isinstance(s, dict) and s.get("id") not in keep]
    body: dict = {k: snapshot[k] for k in TOP_RESTORE if k in snapshot}
    body["seg"] = segs
    ar = snapshot.get("AudioReactive")
    if isinstance(ar, dict) and "on" in ar:
        body["AudioReactive"] = {"enabled": bool(ar["on"])}
    return body


class Sessions:
    def __init__(self) -> None:
        self._by_device: dict[str, Session] = {}

    def get(self, device_id: str) -> Session | None:
        return self._by_device.get(device_id)

    def start(self, device_id: str, snapshot: dict) -> Session:
        s = Session(snapshot)
        self._by_device[device_id] = s
        return s

    def end(self, device_id: str) -> Session | None:
        return self._by_device.pop(device_id, None)
