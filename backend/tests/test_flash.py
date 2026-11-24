# SPDX-License-Identifier: EUPL-1.2
"""Flashing and reverting, against a fake builder and the fake device (its /update model)."""
import hashlib
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from conftest import CSRF, private_resolver
from wledstudio.app import create_app
from wledstudio.config import Settings
from wledstudio.fakewled.app import EFFECTS
from wledstudio.notice import VERSION as NOTICE

JID = "b" * 32
IMAGE = b"\xe9" + b"\x01" * 4095                       # an ESP32 app image, as far as anyone checks
NEW = ("Sky Test", "Strikes,Size;!,!;;1")               # the effect the image adds


def image_effects():
    return list(EFFECTS) + [NEW]


def builder(passed=True, sha=None):
    def handle(request: httpx.Request):
        path = request.url.path
        if path == f"/jobs/{JID}":
            report = {"passed": passed, "checks": {"stock_matches_verified": True, "only_usermod_objects_changed": passed},
                      "app_slot_bytes": 1572864, "target": "board", "usermods": ["fx"],
                      "custom": {"firmware_size": len(IMAGE), "firmware_sha256": sha or hashlib.sha256(IMAGE).hexdigest()}}
            return httpx.Response(200, json={"id": JID, "state": "passed" if passed else "failed", "report": report})
        if path == f"/jobs/{JID}/effects.json":
            return httpx.Response(200, json={"effects": [{"id": i, "name": n, "meta": m} for i, (n, m) in enumerate(image_effects())]})
        if path == f"/jobs/{JID}/firmware.bin":
            return httpx.Response(200, content=IMAGE)
        return httpx.Response(404, json={"detail": "not found"})
    return httpx.MockTransport(handle)


@pytest.fixture
def make(tmp_path, device, device_transport):
    clients = []

    def _make(flashing=True, cert_header=None, passed=True, sha=None, pin=True):
        s = Settings(data_dir=tmp_path / f"d{len(clients)}", allowed_hosts=["testserver"], builder_url="http://builder:8090",
                     flashing=flashing, flash_cert_header=cert_header)
        app = create_app(s, transport_for=lambda d: device_transport, resolver=private_resolver,
                         builder_transport=builder(passed, sha))
        app.state.flash_timing = (0.05, 5.0)
        c = TestClient(app)
        c.__enter__()               # keep the event loop between requests: flashes run in the background
        clients.append(c)
        body = {"name": "Desk", "host": "wled-desk.lan"}
        if pin:
            body["pin"] = "1234"
        dev = c.post("/api/devices", json=body, headers=CSRF).json()["id"]
        return c, dev, s

    device.pin = "1234"
    device.flash_effects = image_effects()
    device.reboot_seconds = 0.2
    yield _make
    for c in clients:
        c.__exit__(None, None, None)


def wait(c, rid):
    for _ in range(200):
        run = c.get(f"/api/flashes/{rid}").json()
        if run["state"] != "running":
            return run
        time.sleep(0.05)
    raise AssertionError("still running")


def blocks(plan):
    return {x["id"] for x in plan["checks"] if x["level"] == "block"}


def test_flashing_is_off_unless_turned_on(make, device):
    c, dev, _ = make(flashing=False)
    plan = c.get(f"/api/firmware/jobs/{JID}/flash-plan", params={"device": dev}).json()
    assert not plan["can_flash"] and blocks(plan) == {"enabled"}
    r = c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF)
    assert r.status_code == 403
    assert c.post(f"/api/devices/{dev}/revert", json={"confirm": "Desk", "notice": NOTICE}, headers=CSRF).status_code == 403
    assert device.flashes == 0


def test_the_client_certificate_header_is_required_when_configured(make):
    c, dev, _ = make(cert_header="X-Client-Cert")
    url = f"/api/firmware/jobs/{JID}/flash-plan"
    assert blocks(c.get(url, params={"device": dev}).json()) == {"certificate"}
    assert c.get(url, params={"device": dev}, headers={"X-Client-Cert": "  "}).json()["can_flash"] is False
    assert c.get(url, params={"device": dev}, headers={"X-Client-Cert": "ab:cd"}).json()["can_flash"] is True


def test_flash_backs_up_uploads_waits_and_checks(make, device, tmp_path):
    c, dev, s = make()
    plan = c.get(f"/api/firmware/jobs/{JID}/flash-plan", params={"device": dev}).json()
    assert plan["can_flash"], plan["checks"]
    assert plan["image"]["size"] == len(IMAGE) and plan["running"]["ver"] == "16.0.1"
    assert c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "desk", "notice": NOTICE}, headers=CSRF).status_code == 400
    r = c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF)
    assert r.status_code == 202, r.text
    run = wait(c, r.json()["id"])
    assert run["state"] == "done", run
    assert [x["name"] for x in run["steps"]] == ["backup", "image", "upload", "restart", "checks"]
    assert "Update successful" in run["steps"][2]["detail"]
    assert "the effect list is the image's" in run["steps"][4]["detail"]
    assert device.flashes == 1 and device.effects[-1] == NEW
    assert not device.locked(0) or device.unlocked_until == 0.0       # locked again (the reboot locks it too)
    backups = list((s.data_dir / "backups" / dev).glob("*-before-flash"))
    assert len(backups) == 1 and {p.name for p in backups[0].iterdir()} == {"presets.json", "cfg.json", "info.json", "effects.json"}
    assert list((s.data_dir / "flashes" / dev).glob("*-flash.json"))


def test_revert_boots_the_previous_image(make, device):
    c, dev, _ = make()
    rid = c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF).json()["id"]
    assert wait(c, rid)["state"] == "done"
    assert c.post(f"/api/devices/{dev}/revert", json={"confirm": "nope", "notice": NOTICE}, headers=CSRF).status_code == 400
    r = c.post(f"/api/devices/{dev}/revert", json={"confirm": "Desk", "notice": NOTICE}, headers=CSRF)
    run = wait(c, r.json()["id"])
    assert run["state"] == "done", run
    assert "Reverted" in run["steps"][1]["detail"]
    assert device.effects == list(EFFECTS) and device.image == "stock"


def test_revert_without_a_previous_image_fails_cleanly(make, device):
    c, dev, _ = make()
    run = wait(c, c.post(f"/api/devices/{dev}/revert", json={"confirm": "Desk", "notice": NOTICE}, headers=CSRF).json()["id"])
    assert run["state"] == "failed" and "Rollback failed" in run["steps"][-1]["detail"]


def test_a_boot_preset_with_a_new_effect_blocks(make, device):
    c, dev, _ = make()
    device.presets = {"0": {}, "5": {"n": "Boot", "seg": [{"id": 0, "fx": len(EFFECTS)}]}}   # the new effect's id
    device.boot_preset = 5
    plan = c.get(f"/api/firmware/jobs/{JID}/flash-plan", params={"device": dev}).json()
    assert blocks(plan) == {"boot-preset"}
    assert c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF).status_code == 409
    device.presets["5"]["seg"][0]["fx"] = 0                                                  # Solid: fine
    assert c.get(f"/api/firmware/jobs/{JID}/flash-plan", params={"device": dev}).json()["can_flash"]
    # a playlist as the boot preset: its presets count
    device.presets.update({"6": {"n": "New", "seg": [{"fx": len(EFFECTS)}]}, "7": {"playlist": {"ps": [5, 6]}}})
    device.boot_preset = 7
    assert blocks(c.get(f"/api/firmware/jobs/{JID}/flash-plan", params={"device": dev}).json()) == {"boot-preset"}


def test_ota_lock_and_a_failed_gate_block(make, device):
    c, dev, _ = make(passed=False)
    device.ota_lock = True
    assert blocks(c.get(f"/api/firmware/jobs/{JID}/flash-plan", params={"device": dev}).json()) == {"gate", "ota-lock"}
    assert c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF).status_code == 409


def test_an_image_that_isnt_the_gates_is_not_uploaded(make, device):
    c, dev, _ = make(sha="0" * 64)
    run = wait(c, c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF).json()["id"])
    assert run["state"] == "failed" and run["steps"][-1]["name"] == "image"
    assert "isn't the gate's" in run["steps"][-1]["detail"]
    assert device.flashes == 0


def test_without_the_pin_the_device_refuses(make, device):
    c, dev, _ = make(pin=False)
    plan = c.get(f"/api/firmware/jobs/{JID}/flash-plan", params={"device": dev}).json()
    assert {x["id"]: x["level"] for x in plan["checks"]}["pin"] == "warn"
    run = wait(c, c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF).json()["id"])
    assert run["state"] == "failed" and run["steps"][-1]["name"] == "upload"
    assert "refused" in run["steps"][-1]["detail"] and device.flashes == 0


def test_a_heap_drop_and_a_wrong_effect_list_are_warnings(make, device):
    c, dev, _ = make()
    device.flash_heap = 60000
    device.flash_effects = list(EFFECTS)            # the device kept its old effects: not the image's
    run = wait(c, c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF).json()["id"])
    assert run["state"] == "warnings"
    assert "isn't the image's" in run["steps"][-1]["detail"] and "lower than expected" in run["steps"][-1]["detail"]


def test_one_at_a_time_per_device(make, device):
    c, dev, _ = make()
    device.reboot_seconds = 1.0
    first = c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF)
    assert first.status_code == 202
    assert c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE}, headers=CSRF).status_code in (409, 502)
    wait(c, first.json()["id"])
    assert c.get("/api/flashes/" + "0" * 32).status_code == 404


def test_flash_and_revert_need_the_notice_accepted(make, device):
    c, dev, _ = make()
    for body in ({"device": dev, "confirm": "Desk"}, {"device": dev, "confirm": "Desk", "notice": "1999-01-01"}):
        assert c.post(f"/api/firmware/jobs/{JID}/flash", json=body, headers=CSRF).status_code == 428
    assert c.post(f"/api/devices/{dev}/revert", json={"confirm": "Desk"}, headers=CSRF).status_code == 428
    assert device.flashes == 0
    run = wait(c, c.post(f"/api/firmware/jobs/{JID}/flash", json={"device": dev, "confirm": "Desk", "notice": NOTICE},
                         headers=CSRF).json()["id"])
    assert run["notice"] == NOTICE                     # the acceptance is in the run's record


def test_the_notice_and_dont_show_again(make):
    c, _, s = make()
    n = c.get("/api/notices/flash").json()
    assert n["version"] == NOTICE and not n["remembered"] and "No support" in n["text"]
    assert c.post("/api/notices/flash", json={"version": "old", "remember": True}, headers=CSRF).status_code == 409
    assert c.post("/api/notices/flash", json={"version": NOTICE}, headers=CSRF).json()["remembered"] is False
    assert c.get("/api/notices/flash").json()["remembered"] is False          # accepted once, not remembered
    assert c.post("/api/notices/flash", json={"version": NOTICE, "remember": True}, headers=CSRF).status_code == 200
    n = c.get("/api/notices/flash").json()
    assert n["remembered"] and n["accepted"]
    assert (s.data_dir / "notices.json").exists()
    assert c.delete("/api/notices/flash", headers=CSRF).json() == {"remembered": False}
    assert c.get("/api/notices/flash").json()["remembered"] is False


def test_the_repository_carries_the_same_notice():
    from pathlib import Path
    from wledstudio.notice import TEXT, TITLE
    md = (Path(__file__).resolve().parents[2] / "DISCLAIMER.md").read_text(encoding="utf-8")
    assert TITLE in md and f"Version {NOTICE}" in md
    assert " ".join(TEXT.split()) in " ".join(md.split())
