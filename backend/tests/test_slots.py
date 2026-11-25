# SPDX-License-Identifier: EUPL-1.2
"""The slot grid, with made-up numbers: 3 rows of 2, from preset 40, rows 5 apart."""
import json
from conftest import CSRF

GRID = {"rows": 3, "cols": 2, "first": 40, "row_step": 5, "name": "G{row}-{col} {name}"}


def look(name, preset_id=None, fx=0):
    return {"name": name, "preset_id": preset_id, "segments": [{"start": 0, "stop": 10, "fx": fx}]}


def setup(client, items=()):
    lib = client.app.state.library
    for it in items:
        lib.put(it)
    r = client.put("/api/slots/grid", json=GRID, headers=CSRF)
    assert r.status_code == 200, r.text
    return r.json()


def cell(slots, row, col):
    return next(c for c in slots["cells"] if c["row"] == row and c["col"] == col)


def test_no_grid_until_set_up(client):
    assert client.get("/api/slots").json() == {"grid": None, "cells": []}
    assert client.put("/api/slots/40", json={"look": "x"}, headers=CSRF).status_code == 404


def test_the_grid_is_checked(client):
    bad = [
        {**GRID, "first": 240},                     # reaches past 250
        {**GRID, "row_step": 1},                    # rows overlap (2 columns, 1 apart)
        {**GRID, "name": "G{row}-{col}"},           # no {name}
        {**GRID, "name": "G{bank} {name}"},         # unknown field
        {**GRID, "rows": 0},
    ]
    for b in bad:
        assert client.put("/api/slots/grid", json=b, headers=CSRF).status_code == 422, b


def test_cells_show_what_sits_where(client):
    s = setup(client, [look("G1-1 Calm", 40), look("Party", 46), look("Free")])
    assert [c["preset_id"] for c in s["cells"]] == [40, 41, 45, 46, 50, 51]
    assert cell(s, 1, 1) == {"row": 1, "col": 1, "preset_id": 40, "kind": "look", "name": "G1-1 Calm", "base": "Calm", "notes": []}
    assert cell(s, 2, 2)["name"] == "Party" and cell(s, 1, 2)["name"] is None


def test_filling_references_and_moves_without_copying(client):
    setup(client, [look("G1-1 Calm", 40, fx=3), look("Fire", fx=7)])
    r = client.put("/api/slots/40", json={"look": "Fire"}, headers=CSRF).json()
    assert r["filled"] == "Fire" and r["freed"] == ["G1-1 Calm"]
    looks = client.app.state.library.looks()
    assert "G1-1 Fire" not in looks
    assert looks["Fire"]["preset_id"] == 40 and looks["Fire"]["segments"][0]["fx"] == 7
    assert looks["G1-1 Calm"]["preset_id"] is None            # the old occupant keeps its name, not the slot


def test_names_fit_wleds_limit(client):
    name = "A rather long look name, 30 b!"            # fits alone, not with the slot's prefix
    setup(client, [look(name)])
    r = client.put("/api/slots/45", json={"look": name}, headers=CSRF).json()
    assert r["filled"] == name and len(r["filled"].encode()) <= 32


def test_playlists_fill_slots_too_without_copies(client):
    setup(client, [look("Calm")])
    client.put("/api/playlists/Evening", json={"name": "Evening", "entries": [{"look": "Calm"}]}, headers=CSRF)
    r = client.put("/api/slots/41", json={"playlist": "Evening"}, headers=CSRF).json()
    assert (cell(r, 1, 2)["kind"], cell(r, 1, 2)["name"]) == ("playlist", "Evening")
    assert client.app.state.library.playlists()["Evening"]["preset_id"] == 41


def test_clear_and_errors(client):
    setup(client, [look("G1-1 Calm", 40), look("Two", 40)])
    s = client.get("/api/slots").json()
    assert cell(s, 1, 1)["notes"] and "more than one" in cell(s, 1, 1)["notes"][0]
    r = client.delete("/api/slots/40", headers=CSRF).json()
    assert sorted(r["freed"]) == ["G1-1 Calm", "Two"] and cell(r, 1, 1)["name"] is None
    assert client.delete("/api/slots/42", headers=CSRF).status_code == 404       # not a slot
    assert client.put("/api/slots/40", json={"look": "nope"}, headers=CSRF).status_code == 404
    assert client.put("/api/slots/40", json={}, headers=CSRF).status_code == 422
    assert client.put("/api/slots/40", json={"look": "a", "playlist": "b"}, headers=CSRF).status_code == 422
    assert client.delete("/api/slots/grid", headers=CSRF).json() == {"grid": None, "cells": []}


def test_a_looks_new_preset_id_moves_it_in_the_grid(client):
    setup(client, [look("Calm", 40)])
    r = client.put("/api/looks/Calm/preset-id", json={"preset_id": 46}, headers=CSRF)
    assert r.status_code == 200
    slots = client.get("/api/slots").json()
    assert cell(slots, 1, 1)["name"] is None
    assert cell(slots, 2, 2)["name"] == "Calm" and cell(slots, 2, 2)["base"] == "Calm"
    # "also" leaves the primary id and stores a grid-only reference
    client.put("/api/slots/40", json={"look": "Calm", "mode": "also"}, headers=CSRF)
    assert client.app.state.library.looks()["Calm"]["preset_id"] == 46
    assert cell(client.get("/api/slots").json(), 1, 1)["name"] == "Calm"


def test_also_assignment_materializes_only_during_push(client):
    setup(client, [look("Calm", 46)])
    r = client.put("/api/slots/40", json={"look": "Calm", "mode": "also"}, headers=CSRF)
    assert r.status_code == 200
    from wledstudio.slots import expand_for_push
    from starlette.requests import Request
    scope = {"type": "http", "app": client.app}
    req = Request(scope)
    looks, playlists = expand_for_push(req, list(client.app.state.library.looks().values()), [])
    assert [(x["name"], x["preset_id"]) for x in looks] == [("Calm", 46), ("G1-1 Calm", 40)]
    assert client.app.state.library.looks()["Calm"]["preset_id"] == 46


def test_named_grids_migrate_once_and_keep_assignments_independent(client):
    setup(client, [look("Calm")])
    # Existing /api/slots/grid wrote the v2 format; simulate an old file to exercise migration.
    p = client.app.state.settings.data_dir / "slots.json"
    p.write_text(json.dumps({"grid": GRID, "assignments": {}}), encoding="utf-8")
    old = client.get("/api/slots/grids").json()
    assert old["current"] == "grid-1" and old["grids"][0]["name"] == "Remote A"
    created = client.post("/api/slots/grids", json={
        "name": "Remote B", "grid": {**GRID, "first": 101},
    }, headers=CSRF).json()
    assert created["name"] == "Remote B"
    assert len(client.get("/api/slots/grids").json()["grids"]) == 2
    migrated = list(p.parent.glob("slots-*.json"))
    assert len(migrated) == 1 and json.loads(migrated[0].read_text())["grid"] == GRID
    client.post(f"/api/slots/grids/{created['id']}/select", headers=CSRF)
    client.put("/api/slots/101", json={"look": "Calm"}, headers=CSRF)
    assert client.get("/api/slots?grid=grid-1").json()["cells"][0]["name"] is None
    assert cell(client.get("/api/slots").json(), 1, 1)["name"] == "Calm"
