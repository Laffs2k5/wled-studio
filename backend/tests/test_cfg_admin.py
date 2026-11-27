# SPDX-License-Identifier: EUPL-1.2
import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from conftest import CSRF, private_resolver
from wledstudio.app import create_app
from wledstudio.cfg_admin import config_changes

H = {**CSRF, "Authorization": "Bearer secret"}
BASE = {
    "id": {"mdns": "desk-device", "name": "Desk"},
    "def": {"ps": 1, "on": True},
    "hw": {"led": {"ins": [{"len": 10}, {"len": 20}]}},
    "nw": {"ins": [{"ssid": "Example"}]},
    "ap": {"ssid": "Controller"},
    "ota": {"lock": False},
}


@pytest.fixture
def config_admin(settings, device, device_transport):
    app = create_app(
        replace(settings, token="secret"), transport_for=lambda dev: device_transport,
        resolver=private_resolver,
    )
    app.state.flash_timing = (0.01, 1.0)
    device.pin = "1234"
    device.reboot_seconds = 0.03
    with TestClient(app) as client:
        response = client.post(
            "/api/devices", json={"name": "Desk", "host": "wled.lan", "pin": "1234"}, headers=H)
        yield client, response.json()["id"], settings.data_dir


def backup_now(client, device_id):
    response = client.post(f"/api/devices/{device_id}/cfg/backups", headers=H)
    assert response.status_code == 201, response.text
    return response.json()


def plan(client, device_id, name):
    return client.post(
        f"/api/devices/{device_id}/cfg/restore-plan", json={"backup": name}, headers=H)


def restore(client, device_id, inspected, name, **extra):
    body = {"confirm": "restore", "backup": name, "inspected_sha256": inspected, **extra}
    return client.post(f"/api/devices/{device_id}/cfg/restore", json=body, headers=H)


def test_config_backup_is_named_cfg_and_lists_flash_backups(config_admin, device):
    client, device_id, data_dir = config_admin
    device.config = json.loads(json.dumps(BASE))
    manual = backup_now(client, device_id)
    assert manual["name"].endswith("-cfg") and manual["source"] == "manual"

    flash_dir = data_dir / "backups" / device_id / "20260102T030405-before-flash"
    flash_dir.mkdir()
    (flash_dir / "cfg.json").write_text(json.dumps(BASE))

    rows = client.get(f"/api/devices/{device_id}/cfg/backups", headers=H).json()
    assert {row["name"] for row in rows} == {manual["name"], flash_dir.name}
    assert {row["source"] for row in rows} == {"manual", "flash"}
    assert client.get(f"/api/devices/{device_id}/cfg/backups/{manual['name']}", headers=H).json() == manual


def test_dry_run_groups_leaf_changes_and_flags_network(config_admin, device):
    client, device_id, _ = config_admin
    device.config = json.loads(json.dumps(BASE))
    backup = backup_now(client, device_id)
    device.config["def"]["ps"] = 2
    device.config["hw"]["led"]["ins"][1]["len"] = 30
    device.config["nw"]["ins"][0]["ssid"] = "Other network"

    response = plan(client, device_id, backup["name"])
    assert response.status_code == 200
    data = response.json()
    assert data["identity_match"] is True
    assert data["network_sections"] == ["nw"]
    assert {row["path"] for row in data["changes"]} == {
        "def.ps", "hw.led.ins[1].len", "nw.ins[0].ssid",
    }
    assert {row["section"] for row in data["changes"]} == {"def", "hw", "nw"}


def test_restore_refuses_another_device_without_explicit_override(config_admin, device):
    client, device_id, _ = config_admin
    device.config = {**json.loads(json.dumps(BASE)), "id": {"mdns": "other", "name": "Other"}}
    backup = backup_now(client, device_id)
    device.config = json.loads(json.dumps(BASE))
    inspected = plan(client, device_id, backup["name"]).json()
    assert inspected["identity_match"] is False
    assert inspected["identity_differences"] == ["id.mdns", "id.name"]

    response = restore(client, device_id, inspected["inspected_sha256"], backup["name"])
    assert response.status_code == 409 and "another device" in response.json()["detail"]
    assert device.uploads == []
    assert len(client.get(f"/api/devices/{device_id}/cfg/backups", headers=H).json()) == 1

    response = restore(
        client, device_id, inspected["inspected_sha256"], backup["name"], override_device=True)
    assert response.status_code == 200 and device.config["id"]["name"] == "Other"


def test_network_changes_need_their_own_tick(config_admin, device):
    client, device_id, _ = config_admin
    device.config = json.loads(json.dumps(BASE))
    backup = backup_now(client, device_id)
    device.config["nw"]["ins"][0]["ssid"] = "Different network"
    inspected = plan(client, device_id, backup["name"]).json()
    assert inspected["network_sections"] == ["nw"]

    refused = restore(client, device_id, inspected["inspected_sha256"], backup["name"])
    assert refused.status_code == 409 and "network settings" in refused.json()["detail"]
    assert device.uploads == []

    restored = restore(
        client, device_id, inspected["inspected_sha256"], backup["name"],
        allow_network_changes=True,
    )
    assert restored.status_code == 200 and device.config["nw"]["ins"][0]["ssid"] == "Example"


def test_restore_backs_up_immediately_before_upload_and_waits_for_reboot(
        config_admin, device, monkeypatch):
    client, device_id, data_dir = config_admin
    device.config = json.loads(json.dumps(BASE))
    target = backup_now(client, device_id)
    device.config["def"]["ps"] = 9
    inspected = plan(client, device_id, target["name"]).json()
    from wledstudio.wled import WLEDClient
    real = WLEDClient._upload_raw
    at_upload = []

    async def check_before_upload(self, name, content):
        files = sorted((data_dir / "backups" / device_id).iterdir())
        latest = files[-1]
        at_upload.append((name, len(files), latest.name))
        assert len(files) == 2 and latest.name != target["name"]
        assert json.loads((latest / "cfg.json").read_text())["def"]["ps"] == 9
        await real(self, name, content)

    monkeypatch.setattr(WLEDClient, "_upload_raw", check_before_upload)
    result = restore(client, device_id, inspected["inspected_sha256"], target["name"])
    assert result.status_code == 200, result.text
    assert at_upload == [("cfg.json", 2, result.json()["backup"])]
    assert device.uploads[-1] == "cfg.json"
    assert device.rebooting_until < __import__("time").monotonic()
    assert device.config == BASE
    assert result.json()["differences"] == []


def test_readback_normalization_is_reported_instead_of_failed(config_admin, device, monkeypatch):
    client, device_id, _ = config_admin
    device.config = json.loads(json.dumps(BASE))
    backup = backup_now(client, device_id)
    device.config["def"]["ps"] = 9
    inspected = plan(client, device_id, backup["name"]).json()
    from wledstudio.wled import WLEDClient
    real = WLEDClient.cfg_file
    calls = 0

    async def normalized(self):
        nonlocal calls
        cfg = await real(self)
        calls += 1
        if calls >= 2:
            cfg = json.loads(json.dumps(cfg))
            cfg["light"] = {"scale-bri": 100}
        return cfg

    monkeypatch.setattr(WLEDClient, "cfg_file", normalized)
    result = restore(client, device_id, inspected["inspected_sha256"], backup["name"])
    assert result.status_code == 200
    assert result.json()["differences"] == [
        {"section": "light", "path": "light.scale-bri", "action": "add"}
    ]


def test_restore_timeout_names_the_fresh_safety_backup(config_admin, device):
    client, device_id, _ = config_admin
    device.reboot_seconds = 5
    device.config = json.loads(json.dumps(BASE))
    backup = backup_now(client, device_id)
    device.config["def"]["ps"] = 9
    inspected = plan(client, device_id, backup["name"]).json()
    result = restore(client, device_id, inspected["inspected_sha256"], backup["name"])
    assert result.status_code == 502
    fresh = sorted(row["name"] for row in client.get(
        f"/api/devices/{device_id}/cfg/backups", headers=H).json())[-1]
    assert fresh in result.json()["detail"] and result.json()["detail"].endswith(f"backup {fresh}")


def test_confirmation_is_literal_and_stale_plans_do_not_write(config_admin, device):
    client, device_id, _ = config_admin
    device.config = json.loads(json.dumps(BASE))
    backup = backup_now(client, device_id)
    inspected = plan(client, device_id, backup["name"]).json()
    wrong = restore(
        client, device_id, inspected["inspected_sha256"], backup["name"], confirm="Restore")
    assert wrong.status_code == 422 and device.uploads == []
    device.config["def"]["ps"] = 8
    stale = restore(client, device_id, inspected["inspected_sha256"], backup["name"])
    assert stale.status_code == 409 and device.uploads == []


def test_restore_needs_access_token_without_uploading_or_backing_up(
        settings, device, device_transport):
    app = create_app(settings, transport_for=lambda dev: device_transport, resolver=private_resolver)
    app.state.flash_timing = (0.01, 1.0)
    device.config = json.loads(json.dumps(BASE))
    with TestClient(app) as client:
        device_id = client.post(
            "/api/devices", json={"name": "Desk", "host": "wled.lan"}, headers=CSRF).json()["id"]
        backup = backup_now(client, device_id)
        inspected = plan(client, device_id, backup["name"]).json()
        response = restore(client, device_id, inspected["inspected_sha256"], backup["name"])

        assert response.status_code == 409
        assert response.json()["detail"] == (
            "Enable WLED Studio access-token protection before deleting or restoring presets "
            "or device settings.")
        assert device.uploads == []
        assert client.get(f"/api/devices/{device_id}/cfg/backups").json() == [backup]


def test_config_diff_expands_added_containers_by_leaf_path():
    assert config_changes({}, {"hw": {"led": {"ins": [{"len": 12}]}}}) == [
        {"section": "hw", "path": "hw.led.ins[0].len", "action": "add"}
    ]
