# SPDX-License-Identifier: EUPL-1.2
import json

import httpx
from fastapi.testclient import TestClient

from conftest import CSRF, private_resolver
from wledstudio.app import create_app
from wledstudio.config import Settings

JID = "a" * 32


def builder(seen):
    def handle(request: httpx.Request):
        seen.append((request.method, request.url.path, request.headers.get("authorization"),
                     request.content.decode() or None))
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/targets":
            return httpx.Response(200, json=[{"pins": "q.json", "release": "q", "target": "board", "verified": ["windows"]}])
        if path == "/usermods":
            return httpx.Response(200, json=["my_fx"])
        if path == "/jobs" and request.method == "POST":
            body = json.loads(request.content)
            if body["target"] == "nope":
                return httpx.Response(400, json={"detail": "target 'nope' not in q.json"})
            return httpx.Response(202, json={"id": JID, "state": "queued", **body})
        if path == "/jobs":
            return httpx.Response(200, json=[{"id": JID, "state": "passed"}])
        if path == f"/jobs/{JID}":
            return httpx.Response(200, json={"id": JID, "state": "passed", "report": {"passed": True}})
        if path == "/previews":
            return httpx.Response(202, json={"id": JID, "kind": "preview", "state": "queued"})
        if path == f"/jobs/{JID}/preview/preview.wasm":
            return httpx.Response(200, content=b"\0asm", headers={"content-type": "application/octet-stream"})
        if path == f"/jobs/{JID}/log":
            return httpx.Response(200, text="GATE PASSED")
        return httpx.Response(404, json={"detail": "not found"})
    return httpx.MockTransport(handle)


def client(tmp_path, url="http://builder:8090", token=None, seen=None):
    s = Settings(data_dir=tmp_path, allowed_hosts=["testserver"], builder_url=url, builder_token=token)
    return TestClient(create_app(s, resolver=private_resolver, builder_transport=builder(seen if seen is not None else [])))


def test_disabled_without_builder(tmp_path):
    c = client(tmp_path, url=None)
    assert c.get("/api/firmware/status").json() == {"enabled": False}
    assert c.get("/api/firmware/targets").status_code == 503


def test_proxy(tmp_path):
    seen = []
    c = client(tmp_path, token="bt", seen=seen)
    assert c.get("/api/firmware/status").json() == {"enabled": True, "status": "ok"}
    assert c.get("/api/firmware/targets").json()[0]["target"] == "board"
    assert c.get("/api/firmware/usermods").json() == ["my_fx"]
    r = c.post("/api/firmware/jobs", json={"pins": "q.json", "target": "board", "usermods": ["my_fx"]}, headers=CSRF)
    assert r.status_code == 202 and r.json()["id"] == JID
    assert c.get(f"/api/firmware/jobs/{JID}").json()["report"] == {"passed": True}
    assert c.get(f"/api/firmware/jobs/{JID}/log").text == "GATE PASSED"
    assert c.get("/api/firmware/jobs").json()[0]["state"] == "passed"
    assert all(auth == "Bearer bt" for _, _, auth, _ in seen)


def test_validation_and_errors(tmp_path):
    c = client(tmp_path)
    for body in ({"pins": "../x.json", "target": "b", "usermods": ["a"]},
                 {"pins": "q.json", "target": "b", "usermods": ["../a"]},
                 {"pins": "q.json", "target": "b", "usermods": []},
                 {"pins": "q.json", "target": "b", "usermods": ["a"], "x": 1}):
        assert c.post("/api/firmware/jobs", json=body, headers=CSRF).status_code == 422
    r = c.post("/api/firmware/jobs", json={"pins": "q.json", "target": "nope", "usermods": ["a"]}, headers=CSRF)
    assert r.status_code == 400 and "nope" in r.json()["detail"]
    assert c.get("/api/firmware/jobs/not-an-id").status_code == 404
    assert c.get("/api/firmware/jobs/" + "b" * 32).status_code == 404


def test_builder_down(tmp_path):
    def down(request):
        raise httpx.ConnectError("down")
    s = Settings(data_dir=tmp_path, allowed_hosts=["testserver"], builder_url="http://builder:8090")
    c = TestClient(create_app(s, resolver=private_resolver, builder_transport=httpx.MockTransport(down)))
    assert c.get("/api/firmware/targets").status_code == 502


def test_previews(tmp_path):
    c = client(tmp_path)
    r = c.post("/api/firmware/previews", json={"usermods": ["my_fx"]}, headers=CSRF)
    assert r.status_code == 202 and r.json()["kind"] == "preview"
    assert c.post("/api/firmware/previews", json={"usermods": ["../x"]}, headers=CSRF).status_code == 422
    w = c.get(f"/api/firmware/jobs/{JID}/preview/preview.wasm")
    assert w.status_code == 200 and w.content == b"\0asm"
    assert w.headers["content-type"] == "application/wasm"
    assert c.get(f"/api/firmware/jobs/{JID}/preview/evil.js").status_code == 404


def test_preview_files_open_without_token_but_nothing_else(tmp_path):
    s = Settings(data_dir=tmp_path, allowed_hosts=["testserver"], builder_url="http://builder:8090", token="t")
    c = TestClient(create_app(s, resolver=private_resolver, builder_transport=builder([])))
    assert c.get(f"/api/firmware/jobs/{JID}/preview/preview.wasm").status_code == 200
    assert c.get(f"/api/firmware/jobs/{JID}").status_code == 401
    assert c.get(f"/api/firmware/jobs/{JID}/log").status_code == 401
    assert c.post("/api/firmware/previews", json={"usermods": ["a"]}, headers=CSRF).status_code == 401


def test_preflight_checks_the_library_against_a_built_image(tmp_path, device_transport):
    from wledstudio.fakewled.app import EFFECTS
    image = [{"id": i, "name": n, "meta": m} for i, (n, m) in enumerate(EFFECTS)]
    image[1] = {"id": 1, "name": "RSVD", "meta": ""}                        # Glow is gone
    image[8] = {"id": 8, "name": "RSVD", "meta": ""}
    image.append({"id": 9, "name": "Comet", "meta": "!;!;!;1;sx=128"})      # Comet moved, lost Tail

    def handle(request: httpx.Request):
        if request.url.path == f"/jobs/{JID}/effects.json":
            return httpx.Response(200, json={"schema": 1, "effects": image})
        if request.url.path == f"/jobs/{'c' * 32}/effects.json":
            return httpx.Response(200, json={"effects": "nope"})
        return httpx.Response(404, json={"detail": "not found"})

    s = Settings(data_dir=tmp_path, allowed_hosts=["testserver"], builder_url="http://builder:8090")
    c = TestClient(create_app(s, transport_for=lambda dev: device_transport, resolver=private_resolver,
                              builder_transport=httpx.MockTransport(handle)))
    dev = c.post("/api/devices", json={"name": "Desk", "host": "desk-strip"}, headers=CSRF).json()["id"]
    c.post(f"/api/devices/{dev}/state", json={"seg": [{"id": 0, "fx": 8, "ix": 77}]}, headers=CSRF)
    c.post(f"/api/devices/{dev}/capture/Tail", headers=CSRF)
    c.post(f"/api/devices/{dev}/state", json={"seg": [{"id": 0, "fx": 1}]}, headers=CSRF)
    c.post(f"/api/devices/{dev}/capture/Glowing", headers=CSRF)
    c.put("/api/playlists/Both", json={"name": "Both", "entries": [{"look": "Tail"}, {"look": "Glowing"}]}, headers=CSRF)

    r = c.get(f"/api/firmware/jobs/{JID}/preflight", params={"device": dev}).json()
    rows = {x.get("look") or "pl:" + x["playlist"]: x for x in r["rows"]}
    assert rows["Tail"]["status"] == "review" and rows["Tail"]["today"] == "ok" and rows["Tail"]["changes"]
    assert rows["Tail"]["notes"] == ["'Comet' changed: Tail (ix) is gone"]
    assert rows["Glowing"]["status"] == "unavailable"
    assert rows["pl:Both"]["status"] == "unavailable"
    assert r["counts"] == {"review": 1, "unavailable": 2} and r["effects"] == 7
    assert c.get(f"/api/firmware/jobs/{'c' * 32}/preflight", params={"device": dev}).status_code == 502
    assert c.get(f"/api/firmware/jobs/{JID}/preflight", params={"device": "nope"}).status_code == 404


def test_effect_lists_are_checked():
    import pytest
    from fastapi import HTTPException
    from wledstudio.firmware import effect_lists
    names, metas = effect_lists({"effects": [{"id": 0, "name": "Solid", "meta": ""}, {"id": 2, "name": "B", "meta": "!"},
                                             {"id": 300, "name": "x", "meta": ""}, {"id": 1, "name": 5, "meta": ""}]})
    assert names == ["Solid", "RSVD", "B"] and metas == ["", "", "!"]
    for bad in (None, {"effects": []}, {"effects": [{"id": 999, "name": "x", "meta": ""}]}):
        with pytest.raises(HTTPException):
            effect_lists(bad)
