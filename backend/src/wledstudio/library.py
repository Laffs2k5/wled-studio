# SPDX-License-Identifier: EUPL-1.2
"""The look library: looks keyed by name, resolved to ids per device.

WLED presets name effects and palettes by number, and numbers can change
between firmware builds; names don't. So a look stores effect and palette
*names*, plus a snapshot of each effect's metadata string when it was saved.
When a look is written to a device, names are resolved against that device's
current lists, and the snapshot is compared with the device's metadata:

  ok          same effect, same metadata
  remapped    the effect's id changed; nothing else
  check       metadata changed in a way that probably doesn't matter (labels,
              defaults, a new control)
  review      a control the look sets is gone, the audio or 1D/2D flags
              changed, or a colour slot disappeared: not pushed until accepted
  unavailable the effect (or palette) doesn't exist on the device
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from . import fxmeta

SEG_SLIDERS = ("sx", "ix", "c1", "c2", "c3")
SEG_CHECKS = ("o1", "o2", "o3")
SEG_PASSTHROUGH = ("start", "stop", "on", "bri", "col", "rev", "mi", "bm", "grp", "spc", "of", "frz", "n")
MAX_NAME_BYTES = 32  # WLED preset names
STATUS_ORDER = ["ok", "remapped", "check", "review", "unavailable"]


class LookError(ValueError):
    pass


def worst(statuses) -> str:
    return max(statuses, key=STATUS_ORDER.index, default="ok")


def check_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise LookError("a look needs a name")
    if len(name.encode("utf-8")) > MAX_NAME_BYTES:
        raise LookError(f"names are at most {MAX_NAME_BYTES} bytes (WLED's preset name limit)")
    if any(ord(c) < 32 for c in name):
        raise LookError("no control characters in names")
    return name


@dataclass
class DeviceLists:
    """What one device offers: effect names and metadata, palette names."""
    effects: list[str]
    fxdata: list[str]
    palettes: list[str]

    def effect_id(self, name: str) -> int | None:
        try:
            i = self.effects.index(name)
        except ValueError:
            return None
        return None if "RSVD" in name else i

    def palette_id(self, name: str) -> int | None:
        try:
            return self.palettes.index(name)
        except ValueError:
            return None

    def meta(self, effect_id: int) -> str:
        return self.fxdata[effect_id] if effect_id < len(self.fxdata) else ""


# --- import --------------------------------------------------------------------

def segment_from_state(seg: dict, lists: DeviceLists) -> tuple[dict, str | None]:
    """A WLED segment (state or preset) -> a look segment; returns (segment, effect name)."""
    out: dict = {k: seg[k] for k in SEG_PASSTHROUGH if k in seg}
    fx = seg.get("fx")
    name = None
    if isinstance(fx, int) and 0 <= fx < len(lists.effects):
        name = lists.effects[fx]
        out["effect"] = name
    elif fx is not None:
        out["effect_id"] = fx
    pal = seg.get("pal")
    if isinstance(pal, int) and 0 <= pal < len(lists.palettes):
        out["palette"] = lists.palettes[pal]
    elif pal is not None:
        out["palette_id"] = pal  # a custom palette (ids from 200 down) or unknown
    for k in SEG_SLIDERS + SEG_CHECKS:
        if k in seg:
            out[k] = seg[k]
    return out, name


def look_from_preset(pid: str, preset: dict, lists: DeviceLists) -> dict | None:
    """Turn one presets.json entry into a look; None for entries that aren't looks."""
    if not isinstance(preset, dict) or "seg" not in preset:
        return None  # empty slot, playlist or plain API command
    segs = preset["seg"] if isinstance(preset["seg"], list) else [preset["seg"]]
    look: dict = {"name": preset.get("n") or f"Preset {pid}", "preset_id": int(pid), "segments": [],
                  "snapshot": {}, "imported_ids": {}}
    for k in ("on", "bri", "transition", "mainseg"):
        if k in preset:
            look[k] = preset[k]
    ar = preset.get("AudioReactive")
    if isinstance(ar, dict) and "enabled" in ar:
        look["mic"] = bool(ar["enabled"])
    for seg in segs:
        if not isinstance(seg, dict) or seg.get("stop") == 0:
            continue
        s, name = segment_from_state(seg, lists)
        look["segments"].append(s)
        if name is not None:
            look["snapshot"][name] = lists.meta(seg["fx"])
            look["imported_ids"][name] = seg["fx"]
    return look


def import_presets(presets: dict, lists: DeviceLists) -> tuple[list[dict], list[str]]:
    looks, skipped = [], []
    for pid, p in sorted(presets.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0):
        if pid == "0":
            continue
        look = look_from_preset(pid, p, lists)
        if look is None:
            skipped.append(pid)
        else:
            looks.append(look)
    return looks, skipped


def _as_list(v, n: int, default: int) -> list[int]:
    if isinstance(v, list):
        return [int(x) for x in v] + [default] * (n - len(v))
    return [int(v) if v is not None else default] * n


def playlist_from_preset(pid: str, preset: dict, name_by_id: dict[int, str]) -> dict | None:
    """A presets.json playlist -> a library playlist with looks by name; None if it isn't one
    or refers to presets that aren't looks."""
    pl = preset.get("playlist") if isinstance(preset, dict) else None
    if not isinstance(pl, dict) or not isinstance(pl.get("ps"), list) or not pl["ps"]:
        return None
    ids = [int(x) for x in pl["ps"]]
    if any(i not in name_by_id for i in ids):
        return None
    n = len(ids)
    durs, trans = _as_list(pl.get("dur"), n, 100), _as_list(pl.get("transition"), n, 7)
    end = pl.get("end")
    return {
        "name": preset.get("n") or f"Playlist {pid}", "preset_id": int(pid),
        "entries": [{"look": name_by_id[i], "duration": durs[k], "transition": trans[k]} for k, i in enumerate(ids)],
        "repeat": int(pl.get("repeat", 0)), "shuffle": bool(pl.get("r", False)),
        "end": name_by_id.get(int(end)) if isinstance(end, int) and end not in (0, 255) else None,
    }


def normalized_playlist(preset: dict) -> dict | None:
    """A playlist preset with WLED's defaults filled in, for comparing."""
    pl = preset.get("playlist") if isinstance(preset, dict) else None
    if not isinstance(pl, dict) or not isinstance(pl.get("ps"), list):
        return None
    n = len(pl["ps"])
    return {"n": preset.get("n"), "ps": [int(x) for x in pl["ps"]], "dur": _as_list(pl.get("dur"), n, 100),
            "transition": _as_list(pl.get("transition"), n, 7), "repeat": int(pl.get("repeat", 0)),
            "r": bool(pl.get("r", False)), "end": int(pl.get("end", 0) or 0)}


def resolve_playlist(pl: dict, looks: dict[str, dict]) -> Resolved:
    """A library playlist -> a presets.json entry; its looks must have slots."""
    ids, notes = [], []
    for e in pl.get("entries", []):
        look = looks.get(e["look"])
        if look is None:
            return Resolved(None, "unavailable", [f"look {e['look']!r} isn't in the library"])
        if look.get("preset_id") is None:
            return Resolved(None, "unavailable", [f"look {e['look']!r} has no slot"])
        ids.append(int(look["preset_id"]))
    if not ids:
        return Resolved(None, "unavailable", ["a playlist needs at least one look"])
    end = 0
    if pl.get("end"):
        end_look = looks.get(pl["end"])
        if end_look is None or end_look.get("preset_id") is None:
            notes.append(f"end look {pl['end']!r} has no slot; the playlist ends where it is")
        else:
            end = int(end_look["preset_id"])
    body = {"ps": ids, "dur": [int(e.get("duration", 100)) for e in pl["entries"]],
            "transition": [int(e.get("transition", 7)) for e in pl["entries"]],
            "repeat": int(pl.get("repeat", 0)), "r": bool(pl.get("shuffle", False)), "end": end}
    return Resolved({"n": pl["name"], "playlist": body}, "ok", notes)


def mic_for(look: dict, lists: DeviceLists) -> bool:
    """The mic rule: a look made for sound (any segment's effect is audio-reactive)
    switches the mic on; any other look switches it off, so the mic state after a
    look is always predictable."""
    for s in look.get("segments", []):
        fx = lists.effect_id(s["effect"]) if s.get("effect") else s.get("effect_id")
        if isinstance(fx, int) and fxmeta.parse(lists.meta(fx), effect_id=fx).audio_reactive:
            return True
    return False


# --- change check --------------------------------------------------------------

def classify(old_meta: str, new_meta: str, segment: dict) -> str:
    if old_meta == new_meta:
        return "ok"
    old, new = fxmeta.parse(old_meta), fxmeta.parse(new_meta)
    used = {k for k in SEG_SLIDERS + SEG_CHECKS if k in segment}
    old_keys = {c.key for c in old.controls}
    new_keys = {c.key for c in new.controls}
    if (used & old_keys) - new_keys:
        return "review"
    if old.audio != new.audio or old.dimensions != new.dimensions:
        return "review"
    if len(new.colours) < len(old.colours):
        return "review"
    if old.palette and not new.palette and "palette" in segment:
        return "review"
    return "check"


# --- export --------------------------------------------------------------------

@dataclass
class Resolved:
    preset: dict | None
    status: str
    notes: list[str] = field(default_factory=list)


def resolve_look(look: dict, lists: DeviceLists, imported_ids: dict | None = None) -> Resolved:
    """A look -> a presets.json entry for this device, with its change-check status."""
    notes: list[str] = []
    statuses: list[str] = []
    segs = []
    for i, s in enumerate(look.get("segments", [])):
        out: dict = {"id": i}
        for k in SEG_PASSTHROUGH + SEG_SLIDERS + SEG_CHECKS:
            if k in s:
                out[k] = s[k]
        name = s.get("effect")
        if name is not None:
            fx = lists.effect_id(name)
            if fx is None:
                return Resolved(None, "unavailable", [f"effect {name!r} isn't on this device"])
            out["fx"] = fx
            snap = look.get("snapshot", {}).get(name)
            st = classify(snap, lists.meta(fx), s) if snap is not None else "ok"
            if st == "ok" and imported_ids and imported_ids.get(name) not in (None, fx):
                st = "remapped"
                notes.append(f"{name!r}: id {imported_ids[name]} -> {fx}")
            if st in ("check", "review"):
                notes.append(f"{name!r}: metadata changed ({st})")
            statuses.append(st)
        elif "effect_id" in s:
            out["fx"] = s["effect_id"]
        pal = s.get("palette")
        if pal is not None:
            pid = lists.palette_id(pal)
            if pid is None:
                return Resolved(None, "unavailable", [f"palette {pal!r} isn't on this device"])
            out["pal"] = pid
        elif "palette_id" in s:
            out["pal"] = s["palette_id"]
        segs.append(out)
    preset: dict = {"n": look["name"], "seg": segs}
    for k in ("on", "bri", "transition", "mainseg"):
        if k in look:
            preset[k] = look[k]
    if look.get("mic") is not None:
        preset["AudioReactive"] = {"enabled": bool(look["mic"])}
    return Resolved(preset, worst(statuses), notes)


def plan_presets(device_presets: dict, looks: list[dict], lists: DeviceLists,
                 accept_review: bool = False, playlists: list[dict] | None = None) -> tuple[dict, list[dict]]:
    """Merge the library's looks (those with a preset_id) into the device's presets.

    Entries the library doesn't manage are kept as they are. Looks that resolve
    to 'unavailable', or to 'review' without accept_review, are left out.
    """
    out = json.loads(json.dumps(device_presets))  # deep copy
    report = []
    for look in looks:
        pid = look.get("preset_id")
        if pid is None:
            continue
        if not 1 <= int(pid) <= 250:
            report.append({"look": look["name"], "status": "unavailable", "notes": ["preset id out of range"]})
            continue
        r = resolve_look(look, lists, look.get("imported_ids"))
        written = r.preset is not None and (r.status != "review" or accept_review)
        if written:
            out[str(pid)] = r.preset
        report.append({"look": look["name"], "preset_id": pid, "status": r.status, "notes": r.notes,
                       "written": written})
    by_name = {lk["name"]: lk for lk in looks}
    look_slots = {int(lk["preset_id"]) for lk in looks if lk.get("preset_id") is not None}
    for pl in playlists or []:
        pid = pl.get("preset_id")
        if pid is None:
            continue
        entry = {"playlist": pl["name"], "preset_id": pid}
        if int(pid) in look_slots:
            report.append({**entry, "status": "unavailable", "notes": ["slot already used by a look"], "written": False})
            continue
        r = resolve_playlist(pl, by_name)
        existing = out.get(str(pid))
        if r.preset is not None and existing is not None and normalized_playlist(existing) == normalized_playlist(r.preset):
            report.append({**entry, "status": r.status, "notes": r.notes + ["unchanged"], "written": False})
            continue
        if r.preset is not None:
            out[str(pid)] = r.preset
        report.append({**entry, "status": r.status, "notes": r.notes, "written": r.preset is not None})
    return out, report


# --- storage -------------------------------------------------------------------

class LibraryStore:
    """Looks in data/library.json; every save keeps the previous file as a version."""

    def __init__(self, data_dir: Path):
        self.path = data_dir / "library.json"
        self.history = data_dir / "history"

    def load(self) -> dict:
        if not self.path.exists():
            return {"looks": {}, "playlists": {}}
        lib = json.loads(self.path.read_text(encoding="utf-8"))
        lib.setdefault("playlists", {})
        return lib

    def save(self, lib: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            self.history.mkdir(exist_ok=True)
            n = len(list(self.history.glob("library-*.json")))
            (self.history / f"library-{n:05d}.json").write_bytes(self.path.read_bytes())
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(lib, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, self.path)

    def looks(self) -> dict:
        return self.load()["looks"]

    def put(self, look: dict) -> dict:
        look["name"] = check_name(look["name"])
        lib = self.load()
        lib["looks"][look["name"]] = look
        self.save(lib)
        return look

    def delete(self, name: str) -> bool:
        lib = self.load()
        if lib["looks"].pop(name, None) is None:
            return False
        self.save(lib)
        return True

    def playlists(self) -> dict:
        return self.load()["playlists"]

    def put_playlist(self, pl: dict) -> dict:
        pl["name"] = check_name(pl["name"])
        lib = self.load()
        lib["playlists"][pl["name"]] = pl
        self.save(lib)
        return pl

    def delete_playlist(self, name: str) -> bool:
        lib = self.load()
        if lib["playlists"].pop(name, None) is None:
            return False
        self.save(lib)
        return True
