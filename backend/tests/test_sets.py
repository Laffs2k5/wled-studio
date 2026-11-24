# SPDX-License-Identifier: EUPL-1.2
"""Per-device sets: which looks and playlists go on which device."""
from conftest import CSRF


def look(name, preset_id):
    return {"name": name, "preset_id": preset_id, "segments": [{"start": 0, "stop": 10, "fx": 0}]}


def setup(client):
    lib = client.app.state.library
    for i, n in enumerate(("Calm", "Fire", "Rain", "Party"), start=1):
        lib.put(look(n, i))
    client.put("/api/playlists/Storm", json={"name": "Storm", "preset_id": 9, "entries": [{"look": "Fire"}, {"look": "Rain"}]},
               headers=CSRF)
    return lib


def test_a_device_without_a_set_gets_everything(client, dev_id):
    setup(client)
    s = client.get(f"/api/devices/{dev_id}/set").json()
    assert {k: s[k] for k in ("all", "looks", "playlists", "brought")} == {"all": True, "looks": [], "playlists": [], "brought": []}
    assert s["on_device"] == {"looks": ["Calm", "Fire", "Rain", "Party"], "playlists": ["Storm"]}
    rows = client.get(f"/api/devices/{dev_id}/check").json()
    assert {r.get("look") or r.get("playlist") for r in rows} == {"Calm", "Fire", "Rain", "Party", "Storm"}


def test_a_set_limits_writes_checks_and_brings_a_playlists_looks(client, dev_id, device):
    setup(client)
    r = client.put(f"/api/devices/{dev_id}/set", json={"looks": ["Party", "Calm"], "playlists": ["Storm"]}, headers=CSRF)
    s = r.json()
    assert {k: s[k] for k in ("all", "looks", "playlists", "brought")} == {
        "all": False, "looks": ["Calm", "Party"], "playlists": ["Storm"], "brought": ["Storm brings Fire, Rain"]}
    assert s["on_device"]["looks"] == ["Calm", "Fire", "Rain", "Party"]
    rows = client.get(f"/api/devices/{dev_id}/check").json()
    assert {r.get("look") or r.get("playlist") for r in rows} == {"Calm", "Party", "Fire", "Rain", "Storm"}
    # without the playlist, only the chosen looks go on the device
    client.put(f"/api/devices/{dev_id}/set", json={"looks": ["Calm"]}, headers=CSRF)
    done = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF).json()
    assert done["set_notes"] == []
    assert set(device.presets) == {"0", "1"} and device.presets["1"]["n"] == "Calm"


def test_copy_to_a_device_and_take_out(client, dev_id):
    setup(client)
    # from "everything", taking one out leaves a set of the rest
    r = client.post(f"/api/devices/{dev_id}/set/remove", json={"looks": ["Party"]}, headers=CSRF).json()
    assert r["looks"] == ["Calm", "Fire", "Rain"] and r["playlists"] == ["Storm"]
    r = client.post(f"/api/devices/{dev_id}/set/add", json={"looks": ["Party"]}, headers=CSRF).json()
    assert r["looks"] == ["Calm", "Fire", "Rain", "Party"]
    assert client.post(f"/api/devices/{dev_id}/set/add", json={"looks": ["Nope"]}, headers=CSRF).status_code == 404
    # back to everything
    assert client.put(f"/api/devices/{dev_id}/set", json={"looks": None}, headers=CSRF).json()["all"] is True


def test_sets_follow_renames_and_deletes_and_go_with_the_device(client, dev_id):
    lib = setup(client)
    client.put(f"/api/devices/{dev_id}/set", json={"looks": ["Calm", "Fire"], "playlists": ["Storm"]}, headers=CSRF)
    client.post("/api/looks/Calm/rename", json={"to": "Quiet"}, headers=CSRF)
    client.delete("/api/looks/Fire", headers=CSRF)
    client.delete("/api/playlists/Storm", headers=CSRF)
    assert lib.device_set(dev_id) == {"looks": ["Quiet"], "playlists": []}
    assert client.delete(f"/api/devices/{dev_id}", headers=CSRF).status_code == 204
    assert lib.device_set(dev_id) is None
    assert client.get("/api/devices/nope/set").status_code == 404
