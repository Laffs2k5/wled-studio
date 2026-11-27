# SPDX-License-Identifier: EUPL-1.2
"""The portable studio file: export everything the user made, import it into this or another app.

What it holds (version 2):
- the library: looks, playlists and palettes (with their folders and order);
- the slot grids (by name) and the protected preset ids;
- per device, matched by the device's **name**: its room model and its set.

What it never holds: tokens, PINs, device hosts or ids, backups, flash records, the app's history.
Version 1 files (the library only) still import.

An import validates everything before it writes anything, and checks each item the way the
app's own editors do (names, folders, palettes, playlists' looks, grid shapes, rooms). `keep`
leaves an existing item of the same name alone; `replace` overwrites it. Device sections apply
only to devices with that name here; the others are reported and skipped.
"""
from __future__ import annotations

import json
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import ConfigDict, Field, ValidationError

from .api import LookIn, PaletteIn, PlaylistIn, ProtectedPresetIn, RoomIn, Strict
from .library import LookError, check_folder, check_name, check_palette
from .slots import Grid, _load as load_slots, _save_state as save_slots

router = APIRouter(prefix="/api")

FORMAT = "wled-studio-library"
VERSION = 2
ARCHIVE_LIMIT = 10 * 1024 * 1024   # also in security.py, which lets this one path past the 1 MB limit


class ArchiveLook(LookIn):
    """A look as the app stores it, minus where it came from (`source`, device-local)."""
    model_config = ConfigDict(extra="forbid")
    imported_ids: dict[Annotated[str, Field(max_length=64)], Annotated[int, Field(ge=0, le=65535)]] = \
        Field(default_factory=dict, max_length=64)
    clear_other_segments: bool | None = None
    bs: int | None = Field(default=None, ge=0, le=255)
    mainseg: int | None = Field(default=None, ge=0, le=63)
    ql: str | None = Field(default=None, max_length=4)


class Assignment(Strict):
    kind: Literal["look", "playlist"]
    name: str = Field(min_length=1, max_length=64)


class ArchiveGrid(Strict):
    name: str = Field(min_length=1, max_length=64)
    grid: Grid
    assignments: dict[str, Assignment] = Field(default_factory=dict, max_length=400)


class ArchiveSet(Strict):
    looks: list[Annotated[str, Field(max_length=64)]] = Field(default_factory=list, max_length=1000)
    playlists: list[Annotated[str, Field(max_length=64)]] = Field(default_factory=list, max_length=1000)


class ArchiveDevice(Strict):
    room: RoomIn | None = None
    set: ArchiveSet | None = None


def export_archive(request: Request) -> dict:
    st = request.app.state
    lib = st.library.load()
    # no `source` (device-local) and no null fields (an import reads absent and null alike)
    def clean(item: dict) -> dict:
        return {k: v for k, v in item.items() if v is not None and k != "source"}
    looks = {name: clean(look) for name, look in lib["looks"].items()}
    playlists = {name: clean(pl) for name, pl in lib["playlists"].items()}
    slots, _ = load_slots(request)
    grids = [{"name": g["name"], "grid": g["grid"], "assignments": g.get("assignments", {})}
             for g in slots["grids"]]
    devices: dict[str, dict] = {}
    from .api import room_for
    for dev in st.devices.list():
        entry = {}
        room = room_for(request, dev.id)
        if room:
            entry["room"] = room
        if dev.id in lib["sets"]:
            entry["set"] = lib["sets"][dev.id]
        if entry:
            devices[dev.name] = entry
    return {"format": FORMAT, "version": VERSION, "looks": looks, "playlists": playlists,
            "palettes": lib["palettes"], "slot_grids": grids, "protected_presets": st.protected_presets.list(),
            "devices": devices}


def parse_archive(raw: object) -> dict:
    """The archive, checked; raises ValueError with what is wrong."""
    if not isinstance(raw, dict) or raw.get("format") != FORMAT or raw.get("version") not in (1, 2):
        raise ValueError("not a wled-studio library archive (version 1 or 2)")
    sections = {"format", "version", "looks", "playlists", "palettes"}
    if raw["version"] == 2:
        sections |= {"slot_grids", "protected_presets", "devices"}
    if set(raw) - sections or not {"looks", "playlists", "palettes"} <= set(raw):
        raise ValueError("the archive's sections aren't those of its version")
    out: dict = {"looks": {}, "playlists": {}, "palettes": {}}
    for kind, model in (("looks", ArchiveLook), ("playlists", PlaylistIn), ("palettes", PaletteIn)):
        if not isinstance(raw[kind], dict):
            raise ValueError(f"{kind} must be an object")
        for name, item in raw[kind].items():
            try:
                parsed = model.model_validate(item).model_dump(exclude_none=True)
            except ValidationError as e:
                raise ValueError(f"{kind[:-1]} {name!r}: {e.errors()[0]['msg']}") from None
            if parsed.get("name") != name:
                raise ValueError(f"the {kind} key and item name differ ({name!r})")
            try:
                check_name(name)
                if kind == "palettes":
                    parsed = check_palette(parsed)
                elif "folder" in parsed:
                    folder = check_folder(parsed["folder"])
                    parsed.pop("folder") if folder is None else parsed.update(folder=folder)
            except LookError as e:
                raise ValueError(f"{kind[:-1]} {name!r}: {e}") from None
            out[kind][name] = parsed
    try:
        out["slot_grids"] = [ArchiveGrid.model_validate(g).model_dump() for g in raw.get("slot_grids", [])]
        out["protected_presets"] = [ProtectedPresetIn.model_validate(p).model_dump()
                                    for p in raw.get("protected_presets", [])]
        devices = raw.get("devices", {})
        if not isinstance(devices, dict):
            raise ValueError("devices must be an object")
        out["devices"] = {}
        for name, d in devices.items():
            try:
                out["devices"][name] = ArchiveDevice.model_validate(d).model_dump(exclude_none=True)
            except ValidationError as e:
                err = e.errors()[0]
                raise ValueError(f"devices.{name}.{'.'.join(map(str, err['loc']))}: {err['msg']}") from None
    except ValidationError as e:
        err = e.errors()[0]
        raise ValueError(f"{'.'.join(map(str, err['loc']))}: {err['msg']}") from None
    for g in out["slot_grids"]:
        grid = Grid(**g["grid"])
        for pid in g["assignments"]:
            if not pid.isdigit() or grid.place(int(pid)) is None:
                raise ValueError(f"grid {g['name']!r}: preset {pid} isn't one of its slots")
    names = [g["name"].casefold() for g in out["slot_grids"]]
    if len(set(names)) != len(names):
        raise ValueError("two slot grids have the same name")
    return out


def _check_references(lib: dict, grids: list[dict]) -> None:
    looks = set(lib["looks"])
    for pl in lib["playlists"].values():
        refs = [e.get("look") for e in pl.get("entries", [])] + ([pl["end"]] if pl.get("end") else [])
        missing = sorted({n for n in refs if n not in looks})
        if missing:
            raise ValueError(f"playlist {pl['name']!r} refers to missing looks: {', '.join(missing)}")
    for g in grids:
        for pid, a in g.get("assignments", {}).items():
            if a["name"] not in lib["looks" if a["kind"] == "look" else "playlists"]:
                raise ValueError(f"grid {g['name']!r}: preset {pid} refers to a missing {a['kind']} {a['name']!r}")
    for device_id, s in lib["sets"].items():
        for kind in ("looks", "playlists"):
            missing = [n for n in s.get(kind, []) if n not in lib[kind]]
            if missing:
                raise ValueError(f"a device's set refers to missing {kind}: {', '.join(missing)}")


def plan_import(request: Request, archive: dict, mode: str) -> tuple[dict, dict, dict, list[dict], dict]:
    """(result, new library, new slots state, new protected list, rooms to write by device id)."""
    st = request.app.state
    lib = st.library.load()
    result: dict = {"looks": 0, "playlists": 0, "palettes": 0, "kept": [], "slot_grids": 0,
                    "kept_grids": [], "protected_presets": 0, "rooms": [], "sets": [], "unmatched_devices": []}
    for kind in ("looks", "playlists", "palettes"):
        for name, item in archive[kind].items():
            if name in lib[kind] and mode == "keep":
                result["kept"].append(name)
                continue
            lib[kind][name] = item
            result[kind] += 1

    slots, _ = load_slots(request)
    by_name = {g["name"].casefold(): g for g in slots["grids"]}
    used = {g["id"] for g in slots["grids"]}
    for g in archive["slot_grids"]:
        here = by_name.get(g["name"].casefold())
        if here is not None and mode == "keep":
            result["kept_grids"].append(g["name"])
            continue
        if here is not None:
            here.update(grid=g["grid"], assignments=g["assignments"])
        else:
            n = 1
            while f"grid-{n}" in used:
                n += 1
            used.add(f"grid-{n}")
            slots["grids"].append({"id": f"grid-{n}", "name": g["name"], "grid": g["grid"],
                                   "assignments": g["assignments"]})
            if slots.get("current") is None:
                slots["current"] = f"grid-{n}"
        result["slot_grids"] += 1

    protected = st.protected_presets.list()
    seen = {(p["id"], p["label"].casefold()) for p in protected}
    for p in archive["protected_presets"]:
        if (p["id"], p["label"].casefold()) not in seen:
            protected.append(p)
            seen.add((p["id"], p["label"].casefold()))
            result["protected_presets"] += 1

    from .api import room_for
    devices = {d.name: d for d in st.devices.list()}
    rooms: dict[str, dict] = {}
    for name, entry in archive["devices"].items():
        dev = devices.get(name)
        if dev is None:
            result["unmatched_devices"].append(name)
            continue
        if "room" in entry and (mode == "replace" or room_for(request, dev.id) is None):
            room = dict(entry["room"])
            if not room.get("zones"):
                room.pop("zones", None)
            rooms[dev.id] = room
            result["rooms"].append(name)
        if "set" in entry and (mode == "replace" or dev.id not in lib["sets"]):
            lib["sets"][dev.id] = entry["set"]
            result["sets"].append(name)
    _check_references(lib, slots["grids"])
    return result, lib, slots, protected, rooms


@router.get("/library/archive")
def export_library(request: Request):
    return Response(json.dumps(export_archive(request), indent=2, ensure_ascii=False).encode(),
                    media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="wled-studio-library-v{VERSION}.json"'})


@router.post("/library/archive/import")
async def import_library(request: Request, mode: Literal["keep", "replace"] = "keep", preview: bool = False):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > ARCHIVE_LIMIT:
            raise HTTPException(413, "Library archive is too large (maximum 10 MiB).")
        chunks.append(chunk)
    try:
        archive = parse_archive(json.loads(b"".join(chunks)))
        result, lib, slots, protected, rooms = plan_import(request, archive, mode)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as e:
        raise HTTPException(422, f"Invalid library archive: {e}") from None
    if preview:
        return result
    st = request.app.state
    # everything is checked; the library first (it keeps its previous version in the history)
    st.library.save(lib)
    if archive["slot_grids"]:
        save_slots(request, slots)
    if result["protected_presets"]:
        st.protected_presets.save(protected)
    d = st.settings.data_dir / "rooms"
    for device_id, room in rooms.items():
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{device_id}.json").write_text(json.dumps(room, indent=1) + "\n")
    return result


# --- the library's earlier versions -------------------------------------------------

class VersionRestoreIn(Strict):
    confirm: Literal["restore"]


@router.get("/library/versions")
def library_versions(request: Request):
    """What the library held before each of its last saves, newest first (at most 100)."""
    return request.app.state.library.versions()


@router.post("/library/versions/{name}/restore")
def restore_library_version(name: str, body: VersionRestoreIn, request: Request):
    """The library as it was then. Grids, protected ids and rooms aren't part of the library and
    stay as they are; a grid reference to an item the old library lacks shows as missing."""
    try:
        return request.app.state.library.restore_version(name)
    except KeyError:
        raise HTTPException(404, "no such version") from None
    except (LookError, ValueError) as e:
        raise HTTPException(422, str(e)) from None
