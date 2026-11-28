# SPDX-License-Identifier: EUPL-1.2
"""The editing hook: told when an editing session starts and ends."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from wledstudio import hooks
from wledstudio.app import create_app

from conftest import CSRF, private_resolver

HOOK = "http://hub.lan:8123/api/webhook/some-secret-id"


class Recorder:
    def __init__(self, status=200, fail=None):
        self.calls, self.status, self.fail = [], status, fail

    def transport(self):
        def handle(request: httpx.Request):
            if self.fail:
                raise self.fail
            self.calls.append((str(request.url), json.loads(request.content)))
            return httpx.Response(self.status)
        return httpx.MockTransport(handle)


@pytest.fixture
def hook():
    return Recorder()


@pytest.fixture
def client(settings, device_transport, hook):
    app = create_app(settings, transport_for=lambda dev: device_transport, resolver=private_resolver,
                     hook_transport=hook.transport())
    return TestClient(app)


def set_hook(client, dev_id, url):
    return client.put(f"/api/devices/{dev_id}/editing-hook", json={"url": url}, headers=CSRF)


def test_no_hook_no_call(client, dev_id, hook):
    r = client.post(f"/api/devices/{dev_id}/session", headers=CSRF)
    assert r.status_code == 200 and "hook" not in r.json()
    assert "hook" not in client.delete(f"/api/devices/{dev_id}/session", headers=CSRF).json()
    assert hook.calls == []
    assert client.get("/api/devices").json()[0]["has_editing_hook"] is False


def test_start_and_end_tell_the_hook(client, dev_id, hook, settings):
    assert set_hook(client, dev_id, HOOK).status_code == 204
    view = client.get("/api/devices").json()[0]
    assert view["has_editing_hook"] is True and "some-secret-id" not in json.dumps(view)
    assert (settings.data_dir / "secrets" / f"{dev_id}.hook").stat().st_mode & 0o777 == 0o600

    r = client.post(f"/api/devices/{dev_id}/session", headers=CSRF)
    assert r.status_code == 200 and r.json()["hook"] == "ok"
    r = client.delete(f"/api/devices/{dev_id}/session", headers=CSRF)
    assert r.status_code == 200 and r.json()["hook"] == "ok"
    assert hook.calls == [
        (HOOK, {"editing": True, "device": "Desk strip", "device_id": dev_id}),
        (HOOK, {"editing": False, "device": "Desk strip", "device_id": dev_id}),
    ]


def test_a_failing_hook_never_blocks_editing(settings, device_transport):
    rec = Recorder(fail=httpx.ConnectError("refused"))
    c = TestClient(create_app(settings, transport_for=lambda dev: device_transport, resolver=private_resolver,
                              hook_transport=rec.transport()))
    dev_id = c.post("/api/devices", json={"name": "Desk strip", "host": "wled-desk.lan"}, headers=CSRF).json()["id"]
    set_hook(c, dev_id, HOOK)
    r = c.post(f"/api/devices/{dev_id}/session", headers=CSRF)
    assert r.status_code == 200 and r.json()["active"] is True
    assert r.json()["hook"] == "the hook couldn't be reached (ConnectError)"


def test_hook_status_is_reported(settings, device_transport):
    rec = Recorder(status=404)
    c = TestClient(create_app(settings, transport_for=lambda dev: device_transport, resolver=private_resolver,
                              hook_transport=rec.transport()))
    dev_id = c.post("/api/devices", json={"name": "Desk strip", "host": "wled-desk.lan"}, headers=CSRF).json()["id"]
    set_hook(c, dev_id, HOOK)
    assert c.post(f"/api/devices/{dev_id}/session", headers=CSRF).json()["hook"] == "the hook answered 404"


def test_remove_the_hook_and_forget_it_with_the_device(client, dev_id, settings):
    set_hook(client, dev_id, HOOK)
    assert set_hook(client, dev_id, None).status_code == 204
    assert client.get("/api/devices").json()[0]["has_editing_hook"] is False
    set_hook(client, dev_id, HOOK)
    client.delete(f"/api/devices/{dev_id}", headers=CSRF)
    assert not (settings.data_dir / "secrets" / f"{dev_id}.hook").exists()


@pytest.mark.parametrize("url", [
    "ftp://hub.lan/x", "hub.lan/api/webhook/x", "http:///x", "http://user:pw@hub.lan/x",
    "http://hub.lan:99999/x", "http://" + "a" * 600 + ".lan/",
])
def test_bad_urls_are_refused(client, dev_id, url):
    assert set_hook(client, dev_id, url).status_code == 422


def test_public_hosts_are_refused():
    import ipaddress
    with pytest.raises(hooks.HookError, match="public address"):
        hooks.check_url("https://example.com/hook", resolver=lambda h: [ipaddress.ip_address("93.184.216.34")])
    assert hooks.check_url("http://[fd00::1]:8123/x", resolver=lambda h: [ipaddress.ip_address("fd00::1")])


async def test_timeout_is_reported():
    def slow(request):
        raise httpx.ReadTimeout("slow")
    assert await hooks.notify(HOOK, True, "d", "D", httpx.MockTransport(slow)) == "the hook didn't answer in time"


def test_a_restart_tells_every_hook_that_editing_is_over(settings, device_transport):
    rec = Recorder()
    app = create_app(settings, transport_for=lambda dev: device_transport, resolver=private_resolver,
                     hook_transport=rec.transport())
    c = TestClient(app)
    dev_id = c.post("/api/devices", json={"name": "Desk strip", "host": "wled-desk.lan"}, headers=CSRF).json()["id"]
    c.post("/api/devices", json={"name": "No hook", "host": "wled-other.lan"}, headers=CSRF)
    set_hook(c, dev_id, HOOK)
    with TestClient(create_app(settings, transport_for=lambda dev: device_transport, resolver=private_resolver,
                               hook_transport=rec.transport())) as restarted:
        restarted.get("/api/health")
    assert rec.calls == [(HOOK, {"editing": False, "device": "Desk strip", "device_id": dev_id})]
