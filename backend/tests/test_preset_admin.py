# SPDX-License-Identifier: EUPL-1.2
"""Deleting and restoring a device's presets: what is refused, and that nothing is written then."""
import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from conftest import CSRF, private_resolver
from wledstudio.app import create_app

H = {**CSRF, "Authorization": "Bearer secret"}
PRESETS = {
    "0": {},
    "1": {"n": "Calm", "on": True},
    "2": {"n": "Fire", "on": True},
    "3": {"n": "Party", "playlist": {"ps": [2, 4], "dur": [100, 100], "end": 0}},
    "4": {"n": "Rain", "on": True},
    "41": {"n": "From a remote", "on": True},
}


@pytest.fixture
def admin(settings, device_transport, device):
    app = create_app(replace(settings, token="secret"), transport_for=lambda dev: device_transport,
                     resolver=private_resolver)
    c = TestClient(app)
    did = c.post("/api/devices", json={"name": "Desk", "host": "wled.lan"}, headers=H).json()["id"]
    device.presets = json.loads(json.dumps(PRESETS))
    return c, did


def inspect(c, did):
    return c.get(f"/api/devices/{did}/presets-on-device", headers=H).json()


def delete(c, did, ids, **extra):
    return c.post(f"/api/devices/{did}/presets/delete", headers=H,
                  json={"confirm": "Desk", "inspected_sha256": inspect(c, did)["sha256"], "preset_ids": ids, **extra})


def test_inspection_says_what_depends_on_each_preset(admin, device):
    c, did = admin
    device.boot_preset = 1
    rows = {r["id"]: r for r in inspect(c, did)["presets"]}
    assert rows[1]["boot"] is True and rows[2]["boot"] is False
    assert rows[2]["in_playlists"] == [3] and rows[1]["in_playlists"] == []
    assert len(rows[1]["sha"]) == 16 and rows[1]["sha"] != rows[2]["sha"]


def test_a_protected_id_is_refused_unless_named(admin, device):
    c, did = admin
    c.put("/api/protected-presets", json=[{"id": 41, "label": "Remote"}], headers=H)
    r = delete(c, did, [41])
    assert r.status_code == 409 and "preset 41 (Remote)" in r.json()["detail"]
    assert "41" in device.presets
    assert delete(c, did, [41], override_protected=[41]).status_code == 200
    assert "41" not in device.presets


def test_slot_grid_ids_are_protected_without_a_list(admin, device):
    c, did = admin
    grid = {"rows": 1, "cols": 2, "first": 40, "row_step": 1, "name": "G{row}·{col} {name}"}
    assert c.post("/api/slots/grids", json={"name": "Bedroom remote", "grid": grid}, headers=H).status_code == 201
    row = next(r for r in inspect(c, did)["presets"] if r["id"] == 41)
    assert row["protected_by"] == ["slot grid Bedroom remote"]
    r = delete(c, did, [41])
    assert r.status_code == 409 and "slot grid Bedroom remote" in r.json()["detail"]


def test_the_boot_preset_and_a_played_preset_are_refused(admin, device):
    c, did = admin
    device.boot_preset = 1
    r = delete(c, did, [1])
    assert r.status_code == 409 and "power-on" in r.json()["detail"]
    r = delete(c, did, [4])
    assert r.status_code == 409 and "playlist 3 plays 4" in r.json()["detail"]
    # deleting the playlist along with what it plays is fine
    assert delete(c, did, [3, 4]).status_code == 200
    assert sorted(device.presets) == ["0", "1", "2", "41"]


def test_a_missing_id_is_refused_and_nothing_is_written(admin, device):
    c, did = admin
    backups_before = c.get(f"/api/devices/{did}/backups", headers=H).json()
    r = delete(c, did, [2, 99])
    assert r.status_code == 409 and "no preset 99" in r.json()["detail"]
    assert device.presets == PRESETS
    assert c.get(f"/api/devices/{did}/backups", headers=H).json() == backups_before


def test_restore_refuses_to_change_a_protected_id_unless_named(admin, device):
    c, did = admin
    backup = delete(c, did, [41]).json()["backup"]
    c.put("/api/protected-presets", json=[{"id": 41, "label": "Remote"}], headers=H)
    body = {"confirm": "Desk", "inspected_sha256": inspect(c, did)["sha256"], "backup": backup}
    r = c.post(f"/api/devices/{did}/presets/restore", json=body, headers=H)
    assert r.status_code == 409 and "preset 41" in r.json()["detail"] and "41" not in device.presets
    r = c.post(f"/api/devices/{did}/presets/restore", json={**body, "override_protected": [41]}, headers=H)
    assert r.status_code == 200 and device.presets["41"] == PRESETS["41"]


def test_a_failed_verification_names_the_backup(admin, device, monkeypatch):
    """The device reads back something else than was written: the answer names the backup that
    holds the file from before, so it can be restored."""
    c, did = admin
    from wledstudio import wled
    sha = inspect(c, did)["sha256"]
    real = wled.WLEDClient.presets_text
    calls = {"n": 0}

    async def real_then_garbled(self):
        calls["n"] += 1
        return await real(self) if calls["n"] == 1 else json.dumps({"0": {}, "9": {"n": "not what was written"}})
    monkeypatch.setattr(wled.WLEDClient, "presets_text", real_then_garbled)
    r = c.post(f"/api/devices/{did}/presets/delete", headers=H,
               json={"confirm": "Desk", "inspected_sha256": sha, "preset_ids": [2, 3]})
    assert r.status_code == 502, r.text
    assert "backup" in r.json()["detail"] and r.json()["detail"].endswith("-presets.json")
