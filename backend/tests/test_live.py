# SPDX-License-Identifier: EUPL-1.2
import socket
import threading
import time

import pytest
import uvicorn
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from conftest import CSRF, private_resolver
from wledstudio.app import create_app
from wledstudio.config import Settings
from wledstudio.devices import Device
from wledstudio.fakewled import FakeDevice
from wledstudio.fakewled import create_app as fake_app
from wledstudio.live import default_live_url

ORIGIN = {"origin": "http://testserver"}


@pytest.fixture
def served_device():
    """The fake device on a real local port (the live relay connects over the network)."""
    dev = FakeDevice(led_count=10)
    dev.state["seg"][0]["col"][0] = [10, 20, 30, 5]
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    server = uvicorn.Server(uvicorn.Config(fake_app(dev), host="127.0.0.1", port=port, log_level="error"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield dev, port
    server.should_exit = True
    t.join(timeout=5)


def make(tmp_path, port):
    s = Settings(data_dir=tmp_path, allowed_hosts=["testserver"])
    app = create_app(s, resolver=private_resolver, live_url_for=lambda d: f"ws://127.0.0.1:{port}/ws")
    c = TestClient(app)
    did = c.post("/api/devices", json={"name": "Desk", "host": "wled.lan"}, headers=CSRF).json()["id"]
    return c, did


def test_default_url():
    assert default_live_url(Device("d", "D", "wled.lan")) == "ws://wled.lan/ws"
    assert default_live_url(Device("d", "D", "10.0.0.5:8080")) == "ws://10.0.0.5:8080/ws"


def test_live_frames_reach_the_browser(tmp_path, served_device):
    dev, port = served_device
    c, did = make(tmp_path, port)
    with c.websocket_connect(f"/api/devices/{did}/live", headers=ORIGIN) as ws:
        frame = ws.receive_bytes()
    assert frame[:2] == b"L\x01"
    assert len(frame) == 2 + 10 * 3
    assert frame[2:5] == bytes([15, 25, 35])  # white folded into RGB, as WLED does


def test_two_viewers_share_one_device_connection(tmp_path, served_device):
    dev, port = served_device
    c, did = make(tmp_path, port)
    # one event loop for both viewers, as in the real server (a TestClient without
    # "with" runs each websocket on its own loop)
    with c:
        with c.websocket_connect(f"/api/devices/{did}/live", headers=ORIGIN) as a:
            a.receive_bytes()
            with c.websocket_connect(f"/api/devices/{did}/live", headers=ORIGIN) as b:
                assert b.receive_bytes()[:2] == b"L\x01"
    assert dev.ws_connections == 1


def test_live_refuses_cross_origin(tmp_path, served_device):
    _, port = served_device
    c, did = make(tmp_path, port)
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect(f"/api/devices/{did}/live", headers={"origin": "http://evil.example"}) as ws:
            ws.receive_bytes()


def test_device_unreachable_closes_the_view(tmp_path):
    c, did = make(tmp_path, 1)  # nothing listens on port 1
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect(f"/api/devices/{did}/live", headers=ORIGIN) as ws:
            ws.receive_bytes()
