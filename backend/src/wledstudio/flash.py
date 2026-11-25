# SPDX-License-Identifier: EUPL-1.2
"""Flashing a gate-passed image to a device, and reverting it.

The plan (read only) checks what can be checked before a flash:
- flashing is enabled here, and the request came through the client-certificate proxy;
- the builder's gate passed the image, and it fits the device's app slot;
- WLED's OTA lock is off, and the boot preset uses no effect that's new in the image (a crashing
  new effect at boot would trip WLED's boot-loop handler, which resets the config);
- what the image does to the library (the preflight): looks that would be unavailable or need
  review.

The flash, after the plan passes and the user typed the device's name:
1. backup: presets.json, cfg.json, /json/info and the effect list, kept with the app's backups;
2. the image: downloaded from the builder, its sha256 checked against the gate report;
3. upload to WLED's /update with the PIN unlocked (WLED validates the release itself; that
   check is never skipped); WLED writes its other OTA slot and reboots;
4. wait for the device to come back, newly booted;
5. checks against the baseline: the effect list is the image's, presets and config unchanged,
   free heap.

Both need the flashing notice (notice.py) accepted, by its version. The way back is WLED's /update?revert (the previous image is still in the other slot), offered
for every device but a virtual one. Flashes and reverts run in the background, one per device; the UI polls.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .notice import require_accepted
from .wled import WLEDError, WLEDLocked

router = APIRouter()

WAIT_INTERVAL_S = 2.0      # polling the device while it reboots
WAIT_TIMEOUT_S = 120.0     # it should be back well within this
HEAP_DROP_WARN = 0.8       # warn if free heap falls below 80 % of the baseline


class FlashIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device: str = Field(min_length=1, max_length=64)
    confirm: str = Field(max_length=64)
    notice: str | None = Field(default=None, max_length=32)   # the flashing notice's version, accepted


class RevertIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: str = Field(max_length=64)
    notice: str | None = Field(default=None, max_length=32)


@dataclass
class Run:
    """One flash or revert, as the UI follows it."""
    id: str
    kind: str                     # "flash" or "revert"
    device: str
    job: str | None = None
    notice: str | None = None     # the version of the flashing notice the user accepted
    state: str = "running"        # running, done, warnings, failed
    steps: list[dict] = field(default_factory=list)
    started: float = field(default_factory=time.time)
    finished: float | None = None
    # what the device runs afterwards, for the verdict: ver, effects (a count), and for a flash
    # image_running (the effect list is the image's), presets_changed, cfg_changed, heap_low
    result: dict = field(default_factory=dict)
    # what the device ran before (ver, release): after the swap, that's what its other slot holds
    before: dict = field(default_factory=dict)

    def step(self, name: str) -> dict:
        s = {"name": name, "state": "running", "detail": ""}
        self.steps.append(s)
        return s

    def public(self) -> dict:
        return {"id": self.id, "kind": self.kind, "device": self.device, "job": self.job, "notice": self.notice, "state": self.state,
                "steps": self.steps, "started": self.started, "finished": self.finished, "result": self.result,
                "before": self.before}


def _runs(request: Request) -> dict[str, Run]:
    if not hasattr(request.app.state, "flash_runs"):
        request.app.state.flash_runs = {}
    return request.app.state.flash_runs


def _busy(request: Request, device: str) -> bool:
    return any(r.device == device and r.state == "running" for r in _runs(request).values())


def check_allowed(request: Request) -> list[dict]:
    """Flashing enabled, and (if configured) the proxy's client-certificate header present."""
    s = request.app.state.settings
    out = []
    if not s.flashing:
        out.append({"id": "enabled", "level": "block",
                    "text": "Flashing is off in this app. It's turned on (WLEDSTUDIO_FLASHING=on) only behind "
                            "the client-certificate proxy; see docs/security.md."})
    elif s.flash_cert_header and not request.headers.get(s.flash_cert_header, "").strip():
        out.append({"id": "certificate", "level": "block",
                    "text": "This request didn't come through the client-certificate proxy."})
    else:
        out.append({"id": "enabled", "level": "ok", "text": "Flashing is enabled here."})
    return out


def new_effect_ids(device_effects: list[str], image_names: list[str]) -> set[int]:
    """Effect ids whose name in the image differs from the device's today (new or moved)."""
    return {i for i, n in enumerate(image_names)
            if "RSVD" not in n and (i >= len(device_effects) or device_effects[i] != n)}


def boot_effects(presets: dict, boot: int, depth: int = 0) -> set[int]:
    """The effect ids the boot preset shows, following a playlist's presets one level deep."""
    p = presets.get(str(boot))
    if not isinstance(p, dict) or depth > 1:
        return set()
    out = set()
    segs = p.get("seg")
    for s in segs if isinstance(segs, list) else [segs] if isinstance(segs, dict) else []:
        if isinstance(s, dict) and isinstance(s.get("fx"), int):
            out.add(s["fx"])
    pl = p.get("playlist")
    if isinstance(pl, dict):
        ids = pl.get("ps")
        for q in ids if isinstance(ids, list) else [ids]:
            if isinstance(q, int):
                out |= boot_effects(presets, q, depth + 1)
    return out


async def gather(request: Request, jid: str, device_id: str) -> dict[str, Any]:
    """Everything a plan or a flash needs from the builder and the device (reads only)."""
    from .api import device_errors, device_or_404, is_virtual, make_client
    from .firmware import _call, _job_id, effect_lists
    from .push import fetch_lists

    job = (await _call(request, "GET", f"/jobs/{_job_id(jid)}")).json()
    names, metas = effect_lists((await _call(request, "GET", f"/jobs/{_job_id(jid)}/effects.json")).json())
    dev = device_or_404(device_id, request)
    async with make_client(request, dev) as c:
        try:
            info = await c.info()
            device_effects = await c.effects()
            cfg = await c.cfg_file()
            presets = json.loads(await c.presets_text() or "{}")
            today = await fetch_lists(c, request.app.state.statestore.custom_ids(dev.id))
        except WLEDError as e:
            raise device_errors(e) from None
    request.app.state.devices.mark_virtual(dev.id, is_virtual(info))
    return {"job": job, "names": names, "metas": metas, "dev": dev, "info": info,
            "device_effects": device_effects, "cfg": cfg, "presets": presets, "today": today}


def plan_checks(request: Request, g: dict) -> tuple[list[dict], dict]:
    from .firmware import compare_library

    checks = check_allowed(request)
    job, report = g["job"], g["job"].get("report") or {}
    gate_ok = (job.get("kind", "gate") != "preview" and job.get("state") == "passed" and report.get("passed") is True
               and all(report.get("checks", {}).values()))
    checks.append({"id": "gate", "level": "ok" if gate_ok else "block",
                   "text": "The build passed its four safety checks (the gate)." if gate_ok
                   else "This build didn't pass its safety checks (the gate), so it can't be flashed."})
    custom = report.get("custom") or {}
    new_ids = new_effect_ids(g["device_effects"], g["names"])
    known = set(g["device_effects"])
    image = {"size": custom.get("firmware_size"), "sha256": custom.get("firmware_sha256"),
             "slot": report.get("app_slot_bytes"), "target": report.get("target"), "usermods": report.get("usermods"),
             "release": report.get("pins"),
             "new_effects": [n for n in g["names"] if "RSVD" not in n and n not in known]}
    if image["size"] and image["slot"]:
        fits = image["size"] <= image["slot"]
        checks.append({"id": "size", "level": "ok" if fits else "block",
                       "text": (f"It fits the device's firmware slot ({round(100 * image['size'] / image['slot'])} % used)."
                                if fits else f"It's too big for the device's firmware slot ({image['size']:,} bytes; "
                                f"the slot holds {image['slot']:,}).")})
    info = g["info"]
    if info.get("arch") == "virtual":
        what = (info.get("virtual") or {}).get("firmware") or "a WLED firmware"
        checks.append({"id": "arch", "level": "block",
                       "text": f"This is a virtual device (a twin of {what}): it runs the firmware it was built from, "
                               "and can't be flashed."})
    elif info.get("arch") and info.get("arch") != "esp32":
        checks.append({"id": "arch", "level": "block", "text": f"The device is an {info['arch']}, not a classic ESP32."})
    ota = (g["cfg"].get("ota") or {})
    checks.append({"id": "ota-lock", "level": "block" if ota.get("lock") else "ok",
                   "text": "WLED's OTA lock is on (Settings → Security): WLED refuses updates." if ota.get("lock")
                   else "WLED's OTA lock is off."})
    boot = int((g["cfg"].get("def") or {}).get("ps") or 0)
    if boot > 0:
        risky = boot_effects(g["presets"], boot) & new_ids
        checks.append({"id": "boot-preset", "level": "block" if risky else "ok",
                       "text": (f"The boot preset ({boot}) uses an effect that's new in this image (id "
                                f"{', '.join(map(str, sorted(risky)))}). A crash at boot would trip WLED's boot-loop "
                                "handler, which resets the config: pick another boot preset first.") if risky
                       else f"The boot preset ({boot}) uses no effect that's new in this image."})
    else:
        checks.append({"id": "boot-preset", "level": "ok", "text": "No boot preset."})
    rows, counts = compare_library(request, g["dev"].id, g["today"], g["names"], g["metas"])
    changed = [r for r in rows if r["changes"]]
    if changed:
        n = len(changed)
        checks.append({"id": "library", "level": "warn",
                       "text": f"{n} of your looks and playlists {'works' if n == 1 else 'work'} differently with this "
                               "firmware: some may stop working, others start."})
    else:
        checks.append({"id": "library", "level": "ok", "text": "None of your looks or playlists changes with this firmware."})
    has_pin = request.app.state.devices.pin(g["dev"].id) is not None
    checks.append({"id": "pin", "level": "ok" if has_pin else "warn",
                   "text": "The app has the device's settings PIN." if has_pin else
                   "No settings PIN is stored for this device. If it has one, store it, or the device refuses the "
                   "upload; if it has none, carry on."})
    return checks, image


@router.get("/api/firmware/jobs/{jid}/flash-plan")
async def flash_plan(jid: str, device: str, request: Request):
    """What a flash of this image to this device would do, and whether it may (reads only)."""
    g = await gather(request, jid, device)
    checks, image = plan_checks(request, g)
    info = g["info"]
    return {"job": jid, "device": g["dev"].id, "name": g["dev"].name, "image": image,
            "running": {k: info.get(k) for k in ("ver", "vid", "release", "arch", "freeheap", "uptime")},
            "checks": checks, "can_flash": not any(c["level"] == "block" for c in checks),
            "busy": _busy(request, g["dev"].id)}


def _backup(request: Request, device_id: str, what: str, files: dict[str, str]) -> str:
    stamp = time.strftime("%Y%m%dT%H%M%S")
    d = request.app.state.settings.data_dir / "backups" / device_id / f"{stamp}-{what}"
    d.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (d / name).write_text(text, encoding="utf-8")
    return d.name


async def _wait_back(client, since: float, timing: tuple[float, float]) -> dict:
    """Poll /json/info until the device answers, booted after `since`."""
    interval, timeout = timing
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        await asyncio.sleep(interval)
        try:
            info = await client.info()
        except WLEDError:
            continue
        if isinstance(info.get("uptime"), (int, float)) and info["uptime"] <= time.monotonic() - since + interval + 5:
            return info
    raise WLEDError(f"the device didn't come back within {int(timeout)} s")


def _timing(request: Request) -> tuple[float, float]:
    return getattr(request.app.state, "flash_timing", (WAIT_INTERVAL_S, WAIT_TIMEOUT_S))


async def _flash(request: Request, run: Run, g: dict, image: dict) -> None:
    from .api import make_client
    from .firmware import _call, _job_id

    dev = g["dev"]
    run.before = {k: g["info"].get(k) for k in ("ver", "release")}
    async with make_client(request, dev) as c:
        s = run.step("backup")
        try:
            s["detail"] = _backup(request, dev.id, "before-flash", {
                "presets.json": json.dumps(g["presets"], indent=1), "cfg.json": json.dumps(g["cfg"], indent=1),
                "info.json": json.dumps(g["info"], indent=1), "effects.json": json.dumps(g["device_effects"])})
            s["state"] = "ok"

            s = run.step("image")
            data = (await _call(request, "GET", f"/jobs/{_job_id(run.job)}/firmware.bin")).content
            digest = hashlib.sha256(data).hexdigest()
            if image["sha256"] and digest != image["sha256"]:
                raise WLEDError(f"the downloaded image's sha256 ({digest[:12]}…) isn't the gate's ({image['sha256'][:12]}…)")
            if data[:1] != b"\xe9":
                raise WLEDError("not an ESP32 app image")
            s["detail"], s["state"] = f"{len(data):,} bytes, sha256 {digest[:12]}…, as the gate built it", "ok"

            s = run.step("upload")
            sent = time.monotonic()
            s["detail"], s["state"] = await c.flash(data), "ok"

            s = run.step("restart")
            after = await _wait_back(c, sent, _timing(request))
            s["detail"], s["state"] = f"back after {int(time.monotonic() - sent)} s, {after.get('ver')}", "ok"

            s = run.step("checks")
            notes, warn = [], False
            effects = await c.effects()
            count = sum(1 for n in effects if "RSVD" not in n)
            running_image = effects == g["names"][:len(effects)] and len(effects) == len(g["names"])
            run.result = {"ver": after.get("ver"), "effects": count, "image_running": running_image}
            if running_image:
                notes.append(f"the effect list is the image's ({count} effects)")
            else:
                warn = True
                notes.append("the effect list isn't the image's: is the new image running?")
            if json.loads(await c.presets_text() or "{}") != g["presets"]:
                warn = run.result["presets_changed"] = True
                notes.append("presets.json changed")
            if await c.cfg_file() != g["cfg"]:
                warn = run.result["cfg_changed"] = True
                notes.append("cfg.json changed")
            before, now = g["info"].get("freeheap"), after.get("freeheap")
            if isinstance(before, int) and isinstance(now, int):
                low = now < before * HEAP_DROP_WARN
                warn |= low
                if low:
                    run.result["heap_low"] = {"now": now, "before": before}
                notes.append(f"free heap {now:,} bytes (was {before:,})" + (": lower than expected" if low else ""))
            s["detail"], s["state"] = "; ".join(notes), "warn" if warn else "ok"
            run.state = "warnings" if warn else "done"
        except (WLEDError, HTTPException) as e:
            s["state"] = "failed"
            s["detail"] = str(e.detail if isinstance(e, HTTPException) else e)
            if isinstance(e, WLEDLocked):
                s["detail"] += " (is the PIN right, and WLED's OTA lock off?)"
            run.state = "failed"
        finally:
            run.finished = time.time()
            _record(request, run)


async def _revert(request: Request, run: Run, dev) -> None:
    from .api import make_client

    async with make_client(request, dev) as c:
        s = run.step("backup")
        try:
            info = await c.info()
            run.before = {k: info.get(k) for k in ("ver", "release")}
            s["detail"] = _backup(request, dev.id, "before-revert", {
                "presets.json": await c.presets_text(), "cfg.json": json.dumps(await c.cfg_file(), indent=1),
                "info.json": json.dumps(info, indent=1)})
            s["state"] = "ok"
            s = run.step("revert")
            sent = time.monotonic()
            s["detail"], s["state"] = await c.revert(), "ok"
            s = run.step("restart")
            after = await _wait_back(c, sent, _timing(request))
            effects = await c.effects()
            count = sum(1 for n in effects if "RSVD" not in n)
            run.result = {"ver": after.get("ver"), "effects": count}
            s["detail"] = f"back after {int(time.monotonic() - sent)} s, {after.get('ver')}, {count} effects"
            s["state"] = "ok"
            run.state = "done"
        except WLEDError as e:
            s["state"], s["detail"], run.state = "failed", str(e), "failed"
        finally:
            run.finished = time.time()
            _record(request, run)


def _record(request: Request, run: Run) -> None:
    d = request.app.state.settings.data_dir / "flashes" / run.device
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{time.strftime('%Y%m%dT%H%M%S', time.localtime(run.started))}-{run.kind}.json").write_text(
        json.dumps(run.public(), indent=1), encoding="utf-8")


def _start(request: Request, run: Run, coro) -> dict:
    _runs(request)[run.id] = run
    task = asyncio.get_running_loop().create_task(coro)
    tasks = getattr(request.app.state, "flash_tasks", set())
    request.app.state.flash_tasks = tasks
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return run.public()


@router.post("/api/firmware/jobs/{jid}/flash", status_code=202)
async def flash(jid: str, body: FlashIn, request: Request):
    """Flash a gate-passed image to a device: only when the plan has no blocking problem and
    `confirm` is the device's name, as the user typed it."""
    if any(c["level"] == "block" for c in check_allowed(request)):
        raise HTTPException(403, check_allowed(request)[0]["text"])
    require_accepted(body.notice)
    g = await gather(request, jid, body.device)
    if body.confirm != g["dev"].name:
        raise HTTPException(400, "type the device's name to confirm")
    if _busy(request, g["dev"].id):
        raise HTTPException(409, "a flash or revert is already running for this device")
    checks, image = plan_checks(request, g)
    blocking = [c["text"] for c in checks if c["level"] == "block"]
    if blocking:
        raise HTTPException(409, blocking[0])
    run = Run(id=uuid.uuid4().hex, kind="flash", device=g["dev"].id, job=jid, notice=body.notice)
    return _start(request, run, _flash(request, run, g, image))


@router.post("/api/devices/{device_id}/revert", status_code=202)
async def revert(device_id: str, body: RevertIn, request: Request):
    """Boot the device's previous image again (WLED's /update?revert). Never for a virtual
    device: it runs the firmware it was built from and has no other image."""
    from .api import device_errors, device_or_404, is_virtual, make_client

    if any(c["level"] == "block" for c in check_allowed(request)):
        raise HTTPException(403, check_allowed(request)[0]["text"])
    require_accepted(body.notice)
    dev = device_or_404(device_id, request)
    async with make_client(request, dev) as c:
        try:
            virtual = is_virtual(await c.info())
        except WLEDError as e:
            raise device_errors(e) from None
    request.app.state.devices.mark_virtual(dev.id, virtual)
    if virtual:
        raise HTTPException(409, f"{dev.name} is a virtual device, a software copy of WLED for testing: "
                                 "it has no other firmware to go back to, and can't be flashed or reverted.")
    if body.confirm != dev.name:
        raise HTTPException(400, "type the device's name to confirm")
    if _busy(request, dev.id):
        raise HTTPException(409, "a flash or revert is already running for this device")
    run = Run(id=uuid.uuid4().hex, kind="revert", device=dev.id, notice=body.notice)
    return _start(request, run, _revert(request, run, dev))


def _swapped(record: dict) -> bool:
    """Whether a recorded flash or revert got as far as changing which image the device boots."""
    step = "upload" if record.get("kind") == "flash" else "revert"
    return any(isinstance(s, dict) and s.get("name") == step and s.get("state") == "ok" for s in record.get("steps") or [])


@router.get("/api/devices/{device_id}/previous-firmware")
def previous_firmware(device_id: str, request: Request):
    """What the device's other OTA slot holds, as far as this app knows: what it ran before the
    last flash or revert from here (each swaps the slots). Unknown if the app never swapped them,
    or recorded the run before it kept `before`. Reads the app's records only, not the device."""
    from .api import device_or_404

    dev = device_or_404(device_id, request)
    d = request.app.state.settings.data_dir / "flashes" / dev.id
    for f in sorted(d.glob("*.json"), reverse=True) if d.is_dir() else []:
        try:
            record = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(record, dict) or not _swapped(record):
            continue
        before = record.get("before") if isinstance(record.get("before"), dict) else {}
        if not before.get("ver"):
            return {"known": False}
        return {"known": True, "ver": before.get("ver"), "release": before.get("release") or None,
                "kind": record.get("kind"), "when": record.get("finished") or record.get("started")}
    return {"known": False}


@router.get("/api/flashes/{rid}")
def flash_status(rid: str, request: Request):
    run = _runs(request).get(rid)
    if run is None:
        raise HTTPException(404, "no such flash")
    return run.public()
