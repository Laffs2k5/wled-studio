# SPDX-License-Identifier: EUPL-1.2
"""Preset ids owned by things outside the Studio library (remotes, HA automations)."""
from __future__ import annotations

import json
from pathlib import Path


class ProtectedPresets:
    def __init__(self, data_dir: Path):
        self.path = data_dir / "protected-presets.json"

    def list(self) -> list[dict]:
        return json.loads(self.path.read_text()) if self.path.exists() else []

    def save(self, rows: list[dict]) -> list[dict]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        ordered = sorted(rows, key=lambda row: row["id"])
        self.path.write_text(json.dumps(ordered, indent=1) + "\n", encoding="utf-8")
        return ordered

    def labels(self) -> dict[int, list[str]]:
        out: dict[int, list[str]] = {}
        for row in self.list():
            out.setdefault(row["id"], []).append(row["label"])
        return out
