# SPDX-License-Identifier: EUPL-1.2
import socket
import struct

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from conftest import CSRF, private_resolver
from wledstudio import ddp
from wledstudio.app import create_app, default_ddp_target
from wledstudio.config import Settings
from wledstudio.devices import Device


def test_packet_layout():
    (p,) = ddp.packets(bytes(range(12)), 4, seq=0)
    flags, seq, dtype, dest, off, length = struct.unpack(">BBBBIH", p[:10])
    assert (flags, seq, dtype, dest, off, length) == (0x41, 1, 0x1B, 1, 0, 12)
    assert p[10:] == bytes(range(12))
    (p,) = ddp.packets(b"\x01\x02\x03", 3, seq=14)
    assert p[1] == 15 and p[2] == 0x0B


def test_large_frames_split_and_push_only_on_last():
    pk = ddp.packets(bytes(4 * 1000), 4, seq=3)   # 4000 bytes -> 1440 + 1440 + 1120
    assert [len(p) - 10 for p in pk] == [1440, 1440, 1120]
    assert [p[0] for p in pk] == [0x40, 0x40, 0x41]
    assert [struct.unpack(">I", p[4:8])[0] for p in pk] == [0, 1440, 2880]
    pk3 = ddp.packets(bytes(3 * 1000), 3, seq=0)
    assert all((len(p) - 10) % 3 == 0 for p in pk3)


def test_bad_frames():
    for args in ((b"", 3), (b"\x01\x02", 3), (b"\x00" * 6, 5)):
        with pytest.raises(ValueError):
            ddp.packets(args[0], args[1], 0)


def test_default_target():
    assert default_ddp_target(Device("d", "D", "wled.lan:8080")) == ("wled.lan", 4048)
    assert default_ddp_target(Device("d", "D", "10.0.0.5")) == ("10.0.0.5", 4048)


@pytest.fixture
def udp():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    s.settimeout(2)
    yield s
    s.close()


def make(tmp_path, udp, device_transport, token=None):
    s = Settings(data_dir=tmp_path, allowed_hosts=["testserver"], token=token)
    app = create_app(s, transport_for=lambda d: device_transport, resolver=private_resolver,
                     ddp_target_for=lambda d: udp.getsockname())
    c = TestClient(app)
    h = {**CSRF, "Authorization": f"Bearer {token}"} if token else CSRF
    did = c.post("/api/devices", json={"name": "Desk", "host": "wled.lan"}, headers=h).json()["id"]
    return c, did


ORIGIN = {"origin": "http://testserver"}


def test_stream_sends_ddp_and_hands_back(tmp_path, udp, device_transport, device):
    c, did = make(tmp_path, udp, device_transport)
    with c.websocket_connect(f"/api/devices/{did}/stream", headers=ORIGIN) as ws:
        ws.send_bytes(bytes([4]) + bytes([10, 20, 30, 40] * 5))
        data = udp.recv(2000)
    assert data[0] == 0x41 and data[2] == 0x1B and data[10:] == bytes([10, 20, 30, 40] * 5)
    assert device.state.get("live") is False   # told to go back to its own effect


def test_stream_refuses_cross_origin_and_unknown_device(tmp_path, udp, device_transport):
    c, did = make(tmp_path, udp, device_transport)
    for headers, path in (({"origin": "http://evil.example"}, did), ({}, did), (ORIGIN, "nope")):
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect(f"/api/devices/{path}/stream", headers=headers) as ws:
                ws.receive_bytes()


def test_stream_closes_on_bad_frames(tmp_path, udp, device_transport):
    c, did = make(tmp_path, udp, device_transport)
    for frame in (bytes([5, 1, 2, 3, 4, 5]), bytes([4, 1, 2, 3]), b"\x03"):
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect(f"/api/devices/{did}/stream", headers=ORIGIN) as ws:
                ws.send_bytes(frame)
                ws.receive_bytes()


def test_stream_needs_the_token_as_subprotocol(tmp_path, udp, device_transport):
    c, did = make(tmp_path, udp, device_transport, token="t0k")
    # a browser sends: new WebSocket(url, ["wledstudio", "bearer.<token>"])
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect(f"/api/devices/{did}/stream",
                                 headers={**ORIGIN, "sec-websocket-protocol": "wledstudio"}) as ws:
            ws.receive_bytes()
    with c.websocket_connect(f"/api/devices/{did}/stream",
                             headers={**ORIGIN, "sec-websocket-protocol": "wledstudio, bearer.t0k"}) as ws:
        assert ws.accepted_subprotocol == "wledstudio"
        ws.send_bytes(bytes([3, 1, 2, 3]))
        assert udp.recv(100)[10:] == b"\x01\x02\x03"
