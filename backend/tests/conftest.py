# SPDX-License-Identifier: EUPL-1.2
import ipaddress

import httpx
import pytest
from fastapi.testclient import TestClient

from wledstudio import wled
from wledstudio.app import create_app
from wledstudio.config import Settings
from wledstudio.fakewled import FakeDevice
from wledstudio.fakewled import create_app as fake_app

CSRF = {"X-WLED-Studio": "1"}


@pytest.fixture(autouse=True)
def _reset_device_state():
    wled._last_pin_check.clear()
    wled._locks.clear()
    yield


@pytest.fixture
def device():
    return FakeDevice()


@pytest.fixture
def device_transport(device):
    return httpx.ASGITransport(app=fake_app(device))


def private_resolver(host):
    return [ipaddress.ip_address("192.168.1.50")]


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path / "data", allowed_hosts=["testserver", "localhost"])


@pytest.fixture
def app(settings, device_transport):
    return create_app(settings, transport_for=lambda dev: device_transport, resolver=private_resolver)


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def dev_id(client):
    r = client.post("/api/devices", json={"name": "Desk strip", "host": "wled-desk.lan"}, headers=CSRF)
    assert r.status_code == 201, r.text
    return r.json()["id"]
