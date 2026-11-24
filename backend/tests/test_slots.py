# SPDX-License-Identifier: EUPL-1.2
"""The slot grid, with made-up numbers: 3 rows of 2, from preset 40, rows 5 apart."""
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


def test_filling_copies_into_the_slot_and_frees_the_old_one(client):
    setup(client, [look("G1-1 Calm", 40, fx=3), look("Fire", fx=7)])
    r = client.put("/api/slots/40", json={"look": "Fire"}, headers=CSRF).json()
    assert r["filled"] == "G1-1 Fire" and r["freed"] == ["G1-1 Calm"]
    looks = client.app.state.library.looks()
    assert looks["G1-1 Fire"]["preset_id"] == 40 and looks["G1-1 Fire"]["segments"][0]["fx"] == 7
    assert looks["Fire"]["preset_id"] is None                 # the source stays as it was
    assert looks["G1-1 Calm"]["preset_id"] is None            # the old occupant keeps its name, not the slot
    # a slot look copied to another slot takes that slot's name
    r = client.put("/api/slots/51", json={"look": "G1-1 Fire"}, headers=CSRF).json()
    assert r["filled"] == "G3-2 Fire" and cell(r, 3, 2)["base"] == "Fire"


def test_names_fit_wleds_limit(client):
    name = "A rather long look name, 30 b!"            # fits alone, not with the slot's prefix
    setup(client, [look(name)])
    r = client.put("/api/slots/45", json={"look": name}, headers=CSRF).json()
    assert len(r["filled"].encode()) <= 32 and r["filled"].startswith("G2-1 A rather long")


def test_playlists_fill_slots_too(client):
    setup(client, [look("Calm")])
    client.put("/api/playlists/Evening", json={"name": "Evening", "entries": [{"look": "Calm"}]}, headers=CSRF)
    r = client.put("/api/slots/41", json={"playlist": "Evening"}, headers=CSRF).json()
    assert (cell(r, 1, 2)["kind"], cell(r, 1, 2)["name"]) == ("playlist", "G1-2 Evening")
    assert client.app.state.library.playlists()["G1-2 Evening"]["preset_id"] == 41


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
    # a slot look given another slot's id is flagged, not renamed
    client.put("/api/slots/40", json={"look": "Calm"}, headers=CSRF)        # G1-1 Calm, a copy
    client.put("/api/looks/G1-1%20Calm/preset-id", json={"preset_id": 41}, headers=CSRF)
    assert cell(client.get("/api/slots").json(), 1, 2)["notes"] == ["its name is another slot's"]
