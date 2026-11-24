# SPDX-License-Identifier: EUPL-1.2
"""Folders and order in the library: for people, never written to a device."""
from conftest import CSRF


def look(name, preset_id=None, **extra):
    return {"name": name, "preset_id": preset_id, "segments": [{"start": 0, "stop": 10, "fx": 0}], **extra}


def names(client):
    return [x["name"] for x in client.get("/api/looks").json()]


def test_folders(client):
    lib = client.app.state.library
    for n in ("Calm", "Fire", "Rain"):
        lib.put(look(n))
    r = client.post("/api/library/looks/folder", json={"names": ["Fire", "Rain"], "folder": " Storms "}, headers=CSRF)
    assert r.status_code == 200 and r.json()["folder"] == " Storms "
    looks = lib.looks()
    assert looks["Fire"]["folder"] == "Storms" and "folder" not in looks["Calm"]
    # saved again (a capture, an edit) it stays in its folder; an empty folder means none
    lib.put(look("Fire", fx=3))
    assert lib.looks()["Fire"]["folder"] == "Storms"
    lib.put(look("Rain", folder=""))
    assert "folder" not in lib.looks()["Rain"]
    # out of the folder
    client.post("/api/library/looks/folder", json={"names": ["Fire"], "folder": None}, headers=CSRF)
    assert "folder" not in lib.looks()["Fire"]
    assert client.post("/api/library/looks/folder", json={"names": ["Nope"], "folder": "X"}, headers=CSRF).status_code == 404
    assert client.post("/api/library/looks/folder", json={"names": ["Calm"], "folder": "a\nb"}, headers=CSRF).status_code == 422
    assert client.post("/api/library/things/folder", json={"names": ["Calm"]}, headers=CSRF).status_code == 422


def test_folder_rename_and_dissolve_cover_playlists_too(client):
    lib = client.app.state.library
    lib.put(look("Calm", folder="Evening"))
    client.put("/api/playlists/Slow", json={"name": "Slow", "entries": [{"look": "Calm"}], "folder": "Evening"}, headers=CSRF)
    r = client.post("/api/library/folders/rename", json={"from": "Evening", "to": "Night"}, headers=CSRF)
    assert r.json() == {"moved": 2}
    assert lib.looks()["Calm"]["folder"] == "Night" and lib.playlists()["Slow"]["folder"] == "Night"
    assert client.post("/api/library/folders/rename", json={"from": "Night", "to": None}, headers=CSRF).json() == {"moved": 2}
    assert "folder" not in lib.looks()["Calm"]
    assert client.post("/api/library/folders/rename", json={"from": "Night", "to": "X"}, headers=CSRF).status_code == 404


def test_order(client):
    lib = client.app.state.library
    for n in ("A", "B", "C"):
        lib.put(look(n))
    assert client.post("/api/library/looks/order", json={"names": ["C", "A", "B"]}, headers=CSRF).status_code == 200
    assert names(client) == ["C", "A", "B"]
    for bad in (["C", "A"], ["C", "A", "B", "B"], ["C", "A", "X"]):
        assert client.post("/api/library/looks/order", json={"names": bad}, headers=CSRF).status_code == 422, bad
    lib.put(look("A", fx=2))                                   # saved again: keeps its place
    assert names(client) == ["C", "A", "B"]


def test_folders_and_order_never_reach_the_device(client, dev_id, device):
    lib = client.app.state.library
    lib.put(look("Calm", preset_id=7, folder="Evening"))
    r = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF)
    assert r.status_code == 200, r.text
    assert device.presets["7"]["n"] == "Calm" and "folder" not in device.presets["7"]
