# SPDX-License-Identifier: EUPL-1.2
"""Destructive, verified administration of a device's presets.json."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Callable

from .push import canonical, sha256, StateStore
from .wled import WLEDClient


def preset_hash(preset: dict) -> str:
    """A short content hash of one preset, so two files can be compared id by id."""
    return hashlib.sha256(canonical(preset).encode("utf-8")).hexdigest()[:16]


def preset_summary(presets: dict) -> list[dict]:
    rows = []
    for key in sorted((k for k in presets if k.isdigit()), key=int):
        if int(key) == 0:
            continue
        value = presets[key]
        rows.append({"id": int(key), "name": value.get("n") or f"Preset {key}", "sha": preset_hash(value)})
    return rows


def changed_ids(before: dict, after: dict) -> list[int]:
    """Preset ids (not 0) whose entry is added, removed or different between two files."""
    keys = {k for k in (*before, *after) if k.isdigit() and int(k) != 0}
    return sorted(int(k) for k in keys if before.get(k) != after.get(k))


def playlists_using(presets: dict, ids: set[int], leaving: set[int] = frozenset()) -> dict[int, list[int]]:
    """playlist id -> the ids in `ids` it plays (or ends on), for playlists not in `leaving`."""
    out: dict[int, list[int]] = {}
    for key, value in presets.items():
        if not key.isdigit() or int(key) in leaving or not isinstance(value, dict):
            continue
        pl = value.get("playlist")
        if not isinstance(pl, dict):
            continue
        refs = [int(x) for x in pl.get("ps", []) if isinstance(x, int) or str(x).isdigit()]
        if str(pl.get("end", "")).isdigit():
            refs.append(int(pl["end"]))
        hit = sorted({r for r in refs if r in ids})
        if hit:
            out[int(key)] = hit
    return out


async def inspect_device(client: WLEDClient) -> tuple[str, dict]:
    text = await client.presets_text()
    return text, json.loads(text or "{}")


def backup_details(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    presets = json.loads(text)
    return {
        "name": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256(text),
        "presets": preset_summary(presets),
    }


async def mutate_presets(client: WLEDClient, state: StateStore, device_id: str, inspected_hash: str,
                         plan: Callable[[dict], dict]) -> str:
    """Check, backup, upload, verify the whole object, then make it the new drift baseline.

    `plan` turns the device's current presets (the very file whose hash was inspected) into the
    file to write; it may raise PresetRefused, and then nothing is written."""
    async with client.unlocked():
        current_text, current = await inspect_device(client)
        if sha256(current_text) != inspected_hash:
            raise PresetChanged("the device's presets changed; inspect them again")
        expected = plan(json.loads(json.dumps(current)))
        planned_text = canonical(expected)
        backup = state.backup(device_id, current_text)
        try:
            await client._upload_raw("presets.json", planned_text.encode("utf-8"))
            readback = await client.presets_text()
        except Exception as e:
            raise PresetVerification(f"the upload failed ({e}); the previous file is in backup {backup.name}") from e
        if json.loads(readback or "{}") != expected:
            raise PresetVerification("the device did not verify the requested presets.json; "
                                     f"the previous file is in backup {backup.name}")
        state.record_push(device_id, readback)
        return backup.name


class PresetRefused(Exception):
    """The change would break something that depends on a preset id; nothing was written."""


class PresetChanged(Exception):
    pass


class PresetVerification(Exception):
    pass
