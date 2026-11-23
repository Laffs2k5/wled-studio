# SPDX-License-Identifier: EUPL-1.2
import json

from conftest import CSRF


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_add_list_remove_device(client):
    r = client.post("/api/devices", json={"name": "Desk", "host": "wled.lan", "pin": "1234"}, headers=CSRF)
    assert r.status_code == 201
    body = r.json()
    assert body["has_pin"] is True and "pin" not in body
    listed = client.get("/api/devices").json()
    assert listed == [{"id": "desk", "name": "Desk", "host": "wled.lan", "has_pin": True}]
    assert "1234" not in json.dumps(listed)
    assert client.delete("/api/devices/desk", headers=CSRF).status_code == 204
    assert client.delete("/api/devices/desk", headers=CSRF).status_code == 404


def test_device_host_is_validated(client):
    r = client.post("/api/devices", json={"name": "x", "host": "http://evil/path"}, headers=CSRF)
    assert r.status_code == 422


def test_unknown_fields_refused(client):
    r = client.post("/api/devices", json={"name": "x", "host": "wled.lan", "admin": True}, headers=CSRF)
    assert r.status_code == 422


def test_set_and_clear_pin(client, dev_id):
    assert client.put(f"/api/devices/{dev_id}/pin", json={"pin": "42"}, headers=CSRF).status_code == 204
    assert client.get("/api/devices").json()[0]["has_pin"] is True
    assert client.put(f"/api/devices/{dev_id}/pin", json={"pin": None}, headers=CSRF).status_code == 204
    assert client.get("/api/devices").json()[0]["has_pin"] is False
    assert client.put("/api/devices/nope/pin", json={"pin": "1"}, headers=CSRF).status_code == 404


def test_profile(client, dev_id):
    p = client.get(f"/api/devices/{dev_id}/profile").json()
    names = [e["name"] for e in p["effects"]]
    assert "RSVD" not in names and "Comet" in names
    comet = next(e for e in p["effects"] if e["name"] == "Comet")
    assert [c["label"] for c in comet["controls"]] == ["Speed", "Tail"]
    meter = next(e for e in p["effects"] if e["name"] == "Pulse Meter")
    assert meter["audio"] == ["volume"]
    assert p["leds"]["count"] == 60
    assert len(p["fingerprint"]) == 64
    assert client.get("/api/devices/nope/profile").status_code == 404


def test_live_state(client, dev_id, device):
    r = client.post(f"/api/devices/{dev_id}/state", json={"bri": 33, "seg": [{"id": 0, "fx": 8, "ix": 9}]},
                    headers=CSRF)
    assert r.status_code == 200
    assert device.state["bri"] == 33 and device.state["seg"][0]["fx"] == 8
    assert client.get(f"/api/devices/{dev_id}/state").json()["bri"] == 33


def test_live_state_is_whitelisted(client, dev_id, device):
    for bad in ({"pin": "1234"}, {"bri": 300}, {"seg": [{"id": 0, "fx": 8, "x": 1}]},
                {"seg": [{"id": 0, "col": [[1, 2]]}]}, {"seg": [{"id": 0, "c3": 32}]}, {"nl": {"on": True}},
                {"seg": [{"id": 0, "grp": 0}]}, {"seg": [{"id": 0, "spc": 256}]}, {"seg": [{"id": 0, "of": -1}]}):
        r = client.post(f"/api/devices/{dev_id}/state", json=bad, headers=CSRF)
        assert r.status_code == 422, bad


def test_layout_fields_reach_the_device(client, dev_id, device):
    r = client.post(f"/api/devices/{dev_id}/state", json={"seg": [{"id": 0, "grp": 2, "spc": 1, "of": 5, "bm": 10}]},
                    headers=CSRF)
    assert r.status_code == 200
    assert {k: device.state["seg"][0][k] for k in ("grp", "spc", "of", "bm")} == {"grp": 2, "spc": 1, "of": 5, "bm": 10}


def test_import_capture_apply_push(client, dev_id, device):
    device.presets = {"0": {}, "3": {"n": "Evening", "on": True, "bri": 90,
                                     "seg": [{"id": 0, "start": 0, "stop": 60, "fx": 8, "pal": 3, "sx": 10}]},
                      "9": {"n": "Mix", "playlist": {"ps": [3], "dur": [100]}}}
    r = client.post(f"/api/devices/{dev_id}/import", headers=CSRF).json()
    assert r == {"imported": ["Evening"], "kept_existing": [], "imported_playlists": ["Mix"], "skipped_presets": []}
    assert client.get("/api/playlists").json()[0]["entries"] == [{"look": "Evening", "duration": 100, "transition": 7}]
    looks = client.get("/api/looks").json()
    assert looks[0]["segments"][0]["effect"] == "Comet"
    assert looks[0]["segments"][0]["palette"] == "Sunset Haze"

    # importing again keeps what's there
    assert client.post(f"/api/devices/{dev_id}/import", headers=CSRF).json()["kept_existing"] == ["Evening"]

    # capture the live state as a new look in slot 4
    client.post(f"/api/devices/{dev_id}/state", json={"seg": [{"id": 0, "fx": 4, "ix": 77}]}, headers=CSRF)
    cap = client.post(f"/api/devices/{dev_id}/capture/Rain?preset_id=4", headers=CSRF)
    assert cap.status_code == 200 and cap.json()["segments"][0]["effect"] == "Sparkle Rain"

    # apply a look live
    a = client.post(f"/api/devices/{dev_id}/apply/Evening", headers=CSRF)
    assert a.status_code == 200 and device.state["seg"][0]["fx"] == 8
    assert client.post(f"/api/devices/{dev_id}/apply/Nope", headers=CSRF).status_code == 404

    # dry run, then push
    dry = client.post(f"/api/devices/{dev_id}/push", json={}, headers=CSRF).json()
    assert dry["done"] is False and dry["changed_ids"] == ["4"]
    done = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF).json()
    assert done["done"] is True, done
    assert device.presets["4"]["n"] == "Rain"
    assert device.presets["9"]["n"] == "Mix"  # untouched
    assert len(client.get(f"/api/devices/{dev_id}/backups").json()) == 1


def test_showing_a_captured_look_restores_its_segment_layout(client, dev_id, device):
    two = {"seg": [{"id": 0, "start": 0, "stop": 30}, {"id": 1, "start": 30, "stop": 60, "fx": 4}]}
    client.post(f"/api/devices/{dev_id}/state", json=two, headers=CSRF)
    assert client.post(f"/api/devices/{dev_id}/capture/Two", headers=CSRF).status_code == 200
    client.post(f"/api/devices/{dev_id}/state", json={"seg": [{"id": 1, "stop": 0}, {"id": 0, "stop": 60}]},
                headers=CSRF)
    assert client.post(f"/api/devices/{dev_id}/capture/One", headers=CSRF).status_code == 200

    client.post(f"/api/devices/{dev_id}/apply/Two", headers=CSRF)
    assert [(s["id"], s["start"], s["stop"], s["fx"]) for s in device.state["seg"]] == [(0, 0, 30, 0), (1, 30, 60, 4)]
    client.post(f"/api/devices/{dev_id}/apply/One", headers=CSRF)
    assert [(s["id"], s["start"], s["stop"]) for s in device.state["seg"]] == [(0, 0, 60)]  # segment 1 deleted


def test_push_stops_on_drift(client, dev_id, device):
    client.post(f"/api/devices/{dev_id}/capture/A?preset_id=1", headers=CSRF)
    assert client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF).json()["done"]
    device.presets["20"] = {"n": "made elsewhere"}
    client.post(f"/api/devices/{dev_id}/capture/B?preset_id=2", headers=CSRF)
    r = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF).json()
    assert r["done"] is False and r["drift"] is True
    r = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False, "adopt_drift": True}, headers=CSRF).json()
    assert r["done"] is True
    assert device.presets["20"] == {"n": "made elsewhere"} and device.presets["2"]["n"] == "B"


def test_push_with_pin(client, dev_id, device):
    device.pin = "4711"
    client.post(f"/api/devices/{dev_id}/capture/A?preset_id=1", headers=CSRF)
    r = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF)
    assert r.status_code == 423  # no PIN stored
    client.put(f"/api/devices/{dev_id}/pin", json={"pin": "4711"}, headers=CSRF)
    r = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF).json()
    assert r["done"] is True and device.presets["1"]["n"] == "A"


def test_looks_crud(client):
    look = {"name": "Calm", "preset_id": 5, "segments": [{"start": 0, "stop": 10, "effect": "Glow", "sx": 3}]}
    assert client.put("/api/looks/Calm", json=look, headers=CSRF).status_code == 200
    assert client.put("/api/looks/Other", json=look, headers=CSRF).status_code == 422
    assert client.put("/api/looks/" + "x" * 40, json={**look, "name": "x" * 40}, headers=CSRF).status_code == 422
    assert client.put("/api/looks/Calm", json={**look, "preset_id": 300}, headers=CSRF).status_code == 422
    assert client.delete("/api/looks/Calm", headers=CSRF).status_code == 204
    assert client.delete("/api/looks/Calm", headers=CSRF).status_code == 404


def test_device_down(settings):
    import httpx
    from fastapi.testclient import TestClient

    from conftest import private_resolver
    from wledstudio.app import create_app

    def down(request):
        raise httpx.ConnectError("down")

    app = create_app(settings, transport_for=lambda d: httpx.MockTransport(down), resolver=private_resolver)
    c = TestClient(app)
    did = c.post("/api/devices", json={"name": "x", "host": "wled.lan"}, headers=CSRF).json()["id"]
    for path in ("profile", "state", "presets"):
        assert c.get(f"/api/devices/{did}/{path}").status_code == 502


def test_capture_applies_the_mic_rule(client, dev_id, device):
    device.audio_enabled = True
    client.post(f"/api/devices/{dev_id}/state", json={"seg": [{"id": 0, "fx": 8}]}, headers=CSRF)  # Comet
    calm = client.post(f"/api/devices/{dev_id}/capture/Calm", headers=CSRF).json()
    assert calm["mic"] is False  # not made for sound: switches the mic off, even though it's on now
    client.post(f"/api/devices/{dev_id}/state", json={"seg": [{"id": 0, "fx": 5}]}, headers=CSRF)  # Pulse Meter (v)
    loud = client.post(f"/api/devices/{dev_id}/capture/Loud", headers=CSRF).json()
    assert loud["mic"] is True
    client.post(f"/api/devices/{dev_id}/apply/Calm", headers=CSRF)
    assert device.audio_enabled is False
    client.post(f"/api/devices/{dev_id}/apply/Loud", headers=CSRF)
    assert device.audio_enabled is True


def test_playlists(client, dev_id, device):
    client.post(f"/api/devices/{dev_id}/state", json={"seg": [{"id": 0, "fx": 8}]}, headers=CSRF)
    client.post(f"/api/devices/{dev_id}/capture/A?preset_id=1", headers=CSRF)
    client.post(f"/api/devices/{dev_id}/state", json={"seg": [{"id": 0, "fx": 4}]}, headers=CSRF)
    client.post(f"/api/devices/{dev_id}/capture/B?preset_id=2", headers=CSRF)
    client.post(f"/api/devices/{dev_id}/capture/Loose", headers=CSRF)
    pl = {"name": "Party", "preset_id": 10, "entries": [{"look": "A", "duration": 300}, {"look": "B", "duration": 50}],
          "shuffle": True, "end": "A"}
    assert client.put("/api/playlists/Party", json=pl, headers=CSRF).status_code == 200
    bad = {**pl, "name": "Bad", "preset_id": 11, "entries": [{"look": "Loose"}]}
    assert client.put("/api/playlists/Bad", json=bad, headers=CSRF).status_code == 200
    clash = {**pl, "name": "Clash", "preset_id": 1}
    client.put("/api/playlists/Clash", json=clash, headers=CSRF)
    r = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF).json()
    assert r["done"] is True
    status = {x.get("playlist"): x for x in r["report"] if "playlist" in x}
    assert status["Party"]["status"] == "ok"
    assert status["Bad"]["status"] == "unavailable" and "no slot" in status["Bad"]["notes"][0]
    assert status["Clash"]["status"] == "unavailable"
    assert device.presets["10"] == {"n": "Party", "playlist": {"ps": [1, 2], "dur": [300, 50], "transition": [7, 7],
                                                               "repeat": 0, "r": True, "end": 1}}
    assert device.presets["1"]["n"] == "A"  # the clash didn't overwrite the look
    # validation
    assert client.put("/api/playlists/X", json={"name": "X", "entries": []}, headers=CSRF).status_code == 422
    assert client.put("/api/playlists/X", json={"name": "Y", "entries": [{"look": "A"}]}, headers=CSRF).status_code == 422
    assert client.delete("/api/playlists/Party", headers=CSRF).status_code == 204
    assert client.delete("/api/playlists/Party", headers=CSRF).status_code == 404


def test_unchanged_playlist_isnt_rewritten(client, dev_id, device):
    device.presets = {"0": {}, "3": {"n": "Evening", "seg": [{"id": 0, "start": 0, "stop": 60, "fx": 8}]},
                      "9": {"n": "Mix", "playlist": {"ps": [3], "dur": [100]}}}
    client.post(f"/api/devices/{dev_id}/import", headers=CSRF)
    r = client.post(f"/api/devices/{dev_id}/push", json={}, headers=CSRF).json()
    assert "9" not in r["changed_ids"]


def test_custom_palettes(client, dev_id, device):
    sunset = {"name": "Warm sunset", "stops": [[0, "ff2200"], [128, "ffaa00"], [255, "330066"]]}
    assert client.put("/api/palettes/Warm%20sunset", json=sunset, headers=CSRF).status_code == 200
    ice = {"name": "Ice", "stops": [[0, "FFFFFF"], [255, "0044ff"]]}
    assert client.put("/api/palettes/Ice", json=ice, headers=CSRF).json()["stops"][0] == [0, "ffffff"]
    for bad in ({"name": "B", "stops": [[0, "ff0000"]]},
                {"name": "B", "stops": [[10, "ff0000"], [255, "00ff00"]]},
                {"name": "B", "stops": [[0, "ff0000"], [0, "00ff00"], [255, "0000ff"]]},
                {"name": "B", "stops": [[0, "red"], [255, "00ff00"]]}):
        assert client.put("/api/palettes/B", json=bad, headers=CSRF).status_code == 422

    # a look that uses a custom palette by name
    look = {"name": "Dusk", "preset_id": 4, "segments": [{"start": 0, "stop": 60, "effect": "Comet",
                                                           "palette": "Warm sunset"}]}
    client.put("/api/looks/Dusk", json=look, headers=CSRF)
    dry = client.post(f"/api/devices/{dev_id}/push", json={}, headers=CSRF).json()
    assert sorted(p["palette"] for p in dry["palettes"]) == ["Ice", "Warm sunset"]
    done = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF).json()
    assert done["done"] is True
    # files on the device, by index; ids count down from 200
    assert device.palette_files[0] == {"palette": [0, "ffffff", 255, "0044ff"]}            # Ice (sorted first)
    assert device.palette_files[1] == {"palette": [0, "ff2200", 128, "ffaa00", 255, "330066"]}
    assert device.presets["4"]["seg"][0]["pal"] == 199

    # the profile names them; capture maps the id back to the name
    prof = client.get(f"/api/devices/{dev_id}/profile").json()
    assert {"id": 199, "name": "Warm sunset", "custom": True} in prof["palettes"]
    client.post(f"/api/devices/{dev_id}/state", json={"seg": [{"id": 0, "fx": 8, "pal": 200}]}, headers=CSRF)
    cap = client.post(f"/api/devices/{dev_id}/capture/Cold", headers=CSRF).json()
    assert cap["segments"][0]["palette"] == "Ice"

    # unchanged palettes aren't uploaded again; a changed one is, at the same index
    device.uploads.clear()
    client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF)
    assert not any(u.startswith("palette") for u in device.uploads)
    client.put("/api/palettes/Ice", json={"name": "Ice", "stops": [[0, "eeeeff"], [255, "0000ff"]]}, headers=CSRF)
    r = client.post(f"/api/devices/{dev_id}/push", json={"dry_run": False}, headers=CSRF).json()
    assert [p["file"] for p in r["palettes"]] == ["palette0.json"]
    assert device.palette_files[0]["palette"][1] == "eeeeff"
    assert client.delete("/api/palettes/Ice", headers=CSRF).status_code == 204
    assert client.delete("/api/palettes/Ice", headers=CSRF).status_code == 404


def test_room_model(client, dev_id):
    assert client.get(f"/api/devices/{dev_id}/room").json() is None
    room = {"edges": [{"direction": "right", "pixels": 40, "label": "A"}, {"direction": "down", "pixels": 84},
                      {"direction": "left", "pixels": 41}, {"direction": "up", "pixels": 85}]}
    assert client.put(f"/api/devices/{dev_id}/room", json=room, headers=CSRF).status_code == 200
    assert client.get(f"/api/devices/{dev_id}/room").json() == room
    for bad in ({"edges": []}, {"edges": [{"direction": "north", "pixels": 3}]},
                {"edges": [{"direction": "up", "pixels": 0}]}, {"edges": [{"direction": "up", "pixels": 4000}] * 2},
                {"edges": [{"direction": "up", "pixels": 3, "x": 1}]}):
        assert client.put(f"/api/devices/{dev_id}/room", json=bad, headers=CSRF).status_code == 422
    assert client.delete(f"/api/devices/{dev_id}/room", headers=CSRF).status_code == 204
    assert client.get(f"/api/devices/{dev_id}/room").json() is None
    assert client.get("/api/devices/nope/room").status_code == 404
