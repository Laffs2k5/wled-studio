# SPDX-License-Identifier: EUPL-1.2
"""A fake WLED device: the subset of WLED's HTTP JSON API that wled-studio uses.

Used by the tests and by the demo mode (docker compose --profile demo). Its
effects and palettes are made up for this purpose, so no WLED data is copied;
their metadata strings follow WLED's format.

Behaviour modelled on WLED 16:
- /json/info, /json/eff, /json/fxdata, /json/pal, /json/state, /json, /presets.json;
- POST /json/state merges state, applies presets ("ps"), and checks a settings
  PIN when the body contains "pin";
- with a PIN set, /upload answers 401 until unlocked; an unlock lasts 15
  minutes; a PIN check within 3 s of the previous one is ignored;
- GET /settings/lock locks again;
- uploading cfg.json installs a whole configuration and reboots it;
- `busy` makes the next N state requests answer {"error": 3}, as WLED does when
  its JSON buffer is in use;
- firmware (WLED's /update): POST /update takes an image while unlocked and the OTA
  lock is off, refuses one without the ESP32 image magic, then "reboots" (every
  route answers 503 for `reboot_seconds`, uptime restarts) running it; the image's
  effect list is `flash_effects` if a test set one. GET /update?revert boots the
  previous image again. /cfg.json has the boot preset and the OTA lock.
"""
from __future__ import annotations

import copy
import json
import time
from dataclasses import dataclass, field

import asyncio

from fastapi import FastAPI, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse, Response

# Made-up effects: (name, metadata after the name). Index = effect id.
EFFECTS: list[tuple[str, str]] = [
    ("Solid", ""),
    ("Glow", "!,!;!,!;!;1;sx=24,ix=128"),
    ("Drift", "Speed,Width,,,,Reverse;!;!;1;sx=96,c1=32"),
    ("RSVD", ""),
    ("Sparkle Rain", "!,Density,Fade;!,!;!;1;ix=180"),
    ("Pulse Meter", "Gain,Decay,Floor;!;!;1v;sx=128"),
    ("Spectrum Bars", "!,!,Bands,,,Mirror,Smooth;!,!,!;!;1f;c1=16,o2=1"),
    ("Panel Waves", "!,!;!;!;2"),
    ("Comet", "!,Tail;!;!;1;sx=128,ix=200"),
]
PALETTES = ["Default", "* Random Cycle", "* Colors 1&2", "Sunset Haze", "Deep Ocean", "Forest Floor"]


def _segment(sid: int, start: int, stop: int) -> dict:
    return {"id": sid, "start": start, "stop": stop, "on": True, "bri": 255, "fx": 0, "sx": 128,
            "ix": 128, "c1": 128, "c2": 128, "c3": 16, "o1": False, "o2": False, "o3": False,
            "pal": 0, "col": [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "rev": False,
            "mi": False, "grp": 1, "spc": 0, "of": 0, "frz": False, "si": 0, "bm": 0, "n": ""}


@dataclass
class FakeDevice:
    led_count: int = 60
    pin: str | None = None
    presets: dict = field(default_factory=lambda: {"0": {}})
    state: dict = field(default_factory=dict)
    unlocked_until: float = 0.0
    last_pin_check: float = -1e9
    busy: int = 0
    uploads: list = field(default_factory=list)
    palette_files: dict = field(default_factory=dict)
    ws_connections: int = 0
    audio_enabled: bool = False
    playlist: dict | None = None           # the last playlist sent as an object
    effects: list = field(default_factory=lambda: list(EFFECTS))
    # firmware
    ota_lock: bool = False
    boot_preset: int = 0
    image: str = "stock"
    arch: str = "esp32"
    previous: tuple | None = None          # (image, effects) in the other OTA slot
    flash_effects: list | None = None      # what a flashed image registers (tests)
    flash_heap: int | None = None          # its free heap (tests)
    reboot_seconds: float = 0.0
    booted_at: float = 0.0
    rebooting_until: float = 0.0
    freeheap: int = 150000
    flashes: int = 0
    config: dict | None = None

    def __post_init__(self):
        if not self.state:
            self.state = {"on": True, "bri": 128, "transition": 7, "ps": -1, "pl": -1, "mainseg": 0,
                          "seg": [_segment(0, 0, self.led_count)]}

    # --- PIN ---
    def check_pin(self, pin: str, now: float) -> None:
        if now - self.last_pin_check < 3.0:
            return  # WLED ignores PIN checks within 3 s of the previous one
        self.last_pin_check = now
        if self.pin is not None and pin == self.pin:
            self.unlocked_until = now + 15 * 60

    def locked(self, now: float) -> bool:
        return self.pin is not None and now >= self.unlocked_until

    # --- state ---
    def apply(self, body: dict, now: float) -> None:
        if "pin" in body:
            self.check_pin(str(body["pin"]), now)
        if isinstance(body.get("playlist"), dict) and isinstance(body["playlist"].get("ps"), list) and body["playlist"]["ps"]:
            # a playlist sent as an object: kept, and its first preset shown (no timer runs here)
            self.playlist = body["playlist"]
            self.apply({"ps": body["playlist"]["ps"][0]}, now)
            self.state["pl"] = 0
        if "ps" in body:
            p = self.presets.get(str(body["ps"]))
            if p:
                self.apply({k: v for k, v in p.items() if k not in ("n", "ql")}, now)
                self.state["ps"] = int(body["ps"])
        for k in ("on", "bri", "transition"):
            if k in body:
                self.state[k] = body[k]
        if body.get("live") is False:
            self.state["live"] = False
        if "bri" in body and "on" not in body:
            self.state["on"] = body["bri"] > 0
        if isinstance(body.get("AudioReactive"), dict) and "enabled" in body["AudioReactive"]:
            self.audio_enabled = bool(body["AudioReactive"]["enabled"])
        segs = body.get("seg")
        if isinstance(segs, dict):
            segs = [segs]
            default_ids = [self.state.get("mainseg", 0)]
        elif isinstance(segs, list):
            default_ids = list(range(len(segs)))  # WLED: an array entry without "id" is its position
        if isinstance(segs, list):
            for s, default_id in zip(segs, default_ids):
                if not isinstance(s, dict):
                    continue
                sid = int(s.get("id", default_id))
                cur = next((x for x in self.state["seg"] if x["id"] == sid), None)
                if s.get("stop") == 0:
                    if cur is not None:
                        self.state["seg"].remove(cur)
                    continue
                if cur is None:
                    cur = _segment(sid, s.get("start", 0), s.get("stop", self.led_count))
                    self.state["seg"].append(cur)
                    self.state["seg"].sort(key=lambda x: x["id"])
                for k, v in s.items():
                    if k != "id" and k in cur:
                        cur[k] = v
            if "ps" not in body:
                self.state["ps"] = -1

    def reboot(self, now: float) -> None:
        self.booted_at = now + self.reboot_seconds
        self.rebooting_until = now + self.reboot_seconds
        self.unlocked_until = 0.0

    def info(self, now: float = 0.0) -> dict:
        return {
            "ver": "16.0.1", "vid": 2605010, "name": "Fake WLED", "brand": "WLED", "product": "FakeDevice",
            "release": "Fake", "arch": self.arch, "mac": "000000000000",
            "leds": {"count": self.led_count, "rgbw": True, "maxseg": 32, "maxpwr": 0},
            "fxcount": len(self.effects), "palcount": len(PALETTES),
            "cpalcount": (max(self.palette_files) + 1) if self.palette_files else 0,
            "fs": {"u": 8, "t": 983, "pmt": 0}, "u": {"AudioReactive": ["off" if not self.audio_enabled else "on"]},
            "live": False, "uptime": max(1, int(now - self.booted_at)), "freeheap": self.freeheap,
        }

    def live_frame(self) -> bytes:
        """WLED's live-view frame: 'L', 1, then RGB per LED (each segment in its first colour)."""
        px = [(0, 0, 0)] * self.led_count
        if self.state.get("on"):
            for seg in self.state["seg"]:
                r, g, b, *w = (seg["col"][0] + [0, 0, 0, 0])[:4]
                wv = w[0] if w else 0
                for i in range(max(0, seg["start"]), min(self.led_count, seg["stop"])):
                    px[i] = (min(255, r + wv), min(255, g + wv), min(255, b + wv))
        return b"L\x01" + bytes(c for p in px for c in p)

    def public_state(self) -> dict:
        s = copy.deepcopy(self.state)
        s["AudioReactive"] = {"on": self.audio_enabled}
        return s


def create_app(device: FakeDevice | None = None, clock=time.monotonic) -> FastAPI:
    dev = device or FakeDevice()
    app = FastAPI(title="Fake WLED", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.device = dev

    def busy() -> JSONResponse | None:
        if dev.busy > 0:
            dev.busy -= 1
            return JSONResponse({"error": 3}, status_code=503)
        return None

    class Rebooting:
        """While the device "reboots", every HTTP request gets 503 (a plain ASGI middleware:
        Starlette's BaseHTTPMiddleware would delay other requests)."""
        def __init__(self, inner):
            self.inner = inner

        async def __call__(self, scope, receive, send):
            if scope["type"] == "http" and clock() < dev.rebooting_until:
                await PlainTextResponse("rebooting", status_code=503)(scope, receive, send)
                return
            await self.inner(scope, receive, send)

    app.add_middleware(Rebooting)

    @app.get("/json/info")
    def info():
        return dev.info(clock())

    @app.get("/json/eff")
    def eff():
        return [n for n, _ in dev.effects]

    @app.get("/json/fxdata")
    def fxdata():
        return [m for _, m in dev.effects]

    @app.get("/cfg.json")
    def cfg():
        if dev.config is not None:
            return dev.config
        return {"def": {"ps": dev.boot_preset, "on": True, "bri": 128},
                "id": {"mdns": "fake-device", "name": "Fake device"},
                "ota": {"lock": dev.ota_lock, "lock-wifi": False, "aota": True, "same-subnet": True}}

    def page(code: int, title: str, text: str) -> Response:
        # WLED answers /update with a small HTML message page
        return Response(f"<html><body><h2>{title}</h2>{text}</body></html>", status_code=code, media_type="text/html")

    @app.post("/update")
    async def update(update: UploadFile):
        if dev.locked(clock()):
            return page(401, "Access Denied", "Please unlock settings using PIN code!")
        if dev.ota_lock:
            return page(401, "Access Denied", "Please unlock OTA in security settings!")
        content = await update.read()
        if content[:1] != b"\xe9":
            return page(500, "Update failed!", "This firmware file is missing compatibility metadata.")
        dev.previous = (dev.image, dev.effects)
        dev.image = f"flashed-{len(content)}"
        if dev.flash_effects is not None:
            dev.effects = list(dev.flash_effects)
        if dev.flash_heap is not None:
            dev.freeheap = dev.flash_heap
        dev.flashes += 1
        dev.reboot(clock())
        return page(200, "Update successful!", "Rebooting...")

    @app.get("/update")
    def update_page(request: Request):
        if dev.locked(clock()):
            return page(401, "PIN required", "Please enter settings PIN code")
        if "revert" not in request.query_params:
            return page(200, "WLED Software Update", "")
        if dev.previous is None:
            return page(500, "Rollback failed!", "Please reboot and retry.")
        (dev.image, dev.effects), dev.previous = dev.previous, (dev.image, dev.effects)
        dev.reboot(clock())
        return page(200, "Reverted to previous version!", "Rebooting...")

    @app.get("/json/pal")
    def pal():
        return PALETTES

    @app.get("/json/state")
    def get_state():
        return busy() or dev.public_state()

    @app.post("/json/state")
    @app.post("/json/si")
    async def post_state(request: Request):
        b = busy()
        if b:
            return b
        try:
            body = json.loads(await request.body() or b"{}")
        except json.JSONDecodeError:
            return JSONResponse({"error": 9}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": 9}, status_code=400)
        dev.apply(body, clock())
        return {"success": True}

    @app.get("/json")
    def everything():
        return {"state": dev.public_state(), "info": dev.info(clock()), "effects": [n for n, _ in dev.effects],
                "palettes": PALETTES}

    @app.get("/presets.json")
    def presets():
        return Response(json.dumps(dev.presets, separators=(",", ":")), media_type="application/json")

    @app.post("/upload")
    async def upload(data: UploadFile):
        if dev.locked(clock()):
            return PlainTextResponse("Access denied", status_code=401)
        content = await data.read()
        name = (data.filename or "").lstrip("/")
        dev.uploads.append(name)
        if name == "presets.json":
            dev.presets = json.loads(content)
        elif name == "cfg.json":
            cfg = json.loads(content)
            if not isinstance(cfg, dict):
                return PlainTextResponse("Invalid cfg.json", status_code=400)
            dev.config = cfg
            defaults = cfg.get("def") if isinstance(cfg.get("def"), dict) else {}
            ota = cfg.get("ota") if isinstance(cfg.get("ota"), dict) else {}
            if isinstance(defaults.get("ps"), int):
                dev.boot_preset = defaults["ps"]
            dev.ota_lock = bool(ota.get("lock", False))
            dev.reboot(clock())
        elif name.startswith("palette") and name.endswith(".json"):
            dev.palette_files[int(name[len("palette"):-len(".json")])] = json.loads(content)
        return PlainTextResponse("File Uploaded!")

    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        await socket.accept()
        dev.ws_connections += 1
        await socket.send_text(json.dumps({"state": dev.public_state(), "info": dev.info()}))
        live = False

        async def frames():
            while True:
                await asyncio.sleep(0.05)
                if live:
                    await socket.send_bytes(dev.live_frame())

        sender = asyncio.create_task(frames())
        try:
            while True:
                msg = json.loads(await socket.receive_text())
                if isinstance(msg, dict) and "lv" in msg:
                    live = bool(msg["lv"])
        except (WebSocketDisconnect, json.JSONDecodeError):
            pass
        finally:
            sender.cancel()

    @app.get("/settings/lock")
    def lock():
        dev.unlocked_until = 0.0
        return Response(status_code=302, headers={"Location": "/"})

    return app
