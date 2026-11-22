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
- `busy` makes the next N state requests answer {"error": 3}, as WLED does when
  its JSON buffer is in use.
"""
from __future__ import annotations

import copy
import json
import time
from dataclasses import dataclass, field

from fastapi import FastAPI, Request, UploadFile
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
            "mi": False, "frz": False, "bm": 0, "n": ""}


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
    audio_enabled: bool = False

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
        if "ps" in body:
            p = self.presets.get(str(body["ps"]))
            if p:
                self.apply({k: v for k, v in p.items() if k not in ("n", "ql")}, now)
                self.state["ps"] = int(body["ps"])
        for k in ("on", "bri", "transition"):
            if k in body:
                self.state[k] = body[k]
        if "bri" in body and "on" not in body:
            self.state["on"] = body["bri"] > 0
        if isinstance(body.get("AudioReactive"), dict) and "enabled" in body["AudioReactive"]:
            self.audio_enabled = bool(body["AudioReactive"]["enabled"])
        segs = body.get("seg")
        if isinstance(segs, dict):
            segs = [segs]
        if isinstance(segs, list):
            for s in segs:
                if not isinstance(s, dict):
                    continue
                sid = int(s.get("id", self.state.get("mainseg", 0)))
                cur = next((x for x in self.state["seg"] if x["id"] == sid), None)
                if cur is None:
                    cur = _segment(sid, s.get("start", 0), s.get("stop", self.led_count))
                    self.state["seg"].append(cur)
                if s.get("stop") == 0:
                    self.state["seg"].remove(cur)
                    continue
                for k, v in s.items():
                    if k != "id" and k in cur:
                        cur[k] = v
            if "ps" not in body:
                self.state["ps"] = -1

    def info(self) -> dict:
        return {
            "ver": "16.0.1", "vid": 2605010, "name": "Fake WLED", "brand": "WLED", "product": "FakeDevice",
            "release": "Fake", "arch": "esp32", "mac": "000000000000",
            "leds": {"count": self.led_count, "rgbw": True, "maxseg": 32, "maxpwr": 0},
            "fxcount": len(EFFECTS), "palcount": len(PALETTES),
            "cpalcount": (max(self.palette_files) + 1) if self.palette_files else 0,
            "fs": {"u": 8, "t": 983, "pmt": 0}, "u": {"AudioReactive": ["off" if not self.audio_enabled else "on"]},
            "live": False, "uptime": 1,
        }

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

    @app.get("/json/info")
    def info():
        return dev.info()

    @app.get("/json/eff")
    def eff():
        return [n for n, _ in EFFECTS]

    @app.get("/json/fxdata")
    def fxdata():
        return [m for _, m in EFFECTS]

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
        return {"state": dev.public_state(), "info": dev.info(), "effects": [n for n, _ in EFFECTS],
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
        elif name.startswith("palette") and name.endswith(".json"):
            dev.palette_files[int(name[len("palette"):-len(".json")])] = json.loads(content)
        return PlainTextResponse("File Uploaded!")

    @app.get("/settings/lock")
    def lock():
        dev.unlocked_until = 0.0
        return Response(status_code=302, headers={"Location": "/"})

    return app
