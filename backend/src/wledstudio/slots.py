# SPDX-License-Identifier: EUPL-1.2
"""The slot grid: a fixed block of preset ids shown as rows and columns, filled from the library.

Some setups give preset ids a meaning: a remote's "banks" of four looks each, say, where bank b's
look k is preset `first + (b-1)*row_step + (k-1)*col_step`, named after its place ("B2·3 Fire").
The grid shows which look or playlist sits in each of those ids, and fills a slot by copying a
library look or playlist into it, with the slot's preset id and a name from the pattern. Whatever
held the slot before keeps its name and loses the slot: nothing is deleted.

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

    @model_validator(mode="after")
    def _one(self):
        if (self.look is None) == (self.playlist is None):
            raise ValueError("give a look or a playlist")
        return self


def _path(request: Request):
    return request.app.state.settings.data_dir / "slots.json"


def load_grid(request: Request) -> Grid | None:
    p = _path(request)
    return Grid(**json.loads(p.read_text(encoding="utf-8"))) if p.exists() else None


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
    occ = _occupants(request.app.state.library.load())
    cells = []
    for r in range(1, g.rows + 1):
        for c in range(1, g.cols + 1):
            pid = g.id(r, c)
            here = occ.get(pid, [])
            kind, name = here[0] if here else (None, None)
            notes = []
            if len(here) > 1:
                notes.append("more than one item has this preset id: " + ", ".join(n for _, n in here))
            if name and g.prefix_re().match(name) and g.name_for(r, c, g.base(name)) != name:
                notes.append("its name is another slot's")
            cells.append({"row": r, "col": c, "preset_id": pid, "kind": kind, "name": name,
                          "base": g.base(name) if name else None, "notes": notes})
    return {"grid": g.model_dump(), "cells": cells}


@router.put("/grid")
def put_grid(body: Grid, request: Request):
    p = _path(request)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(body.model_dump(), indent=1), encoding="utf-8")
    return get_slots(request)


@router.delete("/grid")
def delete_grid(request: Request):
    _path(request).unlink(missing_ok=True)
    return {"grid": None, "cells": []}


@router.put("/{pid}")
def fill(pid: int, body: FillIn, request: Request):
    """Copy a library look or playlist into the slot with this preset id."""
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
    name = g.name_for(*where, g.base(source["name"]))
    if not name or g.base(name) == "":
        raise HTTPException(422, "the name would be empty")
    other = lib["looks"] if kind == "playlist" else lib["playlists"]
    if name in other or (name in coll and coll[name] is not source and coll[name].get("preset_id") != pid):
        raise HTTPException(409, f"{name!r} is taken by another item")
    freed = []
    for k, n in _occupants(lib).get(pid, []):
        target = lib["looks" if k == "look" else "playlists"][n]
        if n != name:
            target["preset_id"] = None
            freed.append(n)
    item = copy.deepcopy(source)
    item["name"] = name
    item["preset_id"] = pid
    coll[name] = item
    try:
        store.save(lib)
    except LookError as e:
        raise HTTPException(422, str(e)) from None
    return {**get_slots(request), "filled": name, "freed": freed}


@router.delete("/{pid}")
def clear(pid: int, request: Request):
    """Empty a slot: what sits there keeps its name and loses the preset id."""
    g = _grid_or_404(request)
    if g.place(pid) is None:
        raise HTTPException(404, "that preset id isn't a slot in the grid")
    store = request.app.state.library
    lib = store.load()
    freed = []
    for k, n in _occupants(lib).get(pid, []):
        lib["looks" if k == "look" else "playlists"][n]["preset_id"] = None
        freed.append(n)
    if freed:
        store.save(lib)
    return {**get_slots(request), "freed": freed}
