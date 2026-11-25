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

from .library import (CUSTOM_PALETTE_BASE, DeviceLists, assign_palettes, duplicate_ids, duplicates_message,
                      plan_presets)
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
        written = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        (self.dir / f"{device_id}.json").write_text(
            json.dumps({"presets_sha256": sha256(text), "written": written}) + "\n")

    def last_written(self, device_id: str) -> str | None:
        """When wled-studio last wrote this device's presets (ISO 8601, UTC); None if unknown."""
        p = self.dir / f"{device_id}.json"
        return json.loads(p.read_text()).get("written") if p.exists() else None

    def forget(self, device_id: str) -> None:
        """Drop the record of what was last written to a device (its drift baseline and palette
        manifest), when the device is removed from the app. Backups stay."""
        (self.dir / f"{device_id}.json").unlink(missing_ok=True)
        (self.dir / f"{device_id}.palettes.json").unlink(missing_ok=True)

    def backup(self, device_id: str, text: str) -> Path:
        d = self.backups / device_id
        d.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        p = d / f"{stamp}-presets.json"
        p.write_text(text, encoding="utf-8")
        return p

    def palette_manifest(self, device_id: str) -> dict:
        p = self.dir / f"{device_id}.palettes.json"
        return json.loads(p.read_text()) if p.exists() else {}

    def record_palettes(self, device_id: str, manifest: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / f"{device_id}.palettes.json").write_text(json.dumps(manifest, indent=1) + "\n")

    def custom_ids(self, device_id: str) -> dict[str, int]:
        return {n: CUSTOM_PALETTE_BASE - m["index"] for n, m in self.palette_manifest(device_id).items()}

    def list_backups(self, device_id: str) -> list[str]:
        d = self.backups / device_id
        return sorted(p.name for p in d.glob("*-presets.json")) if d.exists() else []


class DuplicatePresetIds(Exception):
    """Two looks (or a look and a playlist) want the same preset id: the write is refused."""


@dataclass
class PushResult:
    done: bool
    drift: bool
    report: list
    changed_ids: list
    backup: str | None = None
    reason: str | None = None
    palettes: list | None = None
    duplicates: list | None = None   # preset ids wanted by more than one item: they block the write
    last_write: str | None = None    # when the app last wrote this device's presets


async def fetch_lists(client: WLEDClient, custom: dict[str, int] | None = None) -> DeviceLists:
    """What the device offers, for resolving looks against it."""
    maxseg = ((await client.info()).get("leds") or {}).get("maxseg")
    return DeviceLists(await client.effects(), await client.fxdata(), await client.palettes(), custom or {},
                       max_segments=maxseg if isinstance(maxseg, int) and 0 < maxseg <= 255 else None)


def diff_ids(before: dict, after: dict) -> list[str]:
    keys = set(before) | set(after)
    return sorted((k for k in keys if before.get(k) != after.get(k)), key=lambda k: int(k) if k.isdigit() else -1)


async def push(client: WLEDClient, device_id: str, looks: list[dict], state: StateStore, **kw) -> PushResult:
    res = await _push(client, device_id, looks, state, **kw)
    res.last_write = state.last_written(device_id)
    return res


async def _push(client: WLEDClient, device_id: str, looks: list[dict], state: StateStore, *,
                dry_run: bool = False, adopt_drift: bool = False, accept_review: bool | list[str] = False,
                playlists: list[dict] | None = None, palettes: list[dict] | None = None,
                room: dict | None = None) -> PushResult:
    dups = duplicate_ids(looks, playlists or [])
    if dups and not dry_run:   # refused before the device is touched
        raise DuplicatePresetIds(duplicates_message(dups))
    manifest, uploads = assign_palettes(palettes or [], state.palette_manifest(device_id))
    custom = {n: CUSTOM_PALETTE_BASE - m["index"] for n, m in manifest.items()}
    lists = await fetch_lists(client, custom)
    pal_report = [{"palette": u["name"], "file": u["file"], "id": CUSTOM_PALETTE_BASE - u["index"]} for u in uploads]
    current_text = await client.presets_text()
    current = json.loads(current_text or "{}")
    last = state.last_pushed(device_id)
    drift = last is not None and sha256(current_text) != last
    planned, report = plan_presets(current, looks, lists, accept_review=accept_review, playlists=playlists,
                                   room=room)
    changed = diff_ids(current, planned)
    if dry_run:
        return PushResult(False, drift, report, changed, reason="dry run", palettes=pal_report, duplicates=dups)
    if drift and not adopt_drift:
        return PushResult(False, True, report, changed, palettes=pal_report,
                          reason="the device's presets changed since the last push; adopt or review first")
    if not changed and not uploads:
        return PushResult(False, drift, report, [], reason="nothing to change", palettes=[])
    backup = state.backup(device_id, current_text)
    new_text = canonical(planned)
    # palettes first, so the presets that use them find them; one unlocked session
    async with client.unlocked():
        for u in uploads:
            await client._upload_raw(u["file"], u["content"].encode("utf-8"))
        state.record_palettes(device_id, manifest)
        if changed:
            await client._upload_raw("presets.json", new_text.encode("utf-8"))
    readback = await client.presets_text()
    if json.loads(readback) != planned:
        return PushResult(False, drift, report, changed, str(backup.name), palettes=pal_report,
                          reason="verification failed: the device's presets.json differs from what was written")
    state.record_push(device_id, readback)
    return PushResult(True, drift, report, changed, str(backup.name), palettes=pal_report)
