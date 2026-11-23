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

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/api/effects")
FOLDER_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
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


class FileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(max_length=MAX_FILE)


class NewEffect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    folder: str = Field(pattern=FOLDER_RE.pattern)
    title: str = Field(min_length=1, max_length=28, pattern=r"^[A-Za-z0-9 _-]+$")
    effect_id: int = Field(ge=200, le=254)


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
    (d / f"{body.folder}.cpp").write_text(TEMPLATE.format(title=body.title, folder=body.folder, klass=klass,
                                                          effect_id=body.effect_id), encoding="utf-8")
    return {"folder": body.folder, "files": sorted(f.name for f in d.iterdir())}
