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
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

router = APIRouter(prefix="/api/firmware")
JOB_ID = re.compile(r"^[0-9a-f]{32}$")
Name = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]


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


@router.get("/jobs/{jid}/log", response_class=PlainTextResponse)
async def log(jid: str, request: Request):
    return (await _call(request, "GET", f"/jobs/{_job_id(jid)}/log")).text
