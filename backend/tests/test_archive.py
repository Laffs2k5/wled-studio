# SPDX-License-Identifier: EUPL-1.2
"""The portable studio file: what an export holds, that it imports back unchanged, and what an
import refuses. Made-up devices and numbers only."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from conftest import CSRF, private_resolver
from wledstudio.app import create_app
from wledstudio.config import Settings
from wledstudio.fakewled import FakeDevice
from wledstudio.fakewled import create_app as fake_app

JSON = {**CSRF, "Content-Type": "application/json"}
ROOM = {"edges": [{"direction": "right", "pixels": 30, "label": "North"},
                  {"direction": "down", "pixels": 20, "label": "East"}],
        "zones": [{"label": "Desk", "start": 5, "stop": 12}]}


def fresh(tmp_path, sub):
    transport = httpx.ASGITransport(app=fake_app(FakeDevice()))
    s = Settings(data_dir=tmp_path / sub, allowed_hosts=["testserver"])
    c = TestClient(create_app(s, transport_for=lambda dev: transport, resolver=private_resolver))
    did = c.post("/api/devices", json={"name": "Desk strip", "host": "wled-desk.lan"}, headers=CSRF).json()["id"]
    return c, did


def build_library(client, dev_id, device):
    """A library made the ways the app makes one: imported, captured (with and without the
    layout), edited, organised, with a room, a set, a grid with both kinds of fill, protected ids."""
    assert client.put(f"/api/devices/{dev_id}/room", json=ROOM, headers=CSRF).status_code == 200
    device.presets = {"0": {}, "3": {"n": "Evening", "on": True, "bri": 90, "ql": "E",
                                     "seg": [{"id": 0, "start": 0, "stop": 50, "fx": 8, "pal": 3, "sx": 10}]},
                      "9": {"n": "Mix", "playlist": {"ps": [3], "dur": [100]}}}
    client.post(f"/api/devices/{dev_id}/import", headers=CSRF)
    client.post(f"/api/devices/{dev_id}/state", json={"seg": [{"id": 0, "fx": 4, "ix": 77}]}, headers=CSRF)
    assert client.post(f"/api/devices/{dev_id}/capture/Rain?preset_id=4", headers=CSRF).status_code == 200
    assert client.post(f"/api/devices/{dev_id}/capture/Colours?layout=false", headers=CSRF).status_code == 200
    client.put("/api/palettes/Dusk", json={"name": "Dusk", "stops": [[0, "ff0000"], [255, "0000ff"]]}, headers=CSRF)
    client.put("/api/playlists/Night", json={"name": "Night", "preset_id": 20, "end": "Rain",
                                             "entries": [{"look": "Rain", "duration": 50}, {"look": "Evening"}]},
               headers=CSRF)
    client.post("/api/library/looks/folder", json={"names": ["Rain"], "folder": "Weather"}, headers=CSRF)
    client.post("/api/library/looks/order", json={"names": ["Rain", "Colours", "Evening"]}, headers=CSRF)
    client.put(f"/api/devices/{dev_id}/set", json={"looks": ["Rain", "Evening"], "playlists": ["Night"]}, headers=CSRF)
    grid = {"rows": 2, "cols": 2, "first": 40, "row_step": 10, "name": "G{row}·{col} {name}"}
    assert client.post("/api/slots/grids", json={"name": "Hall remote", "grid": grid}, headers=CSRF).status_code == 201
    client.put("/api/slots/41", json={"look": "Colours"}, headers=CSRF)
    client.put("/api/slots/50", json={"look": "Rain", "mode": "also"}, headers=CSRF)
    client.put("/api/protected-presets", json=[{"id": 1, "label": "Hall automation"}], headers=CSRF)


def library_without_source(client):
    """The library as an archive carries it: no `source`, and no fields set to null (an import
    stores an absent field and a null one alike)."""
    lib = client.app.state.library.load()
    for kind in ("looks", "playlists", "palettes"):
        for name, item in lib[kind].items():
            lib[kind][name] = {k: v for k, v in item.items() if v is not None and k != "source"}
    return lib


def test_an_export_imports_into_a_new_studio_unchanged(tmp_path):
    a, a_dev = fresh(tmp_path, "a")
    device = FakeDevice()
    a.app.state.transport_for = lambda dev: httpx.ASGITransport(app=fake_app(device))
    build_library(a, a_dev, device)
    exported = a.get("/api/library/archive")
    assert exported.status_code == 200
    archive = exported.json()
    assert archive["version"] == 2 and "Desk strip" in archive["devices"]
    text = exported.text
    assert "wled-desk.lan" not in text and a_dev not in text and '"source"' not in text

    b, b_dev = fresh(tmp_path, "b")
    preview = b.post("/api/library/archive/import?preview=true", content=text, headers=JSON)
    assert preview.status_code == 200, preview.text
    assert preview.json()["looks"] == 3 and preview.json()["rooms"] == ["Desk strip"]
    assert b.app.state.library.load()["looks"] == {}       # a preview writes nothing
    r = b.post("/api/library/archive/import", content=text, headers=JSON)
    assert r.status_code == 200, r.text

    want, got = library_without_source(a), library_without_source(b)
    for kind in ("looks", "playlists", "palettes"):
        assert got[kind] == want[kind], kind
        assert list(got[kind]) == list(want[kind]), f"{kind} order"
    assert got["sets"] == {b_dev: want["sets"][a_dev]}
    assert b.get(f"/api/devices/{b_dev}/room").json() == a.get(f"/api/devices/{a_dev}/room").json()
    strip = lambda g: [(x["name"], x["grid"], x["cells"]) for x in g["grids"]]  # noqa: E731
    assert strip(b.get("/api/slots/grids").json()) == strip(a.get("/api/slots/grids").json())
    assert b.get("/api/protected-presets").json() == a.get("/api/protected-presets").json()
    # and a second export is the same file
    assert b.get("/api/library/archive").json() == archive


def test_keep_leaves_what_is_here_and_replace_overwrites(tmp_path):
    a, _ = fresh(tmp_path, "a")
    a.put("/api/looks/Calm", json={"name": "Calm", "bri": 10, "segments": []}, headers=CSRF)
    text = a.get("/api/library/archive").text
    b, _ = fresh(tmp_path, "b")
    b.put("/api/looks/Calm", json={"name": "Calm", "bri": 200, "segments": []}, headers=CSRF)
    assert b.post("/api/library/archive/import", content=text, headers=JSON).json()["kept"] == ["Calm"]
    assert b.app.state.library.looks()["Calm"]["bri"] == 200
    b.post("/api/library/archive/import?mode=replace", content=text, headers=JSON)
    assert b.app.state.library.looks()["Calm"]["bri"] == 10


def test_a_version_1_file_still_imports(client):
    v1 = {"format": "wled-studio-library", "version": 1, "palettes": {},
          "looks": {"Calm": {"name": "Calm", "segments": []}},
          "playlists": {"Loop": {"name": "Loop", "entries": [{"look": "Calm"}]}}}
    r = client.post("/api/library/archive/import", content=json.dumps(v1), headers=JSON)
    assert r.status_code == 200 and r.json()["looks"] == 1 and r.json()["playlists"] == 1


@pytest.mark.parametrize("change, says", [
    (lambda a: a["palettes"].update(Bad={"name": "Bad", "stops": [[0, "ff0000"], [300, "00ff00"]]}), "palette 'Bad'"),
    (lambda a: a["looks"].update({"x" * 40: {"name": "x" * 40, "segments": []}}), "at most 32 bytes"),
    (lambda a: a["looks"]["Calm"].update(reboot=True), "look 'Calm'"),
    (lambda a: a.update(version=3), "version 1 or 2"),
    (lambda a: a.update(extra={}), "sections"),
    (lambda a: a["slot_grids"].append({"name": "G", "assignments": {"7": {"kind": "look", "name": "Calm"}},
                                       "grid": {"rows": 1, "cols": 1, "first": 5, "row_step": 1,
                                                "name": "{name}xxxxx"}}), "isn't one of its slots"),
    (lambda a: a["slot_grids"].append({"name": "G", "assignments": {"5": {"kind": "look", "name": "Gone"}},
                                       "grid": {"rows": 1, "cols": 1, "first": 5, "row_step": 1,
                                                "name": "{name}xxxxx"}}), "missing look 'Gone'"),
    (lambda a: a["devices"].update({"Desk strip": {"room": {"edges": []}}}), "devices"),
])
def test_an_import_refuses_a_bad_file_and_writes_nothing(client, dev_id, change, says):
    client.put("/api/looks/Calm", json={"name": "Calm", "segments": []}, headers=CSRF)
    archive = client.get("/api/library/archive").json()
    before = client.app.state.library.load()
    change(archive)
    r = client.post("/api/library/archive/import?mode=replace", content=json.dumps(archive), headers=JSON)
    assert r.status_code == 422 and says in r.json()["detail"], r.text
    assert client.app.state.library.load() == before


def test_device_sections_apply_only_to_devices_with_that_name(tmp_path):
    a, a_dev = fresh(tmp_path, "a")
    a.put(f"/api/devices/{a_dev}/room", json=ROOM, headers=CSRF)
    a.patch(f"/api/devices/{a_dev}", json={"name": "Other strip"}, headers=CSRF)
    text = a.get("/api/library/archive").text
    b, b_dev = fresh(tmp_path, "b")
    r = b.post("/api/library/archive/import", content=text, headers=JSON).json()
    assert r["unmatched_devices"] == ["Other strip"] and r["rooms"] == []
    assert b.get(f"/api/devices/{b_dev}/room").json() is None

