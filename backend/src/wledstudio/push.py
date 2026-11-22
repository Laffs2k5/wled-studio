# SPDX-License-Identifier: EUPL-1.2
"""Write the library's looks to a device: backup, drift check, upload, verify.

The device's presets.json is replaced as a whole (WLED's /upload, with the
settings PIN if one is set). Before that:
- the current file is backed up;
- it's compared with what wled-studio wrote last time: if someone changed it
  since (WLED's own UI, Home Assistant, another tool), the push stops and shows
  what changed, unless the caller adopts the change;
After the upload the file is read back and must equal what was written.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .library import DeviceLists, plan_presets
from .wled import WLEDClient


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical(presets: dict) -> str:
    return json.dumps(presets, separators=(",", ":"), ensure_ascii=False)


class StateStore:
    """Per device: the hash of the presets.json wled-studio last wrote; backups."""

    def __init__(self, data_dir: Path):
        self.dir = data_dir / "state"
        self.backups = data_dir / "backups"

    def last_pushed(self, device_id: str) -> str | None:
        p = self.dir / f"{device_id}.json"
        return json.loads(p.read_text())["presets_sha256"] if p.exists() else None

    def record_push(self, device_id: str, text: str) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / f"{device_id}.json").write_text(json.dumps({"presets_sha256": sha256(text)}) + "\n")

    def backup(self, device_id: str, text: str) -> Path:
        d = self.backups / device_id
        d.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        p = d / f"{stamp}-presets.json"
        p.write_text(text, encoding="utf-8")
        return p

    def list_backups(self, device_id: str) -> list[str]:
        d = self.backups / device_id
        return sorted(p.name for p in d.glob("*-presets.json")) if d.exists() else []


@dataclass
class PushResult:
    done: bool
    drift: bool
    report: list
    changed_ids: list
    backup: str | None = None
    reason: str | None = None


def diff_ids(before: dict, after: dict) -> list[str]:
    keys = set(before) | set(after)
    return sorted((k for k in keys if before.get(k) != after.get(k)), key=lambda k: int(k) if k.isdigit() else -1)


async def push(client: WLEDClient, device_id: str, looks: list[dict], state: StateStore, *,
               dry_run: bool = False, adopt_drift: bool = False, accept_review: bool = False) -> PushResult:
    lists = DeviceLists(await client.effects(), await client.fxdata(), await client.palettes())
    current_text = await client.presets_text()
    current = json.loads(current_text or "{}")
    last = state.last_pushed(device_id)
    drift = last is not None and sha256(current_text) != last
    planned, report = plan_presets(current, looks, lists, accept_review=accept_review)
    changed = diff_ids(current, planned)
    if dry_run:
        return PushResult(False, drift, report, changed, reason="dry run")
    if drift and not adopt_drift:
        return PushResult(False, True, report, changed,
                          reason="the device's presets changed since the last push; adopt or review first")
    if not changed:
        return PushResult(False, drift, report, [], reason="nothing to change")
    backup = state.backup(device_id, current_text)
    new_text = canonical(planned)
    await client.upload("presets.json", new_text.encode("utf-8"))
    readback = await client.presets_text()
    if json.loads(readback) != planned:
        return PushResult(False, drift, report, changed, str(backup.name),
                          reason="verification failed: the device's presets.json differs from what was written")
    state.record_push(device_id, readback)
    return PushResult(True, drift, report, changed, str(backup.name))
