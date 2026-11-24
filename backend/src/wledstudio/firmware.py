# SPDX-License-Identifier: EUPL-1.2
"""Firmware jobs: a thin, validated proxy to wled-studio-builder's job service.

The builder runs the gate (docs/chain-of-trust.md in wled-studio-builder): a
stock build checked against the vendor image, a build with your usermods, a
comparison of the linker inputs, and a size check. Only the builder URL from
the configuration is ever contacted.
"""
from __future__ import annotations

import re
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

router = APIRouter(prefix="/api/firmware")
JOB_ID = re.compile(r"^[0-9a-f]{32}$")
Name = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]


PREVIEW_FILES = {"preview.mjs": "text/javascript; charset=utf-8", "preview.wasm": "application/wasm"}


class PreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    usermods: list[Name] = Field(min_length=1, max_length=8)


class JobIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pins: str = Field(pattern=r"^[A-Za-z0-9._-]{1,80}\.json$")
    target: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,64}$")
    usermods: list[Name] = Field(min_length=1, max_length=8)


def _client(request: Request) -> httpx.AsyncClient:
    s = request.app.state.settings
    if not s.builder_url:
        raise HTTPException(503, "no firmware builder configured (WLEDSTUDIO_BUILDER_URL)")
    headers = {"User-Agent": "wled-studio"}
    if s.builder_token:
        headers["Authorization"] = f"Bearer {s.builder_token}"
    return httpx.AsyncClient(base_url=s.builder_url.rstrip("/"), headers=headers, timeout=10.0,
                             transport=request.app.state.builder_transport, follow_redirects=False)


async def _call(request: Request, method: str, path: str, json=None):
    async with _client(request) as c:
        try:
            r = await c.request(method, path, json=json)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"firmware builder unreachable ({e.__class__.__name__})") from None
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail", r.text)
        except ValueError:
            detail = r.text
        raise HTTPException(r.status_code if r.status_code in (400, 404, 409) else 502, detail)
    return r


def _job_id(jid: str) -> str:
    if not JOB_ID.match(jid):
        raise HTTPException(404, "no such job")
    return jid


@router.get("/status")
async def status(request: Request):
    if not request.app.state.settings.builder_url:
        return {"enabled": False}
    r = await _call(request, "GET", "/health")
    return {"enabled": True, **r.json()}


@router.get("/targets")
async def targets(request: Request):
    return (await _call(request, "GET", "/targets")).json()


@router.get("/usermods")
async def usermods(request: Request):
    return (await _call(request, "GET", "/usermods")).json()


@router.get("/jobs")
async def jobs(request: Request):
    return (await _call(request, "GET", "/jobs")).json()


@router.post("/jobs", status_code=202)
async def submit(body: JobIn, request: Request):
    return (await _call(request, "POST", "/jobs", json=body.model_dump())).json()


@router.get("/jobs/{jid}")
async def job(jid: str, request: Request):
    return (await _call(request, "GET", f"/jobs/{_job_id(jid)}")).json()


@router.post("/previews", status_code=202)
async def submit_preview(body: PreviewIn, request: Request):
    """Compile your usermods to WebAssembly for the Effect studio's preview."""
    return (await _call(request, "POST", "/previews", json=body.model_dump())).json()


@router.get("/jobs/{jid}/preview/{name}")
async def preview_file(jid: str, name: str, request: Request):
    if name not in PREVIEW_FILES:
        raise HTTPException(404, "not found")
    r = await _call(request, "GET", f"/jobs/{_job_id(jid)}/preview/{name}")
    return Response(r.content, media_type=PREVIEW_FILES[name])


@router.get("/jobs/{jid}/log", response_class=PlainTextResponse)
async def log(jid: str, request: Request):
    return (await _call(request, "GET", f"/jobs/{_job_id(jid)}/log")).text


# --- preflight: the library against a built image's effects ------------------------

def effect_lists(manifest: object) -> tuple[list[str], list[str]]:
    """A builder's effects.json -> (names, metadata) by effect id. Checked, since it comes from
    another service: ids 0-254, names and metadata strings of sane length."""
    if not isinstance(manifest, dict) or not isinstance(manifest.get("effects"), list):
        raise HTTPException(502, "the builder's effect list isn't in the expected shape")
    effects = [e for e in manifest["effects"] if isinstance(e, dict)
               and isinstance(e.get("id"), int) and 0 <= e["id"] <= 254
               and isinstance(e.get("name"), str) and len(e["name"]) <= 64
               and isinstance(e.get("meta"), str) and len(e["meta"]) <= 512]
    if not effects:
        raise HTTPException(502, "the builder's effect list is empty")
    size = max(e["id"] for e in effects) + 1
    names, metas = ["RSVD"] * size, [""] * size
    for e in effects:
        names[e["id"]], metas[e["id"]] = e["name"], e["meta"]
    return names, metas


@router.get("/jobs/{jid}/preflight")
async def preflight(jid: str, device: str, request: Request):
    """The library checked against a gate job's custom image, for one device: each look's and
    playlist's status today and if that image were flashed. Reads only."""
    from .api import device_errors, device_or_404, make_client
    from .push import fetch_lists
    from .wled import WLEDError

    names, metas = effect_lists((await _call(request, "GET", f"/jobs/{_job_id(jid)}/effects.json")).json())
    dev = device_or_404(device, request)
    async with make_client(request, dev) as c:
        try:
            today = await fetch_lists(c, request.app.state.statestore.custom_ids(dev.id))
        except WLEDError as e:
            raise device_errors(e) from None
    rows, counts = compare_library(request, dev.id, today, names, metas)
    return {"job": jid, "device": dev.id, "effects": sum(1 for n in names if "RSVD" not in n),
            "counts": counts, "rows": rows}


def compare_library(request: Request, device_id: str, today, names: list[str], metas: list[str]):
    """Each look's and playlist's status on the device today and with this image's effects."""
    from .api import room_for
    from .library import DeviceLists, check_library

    flashed = DeviceLists(names, metas, today.palettes, today.custom, today.max_segments)
    lib = request.app.state.library
    looks, playlists, _ = lib.for_device(device_id)
    room = room_for(request, device_id)
    now = {(r.get("look"), r.get("playlist")): r for r in check_library(looks, playlists, today, room)}
    rows = []
    for r in check_library(looks, playlists, flashed, room):
        before = now.get((r.get("look"), r.get("playlist")), {})
        rows.append({**r, "today": before.get("status", "ok"), "changes": before.get("status", "ok") != r["status"]})
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return rows, counts
