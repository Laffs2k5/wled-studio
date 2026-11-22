# SPDX-License-Identifier: EUPL-1.2
import httpx
import pytest

from wledstudio.fakewled import FakeDevice, create_app
from wledstudio.wled import PIN_COOLDOWN_S, WLEDClient, WLEDError, WLEDLocked


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def client_for(dev, clock=None, pin=None, sleeps=None):
    clock = clock or Clock()

    async def sleep(s):
        if sleeps is not None:
            sleeps.append(s)
        clock.t += s

    app = create_app(dev, clock=clock)
    return WLEDClient("http://fake", pin=pin, transport=httpx.ASGITransport(app=app), sleep=sleep, clock=clock), clock


async def test_reads():
    c, _ = client_for(FakeDevice())
    async with c:
        assert (await c.info())["ver"] == "16.0.1"
        assert "Comet" in await c.effects()
        assert len(await c.fxdata()) == len(await c.effects())
        assert (await c.state())["on"] is True
        assert await c.presets_text() == '{"0":{}}'


async def test_set_state_retries_when_busy():
    dev = FakeDevice()
    dev.busy = 2
    sleeps = []
    c, _ = client_for(dev, sleeps=sleeps)
    async with c:
        await c.set_state({"bri": 42, "on": True})
    assert dev.state["bri"] == 42
    assert len(sleeps) == 2


async def test_gives_up_when_busy_too_long():
    dev = FakeDevice()
    dev.busy = 99
    c, _ = client_for(dev)
    async with c:
        with pytest.raises(WLEDError):
            await c.set_state({"bri": 1})


async def test_pin_never_in_set_state():
    c, _ = client_for(FakeDevice())
    async with c:
        with pytest.raises(ValueError):
            await c.set_state({"pin": "1234"})


async def test_upload_unlocks_and_locks_again():
    dev = FakeDevice(pin="1234")
    c, clock = client_for(dev, pin="1234")
    async with c:
        await c.upload("presets.json", b'{"0":{},"1":{"n":"x"}}')
    assert dev.presets["1"]["n"] == "x"
    assert dev.locked(clock())  # locked again afterwards


async def test_upload_without_pin_refused():
    dev = FakeDevice(pin="1234")
    c, _ = client_for(dev)
    async with c:
        with pytest.raises(WLEDLocked):
            await c.upload("presets.json", b"{}")


async def test_wrong_pin_refused_and_locked():
    dev = FakeDevice(pin="1234")
    c, clock = client_for(dev, pin="9999")
    async with c:
        with pytest.raises(WLEDLocked):
            await c.upload("presets.json", b"{}")
    assert dev.locked(clock())


async def test_pin_cooldown_is_respected_across_clients():
    dev = FakeDevice(pin="1234")
    clock = Clock()
    sleeps = []
    c1, _ = client_for(dev, clock=clock, pin="1234", sleeps=sleeps)
    c2, _ = client_for(dev, clock=clock, pin="1234", sleeps=sleeps)
    async with c1, c2:
        await c1.upload("presets.json", b'{"1":{"n":"a"}}')
        clock.t += 1.0
        await c2.upload("presets.json", b'{"1":{"n":"b"}}')  # would be ignored by the device without waiting
    assert dev.presets["1"]["n"] == "b"
    assert sleeps and sleeps[-1] == pytest.approx(PIN_COOLDOWN_S - 1.0)


async def test_repr_hides_pin():
    c, _ = client_for(FakeDevice(pin="1234"), pin="1234")
    async with c:
        assert "1234" not in repr(c)


async def test_errors_are_wrapped():
    async def handler(request):
        return httpx.Response(500, text="boom")

    c = WLEDClient("http://x", transport=httpx.MockTransport(handler))
    async with c:
        with pytest.raises(WLEDError):
            await c.info()
        with pytest.raises(WLEDError):
            await c.presets_text()
        with pytest.raises(WLEDError):
            await c.upload("presets.json", b"{}")

    async def broken(request):
        raise httpx.ConnectError("down")

    c = WLEDClient("http://x", transport=httpx.MockTransport(broken))
    async with c:
        for call in (c.info(), c.state(), c.presets_text(), c.upload("a", b"")):
            with pytest.raises(WLEDError):
                await call


async def test_non_json_answer():
    c = WLEDClient("http://x", transport=httpx.MockTransport(lambda r: httpx.Response(200, text="<html>")))
    async with c:
        with pytest.raises(WLEDError):
            await c.info()
