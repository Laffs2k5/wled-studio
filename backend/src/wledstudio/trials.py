# SPDX-License-Identifier: EUPL-1.2
"""Persisted bank trials so a browser/app restart leaves an explicit recovery action."""
from __future__ import annotations

import json
from pathlib import Path


class TrialStore:
    def __init__(self, data_dir: Path):
        self.dir = data_dir / "bank-trials"

    def path(self, device_id: str) -> Path:
        return self.dir / f"{device_id}.json"

    def get(self, device_id: str) -> dict | None:
        p = self.path(device_id)
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def start(self, device_id: str, snapshot: dict) -> dict:
        if self.get(device_id) is not None:
            raise FileExistsError(device_id)
        self.dir.mkdir(parents=True, exist_ok=True)
        record = {"snapshot": snapshot}
        self.path(device_id).write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
        return record

    def finish(self, device_id: str) -> None:
        self.path(device_id).unlink(missing_ok=True)
