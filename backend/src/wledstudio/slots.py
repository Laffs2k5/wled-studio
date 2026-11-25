# SPDX-License-Identifier: EUPL-1.2
"""The slot grid: a fixed block of preset ids shown as rows and columns, referencing the library.

Some setups give preset ids a meaning: a remote's "banks" of four looks each, say, where bank b's
look k is preset `first + (b-1)*row_step + (k-1)*col_step`, named after its place ("B2·3 Fire").
The grid shows which look or playlist sits in each id. A normal fill moves that item to the slot's
preset id. "Also" keeps its primary id and stores a grid-only reference; it is expanded as a
short-lived look or playlist copy only for a plan/write. Nothing in the library is duplicated.

The grid is a view on the library and its preset ids, nothing more: writing to a device is the
usual write, and what the ids mean (banks, remotes) stays outside this app. Its shape is the
user's, kept in the app's data (slots.json).
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library import MAX_NAME_BYTES, LookError

router = APIRouter(prefix="/api/slots")


class Grid(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: int = Field(ge=1, le=20)
    cols: int = Field(ge=1, le=20)
    first: int = Field(ge=1, le=250)        # the preset id of row 1, column 1
    row_step: int = Field(ge=1, le=100)
    col_step: int = Field(default=1, ge=1, le=100)
    name: str = Field(default="R{row}·{col} {name}", min_length=6, max_length=40)   # {row}, {col}, {name}

    @model_validator(mode="after")
    def _check(self):
        if "{name}" not in self.name or re.search(r"\{(?!row\}|col\}|name\})", self.name):
            raise ValueError("the name pattern takes {row}, {col} and {name}, and must have {name}")
        ids = [self.id(r, c) for r in range(1, self.rows + 1) for c in range(1, self.cols + 1)]
        if max(ids) > 250:
            raise ValueError(f"the grid reaches preset {max(ids)}; WLED's presets end at 250")
        if len(set(ids)) != len(ids):
            raise ValueError("two slots would share a preset id: make the row step larger")
        return self

    def id(self, row: int, col: int) -> int:
        return self.first + (row - 1) * self.row_step + (col - 1) * self.col_step

    def place(self, pid: int) -> tuple[int, int] | None:
        for r in range(1, self.rows + 1):
            for c in range(1, self.cols + 1):
                if self.id(r, c) == pid:
                    return r, c
        return None

    def prefix_re(self) -> re.Pattern:
        """Matches a name made from the pattern, capturing the base name."""
        parts = re.split(r"(\{row\}|\{col\}|\{name\})", self.name)
        rx = "".join({"{row}": r"\d+", "{col}": r"\d+", "{name}": "(?P<base>.*)"}.get(p, re.escape(p)) for p in parts)
        return re.compile(f"^{rx}$")

    def base(self, name: str) -> str:
        m = self.prefix_re().match(name)
        return m.group("base") if m else name

    def name_for(self, row: int, col: int, base: str) -> str:
        """The slot's name for a base name, the base shortened to fit WLED's name limit."""
        head = self.name.replace("{row}", str(row)).replace("{col}", str(col))
        room = MAX_NAME_BYTES - len(head.replace("{name}", "").encode("utf-8"))
        b = base.strip()
        while len(b.encode("utf-8")) > room:
            b = b[:-1]
        return head.replace("{name}", b.rstrip()).strip()


class FillIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    look: str | None = Field(default=None, max_length=64)
    playlist: str | None = Field(default=None, max_length=64)
    mode: str = Field(default="move", pattern="^(move|also)$")

    @model_validator(mode="after")
    def _one(self):
        if (self.look is None) == (self.playlist is None):
            raise ValueError("give a look or a playlist")
        return self


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GridNameIn(Strict):
    name: str = Field(min_length=1, max_length=64)
    grid: Grid


class GridEditIn(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    grid: Grid | None = None


def _path(request: Request):
    return request.app.state.settings.data_dir / "slots.json"


def _load(request: Request) -> tuple[dict, bool]:
    p = _path(request)
    if not p.exists():
        return {"version": 2, "current": None, "grids": []}, False
    raw = json.loads(p.read_text(encoding="utf-8"))
    if raw.get("version") == 2:
        if not isinstance(raw.get("grids"), list):
            raise ValueError("slots.json has no grid list")
        return raw, False
    # old formats: the grid itself, or {"grid", "assignments"}
    if "grid" in raw:
        old = raw
    else:
        old = {"grid": raw, "assignments": {}}
    if old.get("grid") is None:
        return {"version": 2, "current": None, "grids": []}, True
    return {
        "version": 2, "current": "grid-1",
        "grids": [{"id": "grid-1", "name": "Remote A", "grid": old["grid"],
                   "assignments": old.get("assignments", {})}],
    }, True


def _entries(request: Request, grid_id: str | None = None) -> tuple[dict, dict]:
    state, migrated = _load(request)
    chosen = grid_id or state.get("current")
    entry = next((g for g in state["grids"] if g["id"] == chosen), None)
    return {"state": state, "migrated": migrated}, entry or {}


def load_grid(request: Request, grid_id: str | None = None) -> Grid | None:
    _, entry = _entries(request, grid_id)
    return Grid(**entry["grid"]) if entry.get("grid") else None


def _assignments(request: Request, grid_id: str | None = None) -> dict[str, dict]:
    _, entry = _entries(request, grid_id)
    return entry.get("assignments", {}) if entry else {}


def _save_state(request: Request, state: dict) -> None:
    p = _path(request)
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists():
        raw = json.loads(p.read_text(encoding="utf-8"))
        if raw.get("version") != 2 and not (p.parent / ".slots-v1-migrated").exists():
            stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            p.with_name(f"slots-{stamp}.json").write_text(json.dumps(raw, indent=1) + "\n", encoding="utf-8")
            (p.parent / ".slots-v1-migrated").write_text(stamp + "\n", encoding="utf-8")
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1) + "\n", encoding="utf-8")
    tmp.replace(p)


def _save_current(request: Request, grid: Grid, assignments: dict | None = None) -> str:
    ctx, entry = _entries(request)
    state = ctx["state"]
    if not entry:
        used = {g["id"] for g in state["grids"]}
        n = 1
        while f"grid-{n}" in used:
            n += 1
        entry = {"id": f"grid-{n}", "name": "Remote A", "grid": grid.model_dump(), "assignments": {}}
        state["grids"].append(entry)
        state["current"] = entry["id"]
    current = entry["assignments"] if assignments is None else assignments
    missing = {str(pid) for pid in current if grid.place(int(pid)) is None}
    if missing:
        raise HTTPException(409, f"Assignments at preset {', '.join(sorted(missing))} do not fit the new shape.")
    entry["grid"] = grid.model_dump()
    entry["assignments"] = current
    _save_state(request, state)
    return entry["id"]


def _grid_or_404(request: Request, grid_id: str | None = None) -> Grid:
    g = load_grid(request, grid_id)
    if g is None:
        raise HTTPException(404, "no slot grid set up")
    return g


def _occupants(lib: dict) -> dict[int, list[tuple[str, str]]]:
    """preset id -> [(kind, name)] for every look and playlist with a preset id."""
    out: dict[int, list[tuple[str, str]]] = {}
    for kind, coll in (("look", lib["looks"]), ("playlist", lib["playlists"])):
        for name, item in coll.items():
            pid = item.get("preset_id")
            if isinstance(pid, int):
                out.setdefault(pid, []).append((kind, name))
    return out


def _slots(request: Request, grid_id: str | None = None) -> dict:
    """The grid and what sits in each slot."""
    ctx, entry = _entries(request, grid_id)
    g = load_grid(request, grid_id)
    if g is None:
        return {"grid": None, "cells": []}
    lib = request.app.state.library.load()
    occ = _occupants(lib)
    assignments = entry.get("assignments", {})
    cells = []
    for r in range(1, g.rows + 1):
        for c in range(1, g.cols + 1):
            pid = g.id(r, c)
            assignment = assignments.get(str(pid))
            if assignment:
                kind, name = assignment["kind"], assignment["name"]
                exists = name in lib["looks" if kind == "look" else "playlists"]
                if not exists:
                    notes = [f'{name} is no longer in the library']
                    kind = name = None
                else:
                    notes = ["references the saved library item; no copy is made"]
            else:
                here = occ.get(pid, [])
                kind, name = here[0] if here else (None, None)
                notes = []
            if not assignment and len(here) > 1:
                notes.append("more than one item has this preset id: " + ", ".join(n for _, n in here))
            if name and g.prefix_re().match(name) and g.name_for(r, c, g.base(name)) != name:
                notes.append("its name is another slot's")
            cells.append({"row": r, "col": c, "preset_id": pid, "kind": kind, "name": name,
                          "base": g.base(name) if name else None, "notes": notes})
    return {"grid": g.model_dump(), "cells": cells, "id": entry["id"], "name": entry["name"]}


@router.get("")
def get_slots(request: Request, grid: str | None = None):
    return _slots(request, grid)


@router.put("/grid")
def put_grid(body: Grid, request: Request):
    _save_current(request, body)
    return get_slots(request)


@router.delete("/grid")
def delete_grid(request: Request):
    ctx, entry = _entries(request)
    state = ctx["state"]
    if entry:
        state["grids"] = [g for g in state["grids"] if g["id"] != entry["id"]]
        state["current"] = state["grids"][0]["id"] if state["grids"] else None
        _save_state(request, state)
    return {"grid": None, "cells": []}


@router.get("/grids")
def grids(request: Request):
    state, _ = _load(request)
    return {"current": state["current"],
            "grids": [{**_slots(request, item["id"])} for item in state["grids"]]}


@router.post("/grids", status_code=201)
def create_grid(body: GridNameIn, request: Request):
    state, _ = _load(request)
    if any(g["name"].casefold() == body.name.strip().casefold() for g in state["grids"]):
        raise HTTPException(409, "A grid with that name already exists.")
    used = {g["id"] for g in state["grids"]}
    n = 1
    while f"grid-{n}" in used:
        n += 1
    entry = {"id": f"grid-{n}", "name": body.name.strip(), "grid": body.grid.model_dump(), "assignments": {}}
    state["grids"].append(entry)
    if state["current"] is None:
        state["current"] = entry["id"]
    _save_state(request, state)
    return _slots(request, entry["id"])


@router.patch("/grids/{grid_id}")
def edit_grid(grid_id: str, body: GridEditIn, request: Request):
    state, _ = _load(request)
    entry = next((g for g in state["grids"] if g["id"] == grid_id), None)
    if not entry:
        raise HTTPException(404, "no such grid")
    if body.name is not None:
        name = body.name.strip()
        if any(g["id"] != grid_id and g["name"].casefold() == name.casefold() for g in state["grids"]):
            raise HTTPException(409, "A grid with that name already exists.")
        entry["name"] = name
    if body.grid is not None:
        missing = [pid for pid in entry["assignments"] if body.grid.place(int(pid)) is None]
        if missing:
            raise HTTPException(409, f"Assignments at preset {', '.join(sorted(missing))} do not fit the new shape.")
        entry["grid"] = body.grid.model_dump()
    _save_state(request, state)
    return _slots(request, grid_id)


@router.post("/grids/{grid_id}/select")
def select_grid(grid_id: str, request: Request):
    state, _ = _load(request)
    if not any(g["id"] == grid_id for g in state["grids"]):
        raise HTTPException(404, "no such grid")
    state["current"] = grid_id
    _save_state(request, state)
    return _slots(request, grid_id)


@router.delete("/grids/{grid_id}")
def remove_named_grid(grid_id: str, request: Request):
    state, _ = _load(request)
    if not any(g["id"] == grid_id for g in state["grids"]):
        raise HTTPException(404, "no such grid")
    state["grids"] = [g for g in state["grids"] if g["id"] != grid_id]
    if state["current"] == grid_id:
        state["current"] = state["grids"][0]["id"] if state["grids"] else None
    _save_state(request, state)
    return {"current": state["current"], "grids": [g["id"] for g in state["grids"]]}


@router.put("/{pid}")
def fill(pid: int, body: FillIn, request: Request, grid: str | None = None):
    """Reference a library item in a slot; optionally also write it at the source's existing id."""
    g = _grid_or_404(request, grid)
    where = g.place(pid)
    if where is None:
        raise HTTPException(404, "that preset id isn't a slot in the grid")
    store = request.app.state.library
    lib = store.load()
    kind, coll = ("look", lib["looks"]) if body.look is not None else ("playlist", lib["playlists"])
    source = coll.get(body.look or body.playlist)
    if source is None:
        raise HTTPException(404, f"no {kind} named {body.look or body.playlist!r}")
    freed = []
    for k, n in _occupants(lib).get(pid, []):
        target = lib["looks" if k == "look" else "playlists"][n]
        if target is not source:
            target["preset_id"] = None
            freed.append(n)
    ctx, entry = _entries(request, grid)
    assignments = dict(entry.get("assignments", {}))
    if body.mode == "also" and source.get("preset_id") is not None and source.get("preset_id") != pid:
        assignments[str(pid)] = {"kind": kind, "name": source["name"]}
    else:
        source["preset_id"] = pid
        assignments.pop(str(pid), None)
    try:
        store.save(lib)
        entry["assignments"] = assignments
        _save_state(request, ctx["state"])
    except LookError as e:
        raise HTTPException(422, str(e)) from None
    return {**_slots(request, entry["id"]), "filled": source["name"], "freed": freed}


@router.delete("/{pid}")
def clear(pid: int, request: Request, grid: str | None = None):
    """Empty a reference; a moved item's primary preset id is cleared too."""
    g = _grid_or_404(request, grid)
    if g.place(pid) is None:
        raise HTTPException(404, "that preset id isn't a slot in the grid")
    store = request.app.state.library
    lib = store.load()
    freed = []
    ctx, entry = _entries(request, grid)
    assignments = dict(entry.get("assignments", {}))
    assignment = assignments.pop(str(pid), None)
    if assignment:
        freed.append(assignment["name"])
    for k, n in _occupants(lib).get(pid, []):
        lib["looks" if k == "look" else "playlists"][n]["preset_id"] = None
        freed.append(n)
    if freed:
        store.save(lib)
        entry["assignments"] = assignments
        _save_state(request, ctx["state"])
    return {**_slots(request, entry["id"]), "freed": freed}


def expand_for_push(request: Request, looks: list[dict], playlists: list[dict]) -> tuple[list[dict], list[dict]]:
    """Materialize slot 'also use here' references for one plan/write without storing copies in the library."""
    state, _ = _load(request)
    if not state["grids"]:
        return looks, playlists
    by_look = {look["name"]: look for look in looks}
    by_playlist = {playlist["name"]: playlist for playlist in playlists}
    extra_looks = list(looks)
    extra_playlists = list(playlists)
    for entry in state["grids"]:
        g = Grid(**entry["grid"])
        for pid, assignment in entry.get("assignments", {}).items():
            where = g.place(int(pid))
            if where is None:
                continue
            source = (by_look if assignment["kind"] == "look" else by_playlist).get(assignment["name"])
            if source is None:
                continue
            item = copy.deepcopy(source)
            item["name"] = g.name_for(*where, g.base(source["name"]))
            item["preset_id"] = int(pid)
            (extra_looks if assignment["kind"] == "look" else extra_playlists).append(item)
    return extra_looks, extra_playlists
