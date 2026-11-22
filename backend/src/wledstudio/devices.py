# SPDX-License-Identifier: EUPL-1.2
"""The device registry: names and hosts in devices.json, PINs in separate 0600 files."""
from __future__ import annotations

import json
import os
import re
import secrets
from dataclasses import asdict, dataclass
from pathlib import Path

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


@dataclass
class Device:
    id: str
    name: str
    host: str  # host[:port], validated by netcheck

    @property
    def base_url(self) -> str:
        return f"http://{self.host}"


def _write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


class DeviceStore:
    def __init__(self, data_dir: Path):
        self.path = data_dir / "devices.json"
        self.secrets = data_dir / "secrets"

    def _load(self) -> dict[str, Device]:
        if not self.path.exists():
            return {}
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        return {d["id"]: Device(**d) for d in raw.get("devices", [])}

    def _save(self, devices: dict[str, Device]) -> None:
        _write_private(self.path, json.dumps({"devices": [asdict(d) for d in devices.values()]}, indent=2) + "\n")

    def list(self) -> list[Device]:
        return list(self._load().values())

    def get(self, device_id: str) -> Device | None:
        return self._load().get(device_id)

    def add(self, name: str, host: str) -> Device:
        devices = self._load()
        base = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")[:32] or "device"
        did = base if base not in devices else f"{base}-{secrets.token_hex(2)}"
        dev = Device(id=did, name=name, host=host)
        devices[did] = dev
        self._save(devices)
        return dev

    def remove(self, device_id: str) -> bool:
        devices = self._load()
        if devices.pop(device_id, None) is None:
            return False
        self._save(devices)
        self.set_pin(device_id, None)
        return True

    # PINs: never returned by the API, only whether one is set
    def _pin_path(self, device_id: str) -> Path:
        if not ID_RE.match(device_id):
            raise ValueError("bad device id")
        return self.secrets / f"{device_id}.pin"

    def set_pin(self, device_id: str, pin: str | None) -> None:
        p = self._pin_path(device_id)
        if pin is None:
            p.unlink(missing_ok=True)
        else:
            _write_private(p, pin)

    def pin(self, device_id: str) -> str | None:
        env = os.environ.get(f"WLEDSTUDIO_PIN_{device_id.upper().replace('-', '_')}")
        if env:
            return env
        p = self._pin_path(device_id)
        return p.read_text(encoding="utf-8").strip() if p.exists() else None
