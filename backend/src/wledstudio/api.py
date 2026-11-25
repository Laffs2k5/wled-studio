# SPDX-License-Identifier: EUPL-1.2
"""The REST API under /api."""
from __future__ import annotations

import hashlib
import json
import shutil
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from . import fxmeta, netcheck
from .devices import Device, DeviceStore
from .library import (DeviceLists, LibraryStore, LookError, accept_snapshot, check_library, check_name,
                      import_presets, mic_for,
                      playlist_from_preset, resolve_look, resolve_playlist, segment_from_state, tag_areas)
from .push import DuplicatePresetIds, StateStore, fetch_lists, push
from .session import SEG_RESTORE, Sessions, restore_payload
from .wled import WLEDClient, WLEDError, WLEDLocked

router = APIRouter(prefix="/api")

Byte = Annotated[int, Field(ge=0, le=255)]


# --- request models (extra fields are refused) ---------------------------------

class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DeviceIn(Strict):
    name: str = Field(min_length=1, max_length=64)
    host: str = Field(min_length=1, max_length=260)
    pin: SecretStr | None = Field(default=None, max_length=16)


class DeviceEditIn(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    host: str | None = Field(default=None, min_length=1, max_length=260)


class PinIn(Strict):
    pin: SecretStr | None = Field(default=None, max_length=16)


class SegmentState(Strict):
    id: int = Field(ge=0, le=31)
    start: int | None = Field(default=None, ge=0, le=65535)
    stop: int | None = Field(default=None, ge=0, le=65535)
    on: bool | None = None
    bri: Byte | None = None
    fx: int | None = Field(default=None, ge=0, le=254)
    sx: Byte | None = None
    ix: Byte | None = None
    c1: Byte | None = None
    c2: Byte | None = None
    c3: int | None = Field(default=None, ge=0, le=31)
    o1: bool | None = None
    o2: bool | None = None
    o3: bool | None = None
    pal: int | None = Field(default=None, ge=0, le=255)
    col: list[list[Byte]] | None = Field(default=None, max_length=3)
    rev: bool | None = None
    mi: bool | None = None
    n: str | None = Field(default=None, max_length=32, pattern=r"^[^\x00-\x1f]*$")
    frz: bool | None = None
    si: int | None = Field(default=None, ge=0, le=3)
    grp: int | None = Field(default=None, ge=1, le=255)
    spc: int | None = Field(default=None, ge=0, le=255)
    of: int | None = Field(default=None, ge=0, le=65535)
    bm: int | None = Field(default=None, ge=0, le=31)
    # WLED's other preset fields, so an imported look's segments can be edited and saved
    cct: int | None = Field(default=None, ge=0, le=10091)   # 0-255, or Kelvin
    set: int | None = Field(default=None, ge=0, le=3)
    sel: bool | None = None
    m12: int | None = Field(default=None, ge=0, le=4)
    startY: int | None = Field(default=None, ge=0, le=65535)
    stopY: int | None = Field(default=None, ge=0, le=65535)
    rY: bool | None = None
    mY: bool | None = None
    tp: bool | None = None
    lc: int | None = Field(default=None, ge=0, le=255)      # reported by WLED (light capabilities); ignored on input

    @field_validator("col")
    @classmethod
    def colours(cls, v):
        if v is not None and any(len(c) not in (3, 4) for c in v):
            raise ValueError("a colour is [r, g, b] or [r, g, b, w]")
        return v


class AudioState(Strict):
    enabled: bool


class LiveState(Strict):
    on: bool | None = None
    bri: Byte | None = None
    transition: int | None = Field(default=None, ge=0, le=65535)
    seg: list[SegmentState] | None = Field(default=None, max_length=32)
    AudioReactive: AudioState | None = None


class EditedLookIn(Strict):
    """A look edited in the app: its segments as device state (ids, not names)."""
    seg: list[SegmentState] = Field(min_length=1, max_length=64)
    on: bool | None = None
    bri: Byte | None = None
    transition: int | None = Field(default=None, ge=0, le=65535)
    owns_layout: bool = True      # deletes the device's other segments when shown
    ids: bool = True              # write segment ids (False keeps an id-less preset id-less)
    preset_id: int | None = Field(default=None, ge=1, le=250)
    keep_slot: bool = True        # keep the look's slot when preset_id isn't given


class LookSegment(BaseModel):
    model_config = ConfigDict(extra="allow")
    # optional: a look saved without the layout has segments without bounds
    start: int | None = Field(default=None, ge=0, le=65535)
    stop: int | None = Field(default=None, ge=0, le=65535)
    effect: str | None = Field(default=None, max_length=64)
    palette: str | None = Field(default=None, max_length=64)
    wall: str | None = Field(default=None, max_length=32)
    zone: str | None = Field(default=None, max_length=32)


class LookIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str
    preset_id: int | None = Field(default=None, ge=1, le=250)
    on: bool | None = None
    bri: Byte | None = None
    transition: int | None = Field(default=None, ge=0, le=65535)
    mic: bool | None = None
    segments: list[LookSegment] = Field(default_factory=list, max_length=32)
    snapshot: dict[str, str] = Field(default_factory=dict)
    folder: str | None = Field(default=None, max_length=40)   # library only


class PlaylistEntry(Strict):
    look: str = Field(min_length=1, max_length=64)
    duration: int = Field(default=100, ge=0, le=65530)    # tenths of a second; 0 = stay
    transition: int = Field(default=7, ge=0, le=65530)    # tenths of a second


class PlaylistIn(Strict):
    folder: str | None = Field(default=None, max_length=40)   # library only
    name: str
    preset_id: int | None = Field(default=None, ge=1, le=250)
    entries: list[PlaylistEntry] = Field(min_length=1, max_length=100)
    repeat: int = Field(default=0, ge=0, le=127)          # 0 = forever
    shuffle: bool = False
    end: str | None = Field(default=None, max_length=64)


class PaletteIn(Strict):
    name: str
    stops: list[list[int | str]] = Field(min_length=2, max_length=18)


class RoomEdge(Strict):
    direction: Literal["up", "right", "down", "left"]
    pixels: int = Field(ge=1, le=4096)
    label: str | None = Field(default=None, max_length=32)


class RoomZone(Strict):
    """A named LED range (stop exclusive): a door, a desk; looks follow it like a wall."""
    label: str = Field(min_length=1, max_length=32)
    start: int = Field(ge=0, le=4095)
    stop: int = Field(ge=1, le=4096)


class RoomIn(Strict):
    """The strip's shape: edges in LED index order, from the first LED; and named zones."""
    edges: list[RoomEdge] = Field(min_length=1, max_length=64)
    zones: list[RoomZone] = Field(default_factory=list, max_length=64)

    @field_validator("edges")
    @classmethod
    def total(cls, v):
        if sum(e.pixels for e in v) > 4096:
            raise ValueError("at most 4096 LEDs in a room model")
        return v

    @model_validator(mode="after")
    def zones_fit(self):
        total = sum(e.pixels for e in self.edges)
        walls = {e.label for e in self.edges if e.label}
        seen: set[str] = set()
        for z in self.zones:
            if not z.start < z.stop <= total:
                raise ValueError(f"zone {z.label!r}: start < stop <= {total} (the room's LEDs)")
            if z.label in walls or z.label in seen:
                raise ValueError(f"zone {z.label!r}: names must differ from each other and from the walls")
            seen.add(z.label)
        return self


class PushIn(Strict):
    dry_run: bool = True
    adopt_drift: bool = False
    # write looks whose effect changed ("review"): all of them, or the looks named
    accept_review: bool | list[Annotated[str, Field(max_length=64)]] = Field(default=False, max_length=500)


# --- dependencies ---------------------------------------------------------------

def stores(request: Request) -> tuple[DeviceStore, LibraryStore, StateStore]:
    return request.app.state.devices, request.app.state.library, request.app.state.statestore


def device_or_404(device_id: str, request: Request) -> Device:
    dev = request.app.state.devices.get(device_id)
    if dev is None:
        raise HTTPException(404, "no such device")
    return dev


def make_client(request: Request, dev: Device) -> WLEDClient:
    return WLEDClient(dev.base_url, pin=request.app.state.devices.pin(dev.id),
                      timeout=request.app.state.settings.device_timeout_s,
                      transport=request.app.state.transport_for(dev))


async def lists_for(client: WLEDClient, request: Request | None = None, device_id: str | None = None) -> DeviceLists:
    custom = request.app.state.statestore.custom_ids(device_id) if request is not None and device_id else {}
    return await fetch_lists(client, custom)


def room_for(request: Request, device_id: str) -> dict | None:
    """The device's room model, if one is saved."""
    p = request.app.state.settings.data_dir / "rooms" / f"{device_id}.json"
    return json.loads(p.read_text()) if p.exists() else None


def is_virtual(info: dict) -> bool:
    """A virtual WLED says so in /json/info: arch "virtual" (wled-studio-builder's virtual device)."""
    return info.get("arch") == "virtual"


def device_errors(e: Exception) -> HTTPException:
    if isinstance(e, WLEDLocked):
        return HTTPException(423, str(e))
    return HTTPException(502, str(e))


# --- routes ---------------------------------------------------------------------

@router.get("/health")
def health():
    return {"status": "ok"}


def device_view(ds: DeviceStore, d: Device) -> dict:
    return {"id": d.id, "name": d.name, "host": d.host, "has_pin": ds.pin(d.id) is not None, "virtual": d.virtual}


@router.get("/devices")
def list_devices(request: Request):
    ds = request.app.state.devices
    return [device_view(ds, d) for d in ds.list()]


@router.post("/devices", status_code=201)
def add_device(body: DeviceIn, request: Request):
    s = request.app.state.settings
    try:
        host = netcheck.check_device_host(body.host, s.allow_public_devices, request.app.state.resolver)
    except netcheck.HostError as e:
        raise HTTPException(422, str(e)) from None
    ds = request.app.state.devices
    dev = ds.add(body.name.strip(), host)
    if body.pin is not None:
        ds.set_pin(dev.id, body.pin.get_secret_value())
    return {"id": dev.id, "name": dev.name, "host": dev.host, "has_pin": body.pin is not None, "virtual": dev.virtual}


@router.patch("/devices/{device_id}")
def edit_device(device_id: str, body: DeviceEditIn, request: Request):
    """Change a device's name or address (checked as when adding). Nothing is sent to the device."""
    device_or_404(device_id, request)
    host = None
    if body.host is not None:
        s = request.app.state.settings
        try:
            host = netcheck.check_device_host(body.host, s.allow_public_devices, request.app.state.resolver)
        except netcheck.HostError as e:
            raise HTTPException(422, str(e)) from None
    name = body.name.strip() if body.name is not None else None
    if name == "":
        raise HTTPException(422, "the name can't be empty")
    ds = request.app.state.devices
    return device_view(ds, ds.update(device_id, name=name, host=host))


@router.delete("/devices/{device_id}", status_code=204)
def remove_device(device_id: str, request: Request):
    """Forget a device: the app's records of it go (its entry, PIN, set, room shape, the record of
    what the app last wrote and flashed, an open editing session). Nothing on the device changes,
    and the library's looks stay. Backups of its presets stay in the data folder."""
    if not request.app.state.devices.remove(device_id):
        raise HTTPException(404, "no such device")
    request.app.state.library.put_set(device_id, None)   # its set goes with it
    data = request.app.state.settings.data_dir
    (data / "rooms" / f"{device_id}.json").unlink(missing_ok=True)
    request.app.state.statestore.forget(device_id)
    request.app.state.sessions.end(device_id)
    flashes = data / "flashes" / device_id
    if flashes.is_dir():
        shutil.rmtree(flashes)


class SetIn(Strict):
    looks: list[str] | None = Field(default=None, max_length=500)       # None: everything
    playlists: list[str] = Field(default_factory=list, max_length=200)


class SetChangeIn(Strict):
    looks: list[str] = Field(default_factory=list, max_length=500)
    playlists: list[str] = Field(default_factory=list, max_length=200)


def _set_view(request: Request, device_id: str) -> dict:
    lib: LibraryStore = request.app.state.library
    s = lib.device_set(device_id)
    looks, playlists, notes = lib.for_device(device_id)
    return {"all": s is None, "looks": s["looks"] if s else [], "playlists": s["playlists"] if s else [], "brought": notes,
            "on_device": {"looks": [lk["name"] for lk in looks], "playlists": [pl["name"] for pl in playlists]}}


@router.get("/devices/{device_id}/set")
def get_set(device_id: str, request: Request):
    """Which looks and playlists go on this device: all (no set), or a chosen set. Taking a look
    out of a set doesn't delete its preset from the device; writing never deletes."""
    device_or_404(device_id, request)
    return _set_view(request, device_id)


@router.put("/devices/{device_id}/set")
def put_set(device_id: str, body: SetIn, request: Request):
    device_or_404(device_id, request)
    try:
        request.app.state.library.put_set(device_id, body.looks, body.playlists)
    except KeyError as e:
        raise HTTPException(404, f"no such item: {e.args[0]!r}") from None
    return _set_view(request, device_id)


@router.post("/devices/{device_id}/set/add")
def add_to_set(device_id: str, body: SetChangeIn, request: Request):
    """Copy looks and playlists to this device: into its set (a device without one has them)."""
    device_or_404(device_id, request)
    try:
        request.app.state.library.add_to_set(device_id, body.looks, body.playlists)
    except KeyError as e:
        raise HTTPException(404, f"no such item: {e.args[0]!r}") from None
    return _set_view(request, device_id)


@router.post("/devices/{device_id}/set/remove")
def remove_from_set(device_id: str, body: SetChangeIn, request: Request):
    """Take looks and playlists out of this device's set (from "all", the set becomes the rest)."""
    device_or_404(device_id, request)
    lib: LibraryStore = request.app.state.library
    s = lib.device_set(device_id)
    looks = s["looks"] if s else list(lib.looks())
    playlists = s["playlists"] if s else list(lib.playlists())
    lib.put_set(device_id, [n for n in looks if n not in body.looks], [n for n in playlists if n not in body.playlists])
    return _set_view(request, device_id)


@router.put("/devices/{device_id}/pin", status_code=204)
def set_pin(device_id: str, body: PinIn, request: Request):
    device_or_404(device_id, request)
    request.app.state.devices.set_pin(device_id, body.pin.get_secret_value() if body.pin else None)


@router.get("/devices/{device_id}/profile")
async def profile(device_id: str, request: Request):
    dev = device_or_404(device_id, request)
    async with make_client(request, dev) as c:
        try:
            info = await c.info()
            names, fxdata, pals = await c.effects(), await c.fxdata(), await c.palettes()
        except WLEDError as e:
            raise device_errors(e) from None
    request.app.state.devices.mark_virtual(dev.id, is_virtual(info))
    fingerprint = hashlib.sha256(json.dumps([info.get("vid"), names, fxdata, pals]).encode()).hexdigest()
    leds = info.get("leds", {})
    return {
        "device": {"id": dev.id, "name": dev.name},
        "info": {k: info.get(k) for k in ("ver", "vid", "name", "brand", "product", "release", "arch")},
        "leds": {k: leds.get(k) for k in ("count", "rgbw", "maxseg", "matrix")},
        "usermods": sorted(k for k in (info.get("u") or {}) if isinstance(k, str) and not k.startswith("<")),
        "effects": fxmeta.parse_all(names, fxdata),
        "palettes": [{"id": i, "name": n} for i, n in enumerate(pals)]
        + [{"id": pid, "name": n, "custom": True}
           for n, pid in sorted(request.app.state.statestore.custom_ids(dev.id).items(), key=lambda kv: -kv[1])],
        "fingerprint": fingerprint,
    }


@router.get("/devices/{device_id}/state")
async def get_state(device_id: str, request: Request):
    dev = device_or_404(device_id, request)
    async with make_client(request, dev) as c:
        try:
            return await c.state()
        except WLEDError as e:
            raise device_errors(e) from None


@router.post("/devices/{device_id}/state")
async def set_state(device_id: str, body: LiveState, request: Request):
    dev = device_or_404(device_id, request)
    payload = body.model_dump(exclude_none=True)
    async with make_client(request, dev) as c:
        try:
            await c.set_state(payload)
            return await c.state()
        except WLEDError as e:
            raise device_errors(e) from None


# where a segment sits; left out of a look that leaves the layout alone
LAYOUT_KEYS = ("start", "stop", "startY", "stopY", "grp", "spc", "of")


async def _segments(c: WLEDClient) -> list[dict]:
    st = await c.state()
    return sorted((s for s in st.get("seg", []) if isinstance(s, dict)), key=lambda s: s["id"])


def _settings(seg: dict) -> dict:
    """A segment's settings, without its id: what moving or duplicating it carries over."""
    return {k: seg[k] for k in SEG_RESTORE if k in seg and k != "id"}


@router.post("/devices/{device_id}/segments/{seg_id}/move")
async def move_segment(device_id: str, seg_id: int, request: Request, direction: Literal["up", "down"] = "up"):
    """Move a segment one place up (drawn later, over more) or down the stack. WLED draws
    segments in id order, so this swaps the two segments' settings; returns the new id."""
    dev = device_or_404(device_id, request)
    async with make_client(request, dev) as c:
        try:
            segs = await _segments(c)
            ids = [s["id"] for s in segs]
            if seg_id not in ids:
                raise HTTPException(404, "no such segment")
            k = ids.index(seg_id) + (1 if direction == "up" else -1)
            if not 0 <= k < len(segs):
                raise HTTPException(409, f"already at the {'top' if direction == 'up' else 'bottom'}")
            a, b = segs[ids.index(seg_id)], segs[k]
            await c.set_state({"seg": [{"id": a["id"], **_settings(b)}, {"id": b["id"], **_settings(a)}]})
        except WLEDError as e:
            raise device_errors(e) from None
    return {"id": b["id"]}


@router.post("/devices/{device_id}/segments/{seg_id}/duplicate")
async def duplicate_segment(device_id: str, seg_id: int, request: Request):
    """A copy of a segment, on top of the stack; returns its id."""
    dev = device_or_404(device_id, request)
    async with make_client(request, dev) as c:
        try:
            info = await c.info()
            segs = await _segments(c)
            src = next((s for s in segs if s["id"] == seg_id), None)
            if src is None:
                raise HTTPException(404, "no such segment")
            new_id = segs[-1]["id"] + 1  # above every visible segment (WLED appends or reuses that slot)
            if new_id >= int((info.get("leds") or {}).get("maxseg") or 32):
                raise HTTPException(409, "the device has no room for another segment")
            await c.set_state({"seg": [{"id": new_id, **_settings(src)}]})
        except WLEDError as e:
            raise device_errors(e) from None
    return {"id": new_id}


def session_info(s) -> dict:
    """Whether a session runs, since when, and what the strip showed when it started: the preset or
    playlist it was playing (WLED's ps/pl, else null) and its segments' effect ids."""
    if s is None:
        return {"active": False, "started": None, "showed": None}
    snap = s.snapshot
    pick = lambda k: snap[k] if isinstance(snap.get(k), int) and snap[k] > 0 else None  # noqa: E731
    return {"active": True, "started": s.started,
            "showed": {"preset": pick("ps"), "playlist": pick("pl"),
                       "fx": [seg["fx"] for seg in snap.get("seg", []) if isinstance(seg, dict) and isinstance(seg.get("fx"), int)]}}


@router.get("/devices/{device_id}/session")
def get_session(device_id: str, request: Request):
    device_or_404(device_id, request)
    return session_info(request.app.state.sessions.get(device_id))


@router.post("/devices/{device_id}/session")
async def start_session(device_id: str, request: Request):
    """Start editing: remember the device's state, to put it back when editing ends."""
    dev = device_or_404(device_id, request)
    sessions: Sessions = request.app.state.sessions
    if sessions.get(dev.id) is not None:
        raise HTTPException(409, "an editing session is already running on this device")
    async with make_client(request, dev) as c:
        try:
            snapshot = await c.state()
        except WLEDError as e:
            raise device_errors(e) from None
    return session_info(sessions.start(dev.id, snapshot))


@router.delete("/devices/{device_id}/session")
async def end_session(device_id: str, request: Request, restore: bool = True):
    """End editing; with restore (the default), put the device back as it was at the start."""
    dev = device_or_404(device_id, request)
    sessions: Sessions = request.app.state.sessions
    s = sessions.get(dev.id)
    if s is None:
        raise HTTPException(404, "no editing session on this device")
    if restore:
        async with make_client(request, dev) as c:
            try:
                await c.set_state(restore_payload(s.snapshot, await c.state()))
            except WLEDError as e:
                raise device_errors(e) from None  # the session stays, so it can be tried again
    sessions.end(dev.id)
    return {"restored": restore}


@router.get("/devices/{device_id}/presets")
async def get_presets(device_id: str, request: Request):
    dev = device_or_404(device_id, request)
    async with make_client(request, dev) as c:
        try:
            return json.loads(await c.presets_text() or "{}")
        except (WLEDError, json.JSONDecodeError) as e:
            raise device_errors(e) from None


@router.post("/devices/{device_id}/import")
async def import_from_device(device_id: str, request: Request, replace: bool = False):
    dev = device_or_404(device_id, request)
    lib: LibraryStore = request.app.state.library
    async with make_client(request, dev) as c:
        try:
            lists = await lists_for(c, request, dev.id)
            presets = json.loads(await c.presets_text() or "{}")
        except (WLEDError, json.JSONDecodeError) as e:
            raise device_errors(e) from None
    looks, skipped = import_presets(presets, lists)
    room = room_for(request, dev.id)
    for look in looks:
        tag_areas(look, room)
    data = lib.load()
    name_by_id = {lk["preset_id"]: lk["name"] for lk in looks}
    imported_playlists = []
    for pid in list(skipped):
        pl = playlist_from_preset(pid, presets[pid], name_by_id)
        if pl is not None and (pl["name"] not in data["playlists"] or replace):
            data["playlists"][pl["name"]] = pl
            imported_playlists.append(pl["name"])
            skipped.remove(pid)
    added, kept = [], []
    for look in looks:
        try:
            look["name"] = check_name(look["name"])
        except LookError:
            look["name"] = f"Preset {look['preset_id']}"
        if look["name"] in data["looks"] and not replace:
            kept.append(look["name"])
            continue
        look["source"] = {"device": dev.id}
        data["looks"][look["name"]] = look
        added.append(look["name"])
    lib.save(data)
    return {"imported": added, "kept_existing": kept, "imported_playlists": imported_playlists,
            "skipped_presets": skipped}


@router.get("/looks")
def list_looks(request: Request):
    return list(request.app.state.library.looks().values())


@router.put("/looks/{name}")
def put_look(name: str, body: LookIn, request: Request):
    look = body.model_dump(exclude_none=True)
    if look["name"] != name:
        raise HTTPException(422, "the name in the path and the body differ")
    try:
        return request.app.state.library.put(look)
    except LookError as e:
        raise HTTPException(422, str(e)) from None


class RenameIn(Strict):
    to: str = Field(min_length=1, max_length=64)


@router.post("/looks/{name}/rename")
def rename_look(name: str, body: RenameIn, request: Request):
    """Rename a look; playlists that use it follow. Its slot is unchanged, so the next write
    gives the preset the new name."""
    try:
        return request.app.state.library.rename_look(name, body.to)
    except KeyError:
        raise HTTPException(404, "no such look") from None
    except LookError as e:
        raise HTTPException(409 if "exists" in str(e) else 422, str(e)) from None


class PresetIdIn(Strict):
    preset_id: int | None = Field(ge=1, le=250)    # null: no preset id (the look stays in the library)


@router.put("/looks/{name}/preset-id")
def set_look_preset_id(name: str, body: PresetIdIn, request: Request):
    """Change a look's preset id, in the library only (the next write puts it there). An id another
    look or playlist has is accepted, and named in `shared_with`: the write refuses until one moves."""
    lib: LibraryStore = request.app.state.library
    try:
        look = lib.set_preset_id(name, body.preset_id)
    except KeyError:
        raise HTTPException(404, "no such look") from None
    shared = lib.preset_users(body.preset_id, but=name) if body.preset_id is not None else []
    return {"look": look, "shared_with": shared}


class FolderIn(Strict):
    names: list[str] = Field(min_length=1, max_length=500)
    folder: str | None = Field(default=None, max_length=40)


class OrderIn(Strict):
    names: list[str] = Field(max_length=1000)


class FolderRenameIn(Strict):
    from_: str = Field(alias="from", min_length=1, max_length=40)
    to: str | None = Field(default=None, max_length=40)


LibraryKind = Literal["looks", "playlists"]


@router.post("/library/{kind}/folder")
def set_folder(kind: LibraryKind, body: FolderIn, request: Request):
    """Put looks or playlists in a folder (none: `folder` null). Library only."""
    try:
        request.app.state.library.set_folder(kind, body.names, body.folder)
    except KeyError as e:
        raise HTTPException(404, f"no such item: {e.args[0]!r}") from None
    except LookError as e:
        raise HTTPException(422, str(e)) from None
    return {"moved": body.names, "folder": body.folder or None}


@router.post("/library/{kind}/order")
def set_order(kind: LibraryKind, body: OrderIn, request: Request):
    """The library's order of looks or playlists: every name, once. Library only."""
    try:
        return {"order": request.app.state.library.reorder(kind, body.names)}
    except LookError as e:
        raise HTTPException(422, str(e)) from None


@router.post("/library/folders/rename")
def rename_folder(body: FolderRenameIn, request: Request):
    """Rename a folder for looks and playlists alike; `to` null dissolves it."""
    try:
        moved = request.app.state.library.rename_folder(body.from_, body.to)
    except LookError as e:
        raise HTTPException(422, str(e)) from None
    if not moved:
        raise HTTPException(404, "no such folder")
    return {"moved": moved}


@router.delete("/looks/{name}", status_code=204)
def delete_look(name: str, request: Request):
    if not request.app.state.library.delete(name):
        raise HTTPException(404, "no such look")


@router.get("/playlists")
def list_playlists(request: Request):
    return list(request.app.state.library.playlists().values())


@router.put("/playlists/{name}")
def put_playlist(name: str, body: PlaylistIn, request: Request):
    pl = body.model_dump(exclude_none=True)
    if pl["name"] != name:
        raise HTTPException(422, "the name in the path and the body differ")
    try:
        return request.app.state.library.put_playlist(pl)
    except LookError as e:
        raise HTTPException(422, str(e)) from None


@router.delete("/playlists/{name}", status_code=204)
def delete_playlist(name: str, request: Request):
    if not request.app.state.library.delete_playlist(name):
        raise HTTPException(404, "no such playlist")


@router.get("/palettes")
def list_palettes(request: Request):
    return list(request.app.state.library.palettes().values())


@router.put("/palettes/{name}")
def put_palette(name: str, body: PaletteIn, request: Request):
    pal = body.model_dump()
    if pal["name"] != name:
        raise HTTPException(422, "the name in the path and the body differ")
    try:
        return request.app.state.library.put_palette(pal)
    except LookError as e:
        raise HTTPException(422, str(e)) from None


@router.delete("/palettes/{name}", status_code=204)
def delete_palette(name: str, request: Request):
    if not request.app.state.library.delete_palette(name):
        raise HTTPException(404, "no such palette")


@router.post("/devices/{device_id}/capture/{name}")
async def capture(device_id: str, name: str, request: Request, preset_id: int | None = None,
                  layout: bool = True):
    """Save what the device shows now as a look.

    layout=True (the default): the look owns the layout; showing it deletes other segments.
    layout=False: only effects, colours and settings are kept, without bounds, so the look
    applies to whatever segments the device has then (as WLED presets saved without bounds)."""
    dev = device_or_404(device_id, request)
    try:
        name = check_name(name)
    except LookError as e:
        raise HTTPException(422, str(e)) from None
    if preset_id is not None and not 1 <= preset_id <= 250:
        raise HTTPException(422, "the preset id must be 1-250")
    async with make_client(request, dev) as c:
        try:
            lists = await lists_for(c, request, dev.id)
            st = await c.state()
        except WLEDError as e:
            raise device_errors(e) from None
    # what the device shows is its whole layout, so the look deletes other segments when shown
    look = build_look(name, st, lists, bounds=layout, owns_layout=layout, room=room_for(request, dev.id))
    if preset_id is not None:
        look["preset_id"] = preset_id
    return request.app.state.library.put(look)


def build_look(name: str, st: dict, lists: DeviceLists, *, bounds: bool, owns_layout: bool,
               room: dict | None, ids: bool = True) -> dict:
    """A look from a device state (live, or edited in the app): effects and palettes by name,
    their metadata as a snapshot, walls and zones named, and the mic rule applied."""
    look: dict = {"name": name, "segments": [], "snapshot": {}, "imported_ids": {},
                  "clear_other_segments": owns_layout}
    for k in ("on", "bri", "transition", "bs", "mainseg"):  # as WLED's own preset save
        if k in st:
            look[k] = st[k]
    for seg in st.get("seg", []):
        s, fxname = segment_from_state(seg, lists)
        if not bounds:
            for k in LAYOUT_KEYS:
                s.pop(k, None)
        if not ids:
            s.pop("id", None)
        look["segments"].append(s)
        if fxname is not None:
            look["snapshot"][fxname] = lists.meta(seg["fx"])
            look["imported_ids"][fxname] = seg["fx"]
    if bounds:
        tag_areas(look, room)
    # the mic rule: on for looks made for sound, off for the rest (the device's current
    # mic state isn't part of the look)
    look["mic"] = mic_for(look, lists)
    return look


@router.get("/devices/{device_id}/looks/{name}/edit")
async def look_for_editing(device_id: str, name: str, request: Request):
    """A saved look as this device's state (ids, not names), for editing without showing it."""
    dev = device_or_404(device_id, request)
    look = request.app.state.library.looks().get(name)
    if look is None:
        raise HTTPException(404, "no such look")
    async with make_client(request, dev) as c:
        try:
            lists = await lists_for(c, request, dev.id)
        except WLEDError as e:
            raise device_errors(e) from None
    r = resolve_look(look, lists, look.get("imported_ids"), room_for(request, dev.id))
    if r.preset is None:
        raise HTTPException(409, {"status": r.status, "notes": r.notes})
    segs = [dict(s) for s in r.preset["seg"] if s != {"stop": 0}]
    had_ids = all("id" in s for s in segs)
    for i, s in enumerate(segs):
        s.setdefault("id", i)  # WLED: an entry without an id is its position
    state = {k: r.preset[k] for k in ("on", "bri", "transition") if k in r.preset}
    state["seg"] = segs
    return {"name": look["name"], "preset_id": look.get("preset_id"), "status": r.status, "notes": r.notes,
            "owns_layout": bool(look.get("clear_other_segments")), "ids": had_ids,
            "bounds": all("start" in s and "stop" in s for s in segs), "state": state}


@router.post("/devices/{device_id}/looks/{name}")
async def save_edited_look(device_id: str, name: str, body: EditedLookIn, request: Request):
    """Save a look edited in the app (not shown on the device), as capture would from the device."""
    dev = device_or_404(device_id, request)
    try:
        name = check_name(name)
    except LookError as e:
        raise HTTPException(422, str(e)) from None
    lib: LibraryStore = request.app.state.library
    old = lib.looks().get(name) or {}
    async with make_client(request, dev) as c:
        try:
            lists = await lists_for(c, request, dev.id)
        except WLEDError as e:
            raise device_errors(e) from None
    st = body.model_dump(exclude_none=True, include={"on", "bri", "transition", "seg"})
    segs = st["seg"]
    look = build_look(name, st, lists, bounds=all("start" in s and "stop" in s for s in segs),
                      owns_layout=body.owns_layout, room=room_for(request, dev.id), ids=body.ids)
    for k in ("bs", "ql", "mainseg"):  # the look's other preset settings, not edited here
        if k in old and k not in look:
            look[k] = old[k]
    # the mic rule applies to an edit only if the look had a mic setting or its effects changed,
    # so saving an imported look unchanged leaves its preset unchanged
    effects = lambda lk: [s.get("effect", s.get("effect_id")) for s in lk.get("segments", [])]  # noqa: E731
    if old and "mic" not in old and effects(old) == effects(look):
        look.pop("mic", None)
    if body.preset_id is not None:
        look["preset_id"] = body.preset_id
    elif body.keep_slot and old.get("preset_id") is not None:
        look["preset_id"] = old["preset_id"]
    if "source" in old:
        look["source"] = old["source"]
    return lib.put(look)


@router.post("/devices/{device_id}/apply/{name}")
async def apply_look(device_id: str, name: str, request: Request):
    """Show a look on the device now (live; nothing is saved on the device)."""
    dev = device_or_404(device_id, request)
    look = request.app.state.library.looks().get(name)
    if look is None:
        raise HTTPException(404, "no such look")
    async with make_client(request, dev) as c:
        try:
            r = resolve_look(look, await lists_for(c, request, dev.id), look.get("imported_ids"),
                             room_for(request, dev.id))
            if r.preset is None:
                raise HTTPException(409, {"status": r.status, "notes": r.notes})
            payload = {k: v for k, v in r.preset.items() if k != "n"}
            await c.set_state(payload)
        except WLEDError as e:
            raise device_errors(e) from None
    return {"status": r.status, "notes": r.notes}


@router.post("/devices/{device_id}/play/{name}")
async def play_playlist(device_id: str, name: str, request: Request):
    """Play a library playlist on the device now: its looks' presets, as stored on the device, in
    turn. Refused when a preset it plays isn't on the device as the library has it (write first).
    Sends only WLED's playlist object (preset ids and times); nothing is saved on the device."""
    dev = device_or_404(device_id, request)
    lib: LibraryStore = request.app.state.library
    pl = lib.playlists().get(name)
    if pl is None:
        raise HTTPException(404, "no such playlist")
    looks = lib.looks()
    r = resolve_playlist(pl, looks)
    if r.preset is None:
        raise HTTPException(409, {"status": r.status, "notes": r.notes})
    async with make_client(request, dev) as c:
        try:
            stored = json.loads(await c.presets_text() or "{}")
            missing = [f"preset {looks[e['look']]['preset_id']} (“{e['look']}”)" for e in pl["entries"]
                       if (stored.get(str(looks[e["look"]]["preset_id"])) or {}).get("n") != e["look"]]
            if missing:
                raise HTTPException(409, f"Not on {dev.name} yet: {', '.join(dict.fromkeys(missing))}. "
                                         "Write presets first, then show the playlist.")
            await c.set_state({"playlist": r.preset["playlist"]})
        except (WLEDError, json.JSONDecodeError) as e:
            raise device_errors(e) from None
    return {"status": r.status, "notes": r.notes}


@router.get("/devices/{device_id}/check")
async def check_looks(device_id: str, request: Request):
    """Each look's and playlist's change-check status against this device (reads only)."""
    dev = device_or_404(device_id, request)
    lib: LibraryStore = request.app.state.library
    async with make_client(request, dev) as c:
        try:
            lists = await lists_for(c, request, dev.id)
        except WLEDError as e:
            raise device_errors(e) from None
    looks, playlists, _ = lib.for_device(dev.id)
    return check_library(looks, playlists, lists, room_for(request, dev.id))


@router.post("/devices/{device_id}/accept/{name}")
async def accept_look(device_id: str, name: str, request: Request):
    """Accept the device's current version of the effects a look uses: a new snapshot,
    after which the look is ok on this device. Not for unavailable looks."""
    dev = device_or_404(device_id, request)
    lib: LibraryStore = request.app.state.library
    look = lib.looks().get(name)
    if look is None:
        raise HTTPException(404, "no such look")
    async with make_client(request, dev) as c:
        try:
            lists = await lists_for(c, request, dev.id)
        except WLEDError as e:
            raise device_errors(e) from None
    room = room_for(request, dev.id)
    before = resolve_look(look, lists, look.get("imported_ids"), room)
    if before.status == "unavailable":
        raise HTTPException(409, {"status": before.status, "notes": before.notes})
    saved = lib.put(accept_snapshot(look, lists))
    after = resolve_look(saved, lists, saved.get("imported_ids"), room)
    return {"look": saved, "status": after.status, "notes": after.notes, "accepted": before.notes}


@router.post("/devices/{device_id}/push")
async def push_looks(device_id: str, body: PushIn, request: Request):
    dev = device_or_404(device_id, request)
    looks, playlists, set_notes = request.app.state.library.for_device(dev.id)
    palettes = list(request.app.state.library.palettes().values())
    async with make_client(request, dev) as c:
        try:
            res = await push(c, dev.id, looks, request.app.state.statestore, dry_run=body.dry_run,
                             adopt_drift=body.adopt_drift, accept_review=body.accept_review, playlists=playlists,
                             palettes=palettes, room=room_for(request, dev.id))
        except DuplicatePresetIds as e:
            raise HTTPException(409, str(e)) from None
        except WLEDError as e:
            raise device_errors(e) from None
    return {**res.__dict__, "set_notes": set_notes}


@router.get("/devices/{device_id}/room")
def get_room(device_id: str, request: Request):
    device_or_404(device_id, request)
    return room_for(request, device_id)


@router.put("/devices/{device_id}/room")
def put_room(device_id: str, body: RoomIn, request: Request):
    device_or_404(device_id, request)
    d = request.app.state.settings.data_dir / "rooms"
    d.mkdir(parents=True, exist_ok=True)
    room = body.model_dump(exclude_none=True)
    if not room.get("zones"):
        room.pop("zones", None)  # stored as before when there are none
    (d / f"{device_id}.json").write_text(json.dumps(room, indent=1) + "\n")
    return room


@router.delete("/devices/{device_id}/room", status_code=204)
def delete_room(device_id: str, request: Request):
    device_or_404(device_id, request)
    (request.app.state.settings.data_dir / "rooms" / f"{device_id}.json").unlink(missing_ok=True)


@router.get("/devices/{device_id}/backups")
def backups(device_id: str, request: Request):
    device_or_404(device_id, request)
    return request.app.state.statestore.list_backups(device_id)


