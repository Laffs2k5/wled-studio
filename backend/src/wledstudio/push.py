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

from .library import (CUSTOM_PALETTE_BASE, MAX_CUSTOM_PALETTES, DeviceLists, LookError, assign_palettes,
                      duplicate_ids, duplicates_message, plan_presets)
from .wled import WLEDClient, WLEDError


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
            json.dumps({"presets_sha256": sha256(text), "written": written, "presets": json.loads(text)}) + "\n")

    def presets_snapshot(self, device_id: str) -> dict | None:
        p = self.dir / f"{device_id}.json"
        if not p.exists():
            return None
        presets = json.loads(p.read_text()).get("presets")
        return presets if isinstance(presets, dict) else None

    def adopt_presets(self, device_id: str, text: str) -> None:
        """Acknowledge an outside edit without claiming that this app wrote it."""
        self.dir.mkdir(parents=True, exist_ok=True)
        p = self.dir / f"{device_id}.json"
        old = json.loads(p.read_text()) if p.exists() else {}
        old.update({"presets_sha256": sha256(text), "presets": json.loads(text)})
        p.write_text(json.dumps(old) + "\n")

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

    def backup_palette(self, device_id: str, index: int, content: object) -> Path:
        d = self.backups / device_id
        d.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        p = d / f"{stamp}-palette{index}.json"
        p.write_text(json.dumps(content, separators=(",", ":")) + "\n", encoding="utf-8")
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

    def backup_path(self, device_id: str, name: str) -> Path:
        """Resolve one known backup below this device's directory; no traversal or cross-device path."""
        if name != Path(name).name or not name.endswith("-presets.json"):
            raise FileNotFoundError(name)
        p = self.backups / device_id / name
        if not p.is_file():
            raise FileNotFoundError(name)
        return p


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
    drift_items: list | None = None  # additions, changes and removals since the last app write


async def fetch_lists(client: WLEDClient, custom: dict[str, int] | None = None,
                      *, info: dict | None = None) -> DeviceLists:
    """What the device offers, for resolving looks against it."""
    info = info if info is not None else await client.info()
    maxseg = ((info.get("leds")) or {}).get("maxseg")
    return DeviceLists(await client.effects(), await client.fxdata(), await client.palettes(), custom or {},
                       max_segments=maxseg if isinstance(maxseg, int) and 0 < maxseg <= 255 else None)


async def custom_palette_files(client: WLEDClient, info: dict | None = None) -> dict[int, object]:
    """Read the device's custom palette files without probing every possible index."""
    info = info if info is not None else await client.info()
    count = info.get("cpalcount")
    bounded = isinstance(count, int) and not isinstance(count, bool) and 0 <= count <= MAX_CUSTOM_PALETTES
    files = {}
    missing = 0
    limit = count if bounded else MAX_CUSTOM_PALETTES
    for index in range(limit):
        content = await client.custom_palette(index)
        if content is None:
            if bounded:
                continue
            # WLED 16's colors.cpp loadCustomPalettes() walks from index 0 and tolerates
            # WLED_MAX_CUSTOM_PALETTE_GAP (20, const.h) missing files before stopping.
            missing += 1
            if missing > 20:
                break
            continue
        missing = 0
        files[index] = content
    return files


def diff_ids(before: dict, after: dict) -> list[str]:
    keys = set(before) | set(after)
    return sorted((k for k in keys if before.get(k) != after.get(k)), key=lambda k: int(k) if k.isdigit() else -1)


def drift_details(before: dict | None, after: dict) -> list[dict]:
    if before is None:
        return []
    items = []
    for preset_id in diff_ids(before, after):
        old, new = before.get(preset_id), after.get(preset_id)
        old_name = old.get("n") if isinstance(old, dict) else None
        new_name = new.get("n") if isinstance(new, dict) else None
        action = "added" if old is None else "removed" if new is None else "changed"
        item = {"preset_id": preset_id, "action": action, "name": new_name or old_name or f"Preset {preset_id}"}
        if old_name and new_name and old_name != new_name:
            item["previous_name"] = old_name
        items.append(item)
    return items


async def push(client: WLEDClient, device_id: str, looks: list[dict], state: StateStore, **kw) -> PushResult:
    res = await _push(client, device_id, looks, state, **kw)
    res.last_write = state.last_written(device_id)
    return res


async def _push(client: WLEDClient, device_id: str, looks: list[dict], state: StateStore, *,
                dry_run: bool = False, adopt_drift: bool = False, adopt_drift_only: bool = False,
                accept_review: bool | list[str] = False,
                playlists: list[dict] | None = None, palettes: list[dict] | None = None,
                room: dict | None = None) -> PushResult:
    dups = duplicate_ids(looks, playlists or [])
    if dups and not dry_run:   # refused before the device is touched
        raise DuplicatePresetIds(duplicates_message(dups))
    info = await client.info()
    existing_palettes = await custom_palette_files(client, info)
    stored_manifest = state.palette_manifest(device_id)
    try:
        manifest, uploads = assign_palettes(palettes or [], stored_manifest, existing_palettes)
    except LookError as e:
        raise WLEDError(str(e)) from None
    custom = {n: CUSTOM_PALETTE_BASE - m["index"] for n, m in manifest.items()}
    lists = await fetch_lists(client, custom, info=info)
    pal_report = [{"palette": u["name"], "file": u["file"], "id": CUSTOM_PALETTE_BASE - u["index"]} for u in uploads]
    current_text = await client.presets_text()
    current = json.loads(current_text or "{}")
    last = state.last_pushed(device_id)
    drift = last is not None and sha256(current_text) != last
    drift_items = drift_details(state.presets_snapshot(device_id), current)
    planned, report = plan_presets(current, looks, lists, accept_review=accept_review, playlists=playlists,
                                   room=room)
    changed = diff_ids(current, planned)
    if dry_run:
        return PushResult(False, drift, report, changed, reason="dry run", palettes=pal_report, duplicates=dups,
                          drift_items=drift_items)
    if adopt_drift_only:
        if not drift:
            return PushResult(False, False, report, changed, reason="no outside changes to acknowledge",
                              palettes=pal_report, duplicates=dups, drift_items=[])
        state.adopt_presets(device_id, current_text)
        return PushResult(True, False, report, changed, reason="outside changes kept", palettes=[],
                          duplicates=dups, drift_items=[])
    if drift and not adopt_drift:
        return PushResult(False, True, report, changed, palettes=pal_report,
                          reason="the device's presets changed since the last push; adopt or review first")
    if not changed and not uploads:
        return PushResult(False, drift, report, [], reason="nothing to change", palettes=[])
    backup = state.backup(device_id, current_text)
    for u in uploads:
        before = existing_palettes.get(u["index"])
        if before is not None:
            state.backup_palette(device_id, u["index"], before)
    new_text = canonical(planned)
    # palettes first, so the presets that use them find them; one unlocked session
    async with client.unlocked():
        for u in uploads:
            await client._upload_raw(u["file"], u["content"].encode("utf-8"))
            if await client.custom_palette(u["index"]) != json.loads(u["content"]):
                return PushResult(False, drift, report, changed, str(backup.name), palettes=pal_report,
                                  reason=f"verification failed: {u['file']} differs from what was written")
        state.record_palettes(device_id, manifest)
        if changed:
            await client._upload_raw("presets.json", new_text.encode("utf-8"))
    readback = await client.presets_text()
    if json.loads(readback) != planned:
        return PushResult(False, drift, report, changed, str(backup.name), palettes=pal_report,
                          reason="verification failed: the device's presets.json differs from what was written")
    state.record_push(device_id, readback)
    return PushResult(True, drift, report, changed, str(backup.name), palettes=pal_report)
