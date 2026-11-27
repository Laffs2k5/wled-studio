# SPDX-License-Identifier: EUPL-1.2
"""Back up, inspect and restore a WLED device's whole cfg.json."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path
from time import monotonic
from typing import Any

from .wled import WLEDClient, WLEDError, wait_for_reboot

NETWORK_SECTIONS = frozenset({"nw", "ap", "eth", "wifi"})
_MISSING = object()


class ConfigChanged(Exception):
    pass


class ConfigRefused(Exception):
    pass


class ConfigVerification(Exception):
    pass


def canonical(cfg: dict) -> str:
    return json.dumps(cfg, separators=(",", ":"), sort_keys=True, ensure_ascii=False)


def config_hash(cfg: dict) -> str:
    return hashlib.sha256(canonical(cfg).encode("utf-8")).hexdigest()


class ConfigBackups:
    def __init__(self, data_dir: Path):
        self.root = data_dir / "backups"

    def save(self, device_id: str, cfg: dict) -> dict:
        directory = self.root / device_id
        directory.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = directory / f"{stamp}-cfg"
        backup.mkdir()
        path = backup / "cfg.json"
        path.write_text(json.dumps(cfg, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        return backup_details(backup)

    def list(self, device_id: str) -> list[dict]:
        directory = self.root / device_id
        if not directory.exists():
            return []
        return [backup_details(path) for path in sorted(
            (p for p in directory.iterdir() if p.is_dir() and (p / "cfg.json").is_file()),
            key=lambda p: p.name,
            reverse=True,
        )]

    def load(self, device_id: str, name: str) -> dict:
        if not name or name in {".", ".."} or name != Path(name).name:
            raise FileNotFoundError(name)
        path = self.root / device_id / name / "cfg.json"
        if path.is_symlink() or (self.root / device_id / name).is_symlink() or not path.is_file():
            raise FileNotFoundError(name)
        cfg = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(cfg, dict):
            raise ValueError("cfg.json is not an object")
        return cfg

    def details(self, device_id: str, name: str) -> dict:
        self.load(device_id, name)
        return backup_details(self.root / device_id / name)


def backup_details(directory: Path) -> dict:
    path = directory / "cfg.json"
    text = path.read_text(encoding="utf-8")
    cfg = json.loads(text)
    if not isinstance(cfg, dict):
        raise ValueError("cfg.json is not an object")
    return {
        "name": directory.name,
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "source": "manual" if directory.name.endswith("-cfg") else directory.name.rsplit("-", 1)[-1],
    }


def _path(parent: str, part: str | int) -> str:
    if isinstance(part, int):
        return f"{parent}[{part}]"
    return f"{parent}.{part}" if parent else part


def config_changes(current: Any, target: Any, parent: str = "") -> list[dict]:
    """Leaf additions, removals and changes, each with its top-level section."""
    present = target if current is _MISSING else current
    if (current is _MISSING or target is _MISSING) and isinstance(present, dict):
        if present:
            return [row for key in sorted(present)
                    for row in config_changes(
                        _MISSING if current is _MISSING else present[key],
                        present[key] if current is _MISSING else _MISSING,
                        _path(parent, str(key)),
                    )]
        action = "add" if current is _MISSING else "remove"
        return [{"section": parent.split(".", 1)[0], "path": parent, "action": action}]
    if (current is _MISSING or target is _MISSING) and isinstance(present, list):
        if present:
            return [row for index, value in enumerate(present)
                    for row in config_changes(
                        _MISSING if current is _MISSING else value,
                        value if current is _MISSING else _MISSING,
                        _path(parent, index),
                    )]
        action = "add" if current is _MISSING else "remove"
        return [{"section": parent.split(".", 1)[0], "path": parent, "action": action}]
    if isinstance(current, dict) and isinstance(target, dict):
        out: list[dict] = []
        for key in sorted(current.keys() | target.keys()):
            out.extend(config_changes(current.get(key, _MISSING), target.get(key, _MISSING),
                                      _path(parent, str(key))))
        return out
    if isinstance(current, list) and isinstance(target, list):
        out = []
        for index in range(max(len(current), len(target))):
            out.extend(config_changes(
                current[index] if index < len(current) else _MISSING,
                target[index] if index < len(target) else _MISSING,
                _path(parent, index),
            ))
        return out
    if current == target:
        return []
    if not parent:
        parent = "<root>"
    action = "add" if current is _MISSING else "remove" if target is _MISSING else "change"
    return [{"section": parent.split(".", 1)[0].split("[", 1)[0], "path": parent, "action": action}]


def identity_differences(current: dict, target: dict) -> tuple[bool | None, list[str]]:
    current_id = current.get("id")
    target_id = target.get("id")
    if not isinstance(current_id, dict) or not isinstance(target_id, dict):
        return None, []
    keys = {key for key in current_id.keys() & target_id.keys()
            if str(key).casefold() in {"name", "mdns"} or "mac" in str(key).casefold()}
    compared = sorted(str(key) for key in keys)
    differences = [f"id.{key}" for key in compared if current_id[key] != target_id[key]]
    return (False if differences else True) if compared else None, differences


def restore_plan(current: dict, target: dict, backup: str) -> dict:
    changes = config_changes(current, target)
    identity_match, identity = identity_differences(current, target)
    network = sorted({row["section"] for row in changes} & NETWORK_SECTIONS)
    return {
        "backup": backup,
        "inspected_sha256": config_hash(current),
        "backup_sha256": config_hash(target),
        "changes": changes,
        "network_sections": network,
        "identity_match": identity_match,
        "identity_differences": identity,
    }


async def inspect_restore(client: WLEDClient, backups: ConfigBackups, device_id: str,
                          backup: str) -> dict:
    target = backups.load(device_id, backup)
    return restore_plan(await client.cfg_file(), target, backup)


async def restore(client: WLEDClient, backups: ConfigBackups, device_id: str, backup: str,
                  inspected_sha256: str, timing: tuple[float, float], *,
                  override_device: bool, allow_network_changes: bool) -> dict:
    target = backups.load(device_id, backup)
    async with client.unlocked():
        current = await client.cfg_file()
        plan = restore_plan(current, target, backup)
        if plan["inspected_sha256"] != inspected_sha256:
            raise ConfigChanged("the device's cfg.json changed; inspect the restore again")
        if plan["identity_match"] is False and not override_device:
            raise ConfigRefused("the backup identifies another device; tick the device override to continue")
        if plan["network_sections"] and not allow_network_changes:
            raise ConfigRefused("the restore changes network settings; tick the network override to continue")

        previous = backups.save(device_id, current)
        sent = monotonic()
        try:
            await client._upload_raw("cfg.json", canonical(target).encode("utf-8"))
        except Exception as e:
            raise ConfigVerification(
                f"the cfg.json upload failed ({e}); the previous file is in backup {previous['name']}") from e

    try:
        await wait_for_reboot(client, sent, timing)
        readback = await client.cfg_file()
    except Exception as e:
        raise ConfigVerification(
            f"the device did not return after the restore ({e}); the previous file is in backup {previous['name']}") from e
    return {
        "restored": backup,
        "backup": previous["name"],
        "differences": config_changes(target, readback),
    }
