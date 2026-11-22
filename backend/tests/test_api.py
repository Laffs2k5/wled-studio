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
                {"seg": [{"id": 0, "col": [[1, 2]]}]}, {"seg": [{"id": 0, "c3": 32}]}, {"nl": {"on": True}}):
        r = client.post(f"/api/devices/{dev_id}/state", json=bad, headers=CSRF)
        assert r.status_code == 422, bad


def test_import_capture_apply_push(client, dev_id, device):
    device.presets = {"0": {}, "3": {"n": "Evening", "on": True, "bri": 90,
                                     "seg": [{"id": 0, "start": 0, "stop": 60, "fx": 8, "pal": 3, "sx": 10}]},
                      "9": {"n": "Mix", "playlist": {"ps": [3], "dur": [100]}}}
    r = client.post(f"/api/devices/{dev_id}/import", headers=CSRF).json()
    assert r == {"imported": ["Evening"], "kept_existing": [], "skipped_presets": ["9"]}
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
