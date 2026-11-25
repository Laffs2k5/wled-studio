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


def _path(request: Request):
    return request.app.state.settings.data_dir / "slots.json"


def _load(request: Request) -> dict:
    p = _path(request)
    if not p.exists():
        return {"grid": None, "assignments": {}}
    raw = json.loads(p.read_text(encoding="utf-8"))
    if "grid" in raw:
        return {"grid": raw.get("grid"), "assignments": raw.get("assignments", {})}
    return {"grid": raw, "assignments": {}}


def load_grid(request: Request) -> Grid | None:
    raw = _load(request)["grid"]
    return Grid(**raw) if raw else None


def _assignments(request: Request) -> dict[str, dict]:
    return _load(request)["assignments"]


def _save(request: Request, grid: Grid, assignments: dict | None = None) -> None:
    p = _path(request)
    p.parent.mkdir(parents=True, exist_ok=True)
    current = _assignments(request) if assignments is None else assignments
    valid = {str(pid): value for pid, value in current.items() if grid.place(int(pid)) is not None}
    p.write_text(json.dumps({"grid": grid.model_dump(), "assignments": valid}, indent=1), encoding="utf-8")


def _grid_or_404(request: Request) -> Grid:
    g = load_grid(request)
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


@router.get("")
def get_slots(request: Request):
    """The grid and what sits in each slot."""
    g = load_grid(request)
    if g is None:
        return {"grid": None, "cells": []}
    lib = request.app.state.library.load()
    occ = _occupants(lib)
    assignments = _assignments(request)
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
    return {"grid": g.model_dump(), "cells": cells}


@router.put("/grid")
def put_grid(body: Grid, request: Request):
    _save(request, body)
    return get_slots(request)


@router.delete("/grid")
def delete_grid(request: Request):
    _path(request).unlink(missing_ok=True)
    return {"grid": None, "cells": []}


@router.put("/{pid}")
def fill(pid: int, body: FillIn, request: Request):
    """Reference a library item in a slot; optionally also write it at the source's existing id."""
    g = _grid_or_404(request)
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
    assignments = _assignments(request)
    if body.mode == "also" and source.get("preset_id") is not None and source.get("preset_id") != pid:
        assignments[str(pid)] = {"kind": kind, "name": source["name"]}
    else:
        source["preset_id"] = pid
        assignments.pop(str(pid), None)
    try:
        store.save(lib)
        _save(request, g, assignments)
    except LookError as e:
        raise HTTPException(422, str(e)) from None
    return {**get_slots(request), "filled": source["name"], "freed": freed}


@router.delete("/{pid}")
def clear(pid: int, request: Request):
    """Empty a reference; a moved item's primary preset id is cleared too."""
    g = _grid_or_404(request)
    if g.place(pid) is None:
        raise HTTPException(404, "that preset id isn't a slot in the grid")
    store = request.app.state.library
    lib = store.load()
    freed = []
    assignments = _assignments(request)
    assignment = assignments.pop(str(pid), None)
    if assignment:
        freed.append(assignment["name"])
    for k, n in _occupants(lib).get(pid, []):
        lib["looks" if k == "look" else "playlists"][n]["preset_id"] = None
        freed.append(n)
    if freed:
        store.save(lib)
        _save(request, g, assignments)
    return {**get_slots(request), "freed": freed}


def expand_for_push(request: Request, looks: list[dict], playlists: list[dict]) -> tuple[list[dict], list[dict]]:
    """Materialize slot 'also use here' references for one plan/write without storing copies in the library."""
    g = load_grid(request)
    if g is None:
        return looks, playlists
    by_look = {look["name"]: look for look in looks}
    by_playlist = {playlist["name"]: playlist for playlist in playlists}
    extra_looks = list(looks)
    extra_playlists = list(playlists)
    for pid, assignment in _assignments(request).items():
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
