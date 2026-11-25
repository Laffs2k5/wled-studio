# SPDX-License-Identifier: EUPL-1.2
from fastapi.testclient import TestClient

from conftest import CSRF, private_resolver
from wledstudio.app import create_app
from wledstudio.config import Settings
from wledstudio.security import host_allowed


def test_security_headers(client):
    r = client.get("/api/health")
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    # WebAssembly (the effect preview) may compile; JavaScript eval stays off
    assert "script-src 'self' 'wasm-unsafe-eval';" in r.headers["content-security-policy"]
    assert "'unsafe-eval'" not in r.headers["content-security-policy"].replace("'wasm-unsafe-eval'", "")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["cache-control"] == "no-store"


def test_unknown_host_refused(client):
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400


def test_microphone_is_allowed_for_the_app_origin_only(client):
    assert "microphone=(self)" in client.get("/api/health").headers["permissions-policy"]


def test_writes_need_the_csrf_header(client):
    assert client.post("/api/devices", json={"name": "x", "host": "wled.lan"}).status_code == 403


def test_cross_origin_writes_refused(client):
    h = {**CSRF, "Origin": "http://evil.example"}
    assert client.post("/api/devices", json={"name": "x", "host": "wled.lan"}, headers=h).status_code == 403
    h = {**CSRF, "Origin": "null"}
    assert client.post("/api/devices", json={"name": "x", "host": "wled.lan"}, headers=h).status_code == 403
    h = {**CSRF, "Origin": "http://testserver"}
    assert client.post("/api/devices", json={"name": "x", "host": "wled.lan"}, headers=h).status_code == 201


def test_body_size_limit(client):
    big = "x" * 1_100_000
    r = client.post("/api/devices", content=big, headers={**CSRF, "Content-Type": "application/json"})
    assert r.status_code == 413


def test_token(tmp_path):
    s = Settings(data_dir=tmp_path, allowed_hosts=["testserver"], token="s3cret-token")
    c = TestClient(create_app(s, resolver=private_resolver))
    assert c.get("/api/health").status_code == 200  # the container health check needs no token
    assert c.get("/api/devices").status_code == 401
    assert c.get("/api/devices", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.get("/api/devices", headers={"Authorization": "Bearer s3cret-token"}).status_code == 200


def test_host_matching():
    assert host_allowed("localhost:8080", ["localhost"])
    assert host_allowed("[::1]:8080", ["[::1]"])
    assert not host_allowed("localhost.evil:8080", ["localhost"])
    assert host_allowed("anything", ["*"])


def test_no_docs_endpoints(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404


def test_static_spa(tmp_path):
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<html>app</html>")
    (static / "assets" / "app.js").write_text("js")
    (static / "favicon.svg").write_text("<svg/>")
    s = Settings(data_dir=tmp_path / "d", allowed_hosts=["testserver"], static_dir=static)
    c = TestClient(create_app(s, resolver=private_resolver))
    assert c.get("/").text == "<html>app</html>"
    assert c.get("/looks/anything").text == "<html>app</html>"
    assert c.get("/assets/app.js").text == "js"
    assert c.get("/favicon.svg").text == "<svg/>"
    assert c.get("/../../etc/passwd").text == "<html>app</html>"
