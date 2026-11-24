# SPDX-License-Identifier: EUPL-1.2
"""Your effect usermods: list, read, save and create them (the Effect studio's editor).

Each usermod is a folder in the effects directory (WLEDSTUDIO_EFFECTS_DIR) with a
library.json and its .cpp/.h files; the builder compiles them for the preview and
into firmware. Only those file types are touched, names are checked, and nothing
outside the effects directory can be reached.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/api/effects")
# An effect folder: the builder's rule for a usermod's name, so every folder it compiles can be
# edited here (wled-studio-builder's NAME_RE). A new folder is stricter: its name becomes the
# usermod's class and file name, so it must be a C identifier.
FOLDER_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
NEW_FOLDER_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
FILE_RE = re.compile(r"^(library\.json|[A-Za-z0-9_]{1,60}\.(cpp|h))$")
MAX_FILE = 256 * 1024

TEMPLATE = """// SPDX-License-Identifier: EUPL-1.2
// {title}: an effect usermod for WLED, made in wled-studio.
#include "wled.h"

namespace {{

constexpr uint8_t kId = {effect_id};  // a fixed effect id, so presets keep working across builds

const char kPadName[] PROGMEM = "RSVD";  // hidden placeholders up to kId
void fill_solid(void) {{ SEGMENT.fill(SEGCOLOR(0)); }}

// Called once per frame. SEGMENT is the segment being drawn, SEGLEN its length,
// strip.now the time in ms; speed and intensity come from the sliders.
void mode_{folder}(void) {{
  const unsigned len = SEGLEN;
  if (len <= 1) {{ fill_solid(); return; }}
  const uint8_t phase = uint8_t(strip.now * (SEGMENT.speed + 1) / 4096);
  for (unsigned i = 0; i < len; i++) {{
    const uint8_t wave = sin8_t(uint8_t(i * 256 / len + phase));
    SEGMENT.setPixelColor(i, color_blend(SEGCOLOR(1), SEGCOLOR(0), scale8(wave, SEGMENT.intensity)));
  }}
}}
const char kData[] PROGMEM = "{title}@!,!;!,!;;1;sx=128,ix=255";

}}  // namespace

class {klass} : public Usermod {{
 public:
  void setup() override {{
    if (strip.getModeCount() > kId) return;  // WLED already uses this id
    while (strip.getModeCount() < kId)
      if (strip.addEffect(strip.getModeCount(), &fill_solid, kPadName) == 255) return;
    strip.addEffect(kId, &mode_{folder}, kData);
  }}
  void loop() override {{}}
}};

static {klass} {folder}_usermod;
REGISTER_USERMOD({folder}_usermod);
"""


ROOM_TEMPLATE = """// SPDX-License-Identifier: EUPL-1.2
// {title}: a room-aware effect for WLED, made in wled-studio. A wave sweeps across
// the room by each LED's position (room_map.h, written from the app's room model),
// not by its index; LEDs outside the map fall back to their index.
#include "wled.h"
#include "room_map.h"

namespace {{

constexpr uint8_t kId = {effect_id};

const char kPadName[] PROGMEM = "RSVD";
void fill_solid(void) {{ SEGMENT.fill(SEGCOLOR(0)); }}

void mode_{folder}(void) {{
  const unsigned len = SEGLEN;
  if (len <= 1) {{ fill_solid(); return; }}
  const uint8_t phase = uint8_t(strip.now * (SEGMENT.speed + 1) / 4096);
  const bool across = !SEGMENT.check1;  // the checkbox turns the sweep 90 degrees
  for (unsigned i = 0; i < len; i++) {{
    uint8_t pos;
    if (i < kRoomLeds) {{
      const int span = across ? kRoomW : kRoomH;
      const int c = across ? kRoomX[i] : kRoomY[i];
      pos = uint8_t(span > 0 ? c * 255 / span : 0);
    }} else {{
      pos = uint8_t(i * 256 / len);
    }}
    const uint8_t wave = sin8_t(uint8_t(pos - phase));
    SEGMENT.setPixelColor(i, color_blend(SEGCOLOR(1), SEGCOLOR(0), scale8(wave, SEGMENT.intensity)));
  }}
}}
const char kData[] PROGMEM = "{title}@!,!,,,,Along the other axis;!,!;;1;sx=128,ix=255";

}}  // namespace

class {klass} : public Usermod {{
 public:
  void setup() override {{
    if (strip.getModeCount() > kId) return;
    while (strip.getModeCount() < kId)
      if (strip.addEffect(strip.getModeCount(), &fill_solid, kPadName) == 255) return;
    strip.addEffect(kId, &mode_{folder}, kData);
  }}
  void loop() override {{}}
}};

static {klass} {folder}_usermod;
REGISTER_USERMOD({folder}_usermod);
"""


def room_map_header(room: dict | None) -> str:
    """room_map.h: each LED's position from the room model (doubled grid units, so
    integers), the extent, and the LED count; an empty map without a model."""
    xs: list[int] = []
    ys: list[int] = []
    if room:
        step = {"up": (0, -2), "right": (2, 0), "down": (0, 2), "left": (-2, 0)}
        x = y = 0
        for e in room["edges"]:
            dx, dy = step[e["direction"]]
            for _ in range(e["pixels"]):
                xs.append(x + dx // 2)
                ys.append(y + dy // 2)
                x, y = x + dx, y + dy
    if xs:
        mx, my = min(xs), min(ys)
        xs, ys = [v - mx for v in xs], [v - my for v in ys]
    n = len(xs)
    fmt = lambda vals: ", ".join(str(v) for v in vals) if vals else "0"  # noqa: E731
    return (
        "// SPDX-License-Identifier: EUPL-1.2\n"
        "// Written by wled-studio from the room model: each LED's position (doubled grid units).\n"
        "// Regenerate it from the Effect studio after changing the room's shape.\n"
        "#pragma once\n#include <stdint.h>\n\n"
        f"constexpr uint16_t kRoomLeds = {n};\n"
        f"constexpr int16_t kRoomW = {max(xs) if xs else 0};\n"
        f"constexpr int16_t kRoomH = {max(ys) if ys else 0};\n"
        f"constexpr int16_t kRoomX[{max(n, 1)}] = {{{fmt(xs)}}};\n"
        f"constexpr int16_t kRoomY[{max(n, 1)}] = {{{fmt(ys)}}};\n"
    )


class RoomMapIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")


class FileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(max_length=MAX_FILE)


class NewEffect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    folder: str = Field(pattern=NEW_FOLDER_RE.pattern)
    title: str = Field(min_length=1, max_length=28, pattern=r"^[A-Za-z0-9 _-]+$")
    effect_id: int = Field(ge=200, le=254)
    template: Literal["wave", "room"] = "wave"


def _root(request: Request) -> Path:
    d = request.app.state.settings.effects_dir
    if d is None:
        raise HTTPException(503, "no effects directory configured (WLEDSTUDIO_EFFECTS_DIR)")
    return d


def _folder(request: Request, folder: str) -> Path:
    if not FOLDER_RE.match(folder):
        raise HTTPException(404, "no such effect")
    p = _root(request) / folder
    if not p.is_dir():
        raise HTTPException(404, "no such effect")
    return p


def _file(request: Request, folder: str, name: str) -> Path:
    if not FILE_RE.match(name):
        raise HTTPException(404, "not an effect source file")
    return _folder(request, folder) / name


@router.get("")
def list_effects(request: Request):
    root = _root(request)
    out = []
    for d in sorted(root.iterdir()) if root.is_dir() else []:
        if d.is_dir() and FOLDER_RE.match(d.name):
            out.append({"folder": d.name, "files": sorted(f.name for f in d.iterdir() if f.is_file() and FILE_RE.match(f.name))})
    return out


@router.get("/{folder}/{name}")
def read_file(folder: str, name: str, request: Request):
    p = _file(request, folder, name)
    if not p.is_file():
        raise HTTPException(404, "no such file")
    return {"folder": folder, "name": name, "content": p.read_text(encoding="utf-8")}


@router.put("/{folder}/{name}")
def save_file(folder: str, name: str, body: FileIn, request: Request):
    p = _file(request, folder, name)
    if name == "library.json":
        try:
            lib = json.loads(body.content)
        except json.JSONDecodeError as e:
            raise HTTPException(422, f"library.json isn't valid JSON: {e.msg}") from None
        if not isinstance(lib, dict) or not str(lib.get("name", "")).startswith("wled-"):
            raise HTTPException(422, 'library.json needs a "name" starting with "wled-" (WLED treats it as a module)')
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(body.content, encoding="utf-8")
    os.replace(tmp, p)
    return {"folder": folder, "name": name, "bytes": len(body.content.encode("utf-8"))}


@router.post("", status_code=201)
def create_effect(body: NewEffect, request: Request):
    root = _root(request)
    d = root / body.folder
    if d.exists():
        raise HTTPException(409, "that folder exists")
    d.mkdir(parents=True)
    klass = "".join(part.capitalize() for part in body.folder.split("_")) + "Usermod"
    (d / "library.json").write_text(json.dumps({
        "name": f"wled-{body.folder.replace('_', '-')}",
        "description": f"{body.title}: an effect made in wled-studio",
        "build": {"libArchive": False},
    }, indent=2) + "\n", encoding="utf-8")
    template = ROOM_TEMPLATE if body.template == "room" else TEMPLATE
    (d / f"{body.folder}.cpp").write_text(template.format(title=body.title, folder=body.folder, klass=klass,
                                                          effect_id=body.effect_id), encoding="utf-8")
    if body.template == "room":
        (d / "room_map.h").write_text(room_map_header(None), encoding="utf-8")
    return {"folder": body.folder, "files": sorted(f.name for f in d.iterdir())}


@router.post("/{folder}/room-map")
def write_room_map(folder: str, body: RoomMapIn, request: Request):
    """Write room_map.h into an effect's folder, from a device's room model."""
    d = _folder(request, folder)
    p = request.app.state.settings.data_dir / "rooms" / f"{body.device}.json"
    if not p.exists():
        raise HTTPException(404, "that device has no room model")
    room = json.loads(p.read_text())
    (d / "room_map.h").write_text(room_map_header(room), encoding="utf-8")
    return {"folder": folder, "name": "room_map.h", "leds": sum(e["pixels"] for e in room["edges"])}
