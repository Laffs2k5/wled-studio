# SPDX-License-Identifier: EUPL-1.2
"""The REST API under /api."""
from __future__ import annotations

import hashlib
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from . import fxmeta, netcheck
from .devices import Device, DeviceStore
from .library import DeviceLists, LibraryStore, LookError, check_name, import_presets, resolve_look, segment_from_state
from .push import StateStore, push
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
    bm: int | None = Field(default=None, ge=0, le=31)

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


class LookSegment(BaseModel):
    model_config = ConfigDict(extra="allow")
    start: int = Field(ge=0, le=65535)
    stop: int = Field(ge=0, le=65535)
    effect: str | None = Field(default=None, max_length=64)
    palette: str | None = Field(default=None, max_length=64)


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


class PushIn(Strict):
    dry_run: bool = True
    adopt_drift: bool = False
    accept_review: bool = False


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


async def lists_for(client: WLEDClient) -> DeviceLists:
    return DeviceLists(await client.effects(), await client.fxdata(), await client.palettes())


def device_errors(e: Exception) -> HTTPException:
    if isinstance(e, WLEDLocked):
        return HTTPException(423, str(e))
    return HTTPException(502, str(e))


# --- routes ---------------------------------------------------------------------

@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/devices")
def list_devices(request: Request):
    ds = request.app.state.devices
    return [{"id": d.id, "name": d.name, "host": d.host, "has_pin": ds.pin(d.id) is not None} for d in ds.list()]


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
    return {"id": dev.id, "name": dev.name, "host": dev.host, "has_pin": body.pin is not None}


@router.delete("/devices/{device_id}", status_code=204)
def remove_device(device_id: str, request: Request):
    if not request.app.state.devices.remove(device_id):
        raise HTTPException(404, "no such device")


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
    fingerprint = hashlib.sha256(json.dumps([info.get("vid"), names, fxdata, pals]).encode()).hexdigest()
    leds = info.get("leds", {})
    return {
        "device": {"id": dev.id, "name": dev.name},
        "info": {k: info.get(k) for k in ("ver", "vid", "name", "brand", "product", "release", "arch")},
        "leds": {k: leds.get(k) for k in ("count", "rgbw", "maxseg", "matrix")},
        "usermods": sorted(k for k in (info.get("u") or {}) if isinstance(k, str) and not k.startswith("<")),
        "effects": fxmeta.parse_all(names, fxdata),
        "palettes": [{"id": i, "name": n} for i, n in enumerate(pals)],
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
            lists = await lists_for(c)
            presets = json.loads(await c.presets_text() or "{}")
        except (WLEDError, json.JSONDecodeError) as e:
            raise device_errors(e) from None
    looks, skipped = import_presets(presets, lists)
    data = lib.load()
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
    return {"imported": added, "kept_existing": kept, "skipped_presets": skipped}


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


@router.delete("/looks/{name}", status_code=204)
def delete_look(name: str, request: Request):
    if not request.app.state.library.delete(name):
        raise HTTPException(404, "no such look")


@router.post("/devices/{device_id}/capture/{name}")
async def capture(device_id: str, name: str, request: Request, preset_id: int | None = None):
    """Save what the device shows now as a look."""
    dev = device_or_404(device_id, request)
    try:
        name = check_name(name)
    except LookError as e:
        raise HTTPException(422, str(e)) from None
    if preset_id is not None and not 1 <= preset_id <= 250:
        raise HTTPException(422, "preset_id is 1-250")
    async with make_client(request, dev) as c:
        try:
            lists = await lists_for(c)
            st = await c.state()
        except WLEDError as e:
            raise device_errors(e) from None
    look: dict = {"name": name, "segments": [], "snapshot": {}, "imported_ids": {}}
    for k in ("on", "bri", "transition"):
        if k in st:
            look[k] = st[k]
    ar = st.get("AudioReactive")
    if isinstance(ar, dict) and "on" in ar:
        look["mic"] = bool(ar["on"])
    for seg in st.get("seg", []):
        s, fxname = segment_from_state(seg, lists)
        s.pop("n", None)
        look["segments"].append(s)
        if fxname is not None:
            look["snapshot"][fxname] = lists.meta(seg["fx"])
            look["imported_ids"][fxname] = seg["fx"]
    if preset_id is not None:
        look["preset_id"] = preset_id
    return request.app.state.library.put(look)


@router.post("/devices/{device_id}/apply/{name}")
async def apply_look(device_id: str, name: str, request: Request):
    """Show a look on the device now (live; nothing is saved on the device)."""
    dev = device_or_404(device_id, request)
    look = request.app.state.library.looks().get(name)
    if look is None:
        raise HTTPException(404, "no such look")
    async with make_client(request, dev) as c:
        try:
            r = resolve_look(look, await lists_for(c), look.get("imported_ids"))
            if r.preset is None:
                raise HTTPException(409, {"status": r.status, "notes": r.notes})
            payload = {k: v for k, v in r.preset.items() if k != "n"}
            await c.set_state(payload)
        except WLEDError as e:
            raise device_errors(e) from None
    return {"status": r.status, "notes": r.notes}


@router.post("/devices/{device_id}/push")
async def push_looks(device_id: str, body: PushIn, request: Request):
    dev = device_or_404(device_id, request)
    looks = list(request.app.state.library.looks().values())
    async with make_client(request, dev) as c:
        try:
            res = await push(c, dev.id, looks, request.app.state.statestore, dry_run=body.dry_run,
                             adopt_drift=body.adopt_drift, accept_review=body.accept_review)
        except WLEDError as e:
            raise device_errors(e) from None
    return res.__dict__


@router.get("/devices/{device_id}/backups")
def backups(device_id: str, request: Request):
    device_or_404(device_id, request)
    return request.app.state.statestore.list_backups(device_id)


