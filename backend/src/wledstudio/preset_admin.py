# SPDX-License-Identifier: EUPL-1.2
"""Destructive, verified administration of a device's presets.json."""
from __future__ import annotations

import json
from pathlib import Path

from .push import canonical, sha256, StateStore
from .wled import WLEDClient


def preset_summary(presets: dict) -> list[dict]:
    rows = []
    for key in sorted((k for k in presets if k.isdigit()), key=int):
        if int(key) == 0:
            continue
        value = presets[key]
        rows.append({"id": int(key), "name": value.get("n") or f"Preset {key}"})
    return rows


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
                         expected: dict) -> str:
    """Check, backup, upload, verify the whole object, then make it the new drift baseline."""
    async with client.unlocked():
        current_text, current = await inspect_device(client)
        if sha256(current_text) != inspected_hash:
            raise PresetChanged("the device's presets changed; inspect them again")
        planned_text = canonical(expected)
        backup = state.backup(device_id, current_text)
        await client._upload_raw("presets.json", planned_text.encode("utf-8"))
        readback = await client.presets_text()
        if json.loads(readback or "{}") != expected:
            raise PresetVerification("the device did not verify the requested presets.json")
        state.record_push(device_id, readback)
        return backup.name


class PresetChanged(Exception):
    pass


class PresetVerification(Exception):
    pass
