# SPDX-License-Identifier: EUPL-1.2
"""Recently deleted room models and slot grids, kept separately from studio-file exports."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict


router = APIRouter(prefix="/api/deleted")
RECORD_ID = re.compile(r"^[0-9a-f]{32}$")
KEEP = 50


class RestoreIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    replace: bool = False


class DeletedStore:
    def __init__(self, data_dir: Path):
        self.path = data_dir / "deleted"

    def _read(self, path: Path) -> dict | None:
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            return None
        if not isinstance(record, dict) or record.get("id") != path.stem:
            return None
        return record

    def records(self) -> list[dict]:
        if not self.path.exists():
            return []
        records = [record for p in self.path.glob("*.json") if (record := self._read(p)) is not None]
        return sorted(records, key=lambda record: (record.get("when", ""), record["id"]), reverse=True)

    def list(self) -> list[dict]:
        return [
            {"id": record["id"], "kind": record["kind"], "label": record["name"], "when": record["when"],
             **({"device_id": record["device_id"]} if record["kind"] == "room" else {}),
             **({"grid_id": record["grid_id"]} if record["kind"] == "grid" else {})}
            for record in self.records()
        ]

    def add(self, kind: str, target_id: str, name: str, content: dict) -> dict:
        self.path.mkdir(parents=True, exist_ok=True)
        record = {
            "id": uuid.uuid4().hex,
            "kind": kind,
            f"{'device' if kind == 'room' else 'grid'}_id": target_id,
            "name": name,
            "when": dt.datetime.now(dt.timezone.utc).isoformat(timespec="microseconds"),
            "content": content,
        }
        path = self.path / f"{record['id']}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, path)
        for old in self.records()[KEEP:]:
            (self.path / f"{old['id']}.json").unlink(missing_ok=True)
        return record

    def get(self, record_id: str) -> dict:
        if not RECORD_ID.fullmatch(record_id):
            raise HTTPException(404, "No recently deleted item has that id.")
        path = self.path / f"{record_id}.json"
        record = self._read(path)
        if record is None:
            raise HTTPException(404, "No recently deleted item has that id.")
        return record

    def remove(self, record_id: str) -> None:
        (self.path / f"{record_id}.json").unlink()


@router.get("")
def recently_deleted(request: Request):
    return DeletedStore(request.app.state.settings.data_dir).list()


@router.post("/{record_id}/restore")
def restore_deleted(record_id: str, request: Request, body: RestoreIn | None = None):
    store = DeletedStore(request.app.state.settings.data_dir)
    record = store.get(record_id)
    if record.get("kind") == "room":
        device_id = record.get("device_id")
        if not isinstance(device_id, str) or request.app.state.devices.get(device_id) is None:
            raise HTTPException(409, "The device this room model belonged to no longer exists.")
        path = request.app.state.settings.data_dir / "rooms" / f"{device_id}.json"
        if path.exists() and not (body and body.replace):
            raise HTTPException(409, "This device has a room model now. Restore with replace to overwrite it.")
        room = record.get("content")
        from .api import RoomIn
        try:
            room = RoomIn.model_validate(room).model_dump(exclude_none=True)
        except ValueError as e:
            raise HTTPException(409, f"This deleted room model cannot be restored: {e}") from None
        if not room.get("zones"):
            room.pop("zones", None)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(room, indent=1) + "\n", encoding="utf-8")
        os.replace(tmp, path)
        result = {"kind": "room", "label": record.get("name", "Room model"), "device_id": device_id,
                  "content": room}
    elif record.get("kind") == "grid":
        from .slots import restore_deleted_grid
        result = restore_deleted_grid(request, record)
    else:
        raise HTTPException(409, "This deleted item has an unknown kind.")
    store.remove(record_id)
    return result


def record_deleted(request: Request, kind: str, target_id: str, name: str, content: dict) -> dict:
    return DeletedStore(request.app.state.settings.data_dir).add(kind, target_id, name, content)
