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
from collections.abc import Collection
from dataclasses import dataclass, field
from pathlib import Path

from . import fxmeta

SEG_SLIDERS = ("sx", "ix", "c1", "c2", "c3")
SEG_CHECKS = ("o1", "o2", "o3")
# The segment fields WLED writes into a preset (json.cpp serializeSegment, forPreset), less fx
# and pal, which a look stores by name, and the sliders and checks above. A look keeps all of
# them, so a preset WLED saved survives import and write unchanged; nothing else reaches a
# preset (a look sent to the API can't smuggle in, say, "rb" for a reboot).
SEG_PASSTHROUGH = ("start", "stop", "startY", "stopY", "grp", "spc", "of", "on", "frz", "bri", "cct", "set",
                   "lc", "n", "col", "sel", "rev", "mi", "rY", "mY", "tp", "si", "m12", "bm")
# ... and at the top of a preset (json.cpp serializeState; "ql" from presets.cpp)
PRESET_PASSTHROUGH = ("on", "bri", "transition", "bs", "mainseg", "ql")
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


MAX_FOLDER_BYTES = 40


def check_folder(folder: str | None) -> str | None:
    """A folder name for library items (library-only: never written to a device); "" means none."""
    if folder is None:
        return None
    folder = folder.strip()
    if not folder:
        return None
    if len(folder.encode("utf-8")) > MAX_FOLDER_BYTES:
        raise LookError(f"folder names are at most {MAX_FOLDER_BYTES} bytes")
    if any(ord(c) < 32 for c in folder):
        raise LookError("no control characters in folder names")
    return folder


CUSTOM_PALETTE_BASE = 200  # WLED 16: custom palette file index i has palette id 200 - i
MAX_CUSTOM_PALETTES = 129


@dataclass
class DeviceLists:
    """What one device offers: effect names and metadata, palette names, and the custom
    palettes wled-studio put there (name -> palette id, from the device's manifest).
    max_segments is the device's segment limit (info.leds.maxseg), if known."""
    effects: list[str]
    fxdata: list[str]
    palettes: list[str]
    custom: dict[str, int] = field(default_factory=dict)
    max_segments: int | None = None

    def effect_id(self, name: str) -> int | None:
        try:
            i = self.effects.index(name)
        except ValueError:
            return None
        return None if "RSVD" in name else i

    def palette_id(self, name: str) -> int | None:
        if name in self.custom:
            return self.custom[name]
        try:
            return self.palettes.index(name)
        except ValueError:
            return None

    def palette_name(self, pid: int) -> str | None:
        if 0 <= pid < len(self.palettes):
            return self.palettes[pid]
        return next((n for n, i in self.custom.items() if i == pid), None)

    def meta(self, effect_id: int) -> str:
        return self.fxdata[effect_id] if effect_id < len(self.fxdata) else ""


# --- import --------------------------------------------------------------------

def segment_from_state(seg: dict, lists: DeviceLists) -> tuple[dict, str | None]:
    """A WLED segment (state or preset) -> a look segment; returns (segment, effect name)."""
    out: dict = {k: seg[k] for k in SEG_PASSTHROUGH if k in seg}
    if "id" in seg:
        out["id"] = seg["id"]  # written back only if it was there (an array entry's id is its position)
    fx = seg.get("fx")
    name = None
    if isinstance(fx, int) and 0 <= fx < len(lists.effects):
        name = lists.effects[fx]
        out["effect"] = name
    elif fx is not None:
        out["effect_id"] = fx
    pal = seg.get("pal")
    if isinstance(pal, int) and lists.palette_name(pal) is not None:
        out["palette"] = lists.palette_name(pal)
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
    for k in PRESET_PASSTHROUGH:
        if k in preset:
            look[k] = preset[k]
    ar = preset.get("AudioReactive")
    if isinstance(ar, dict) and "enabled" in ar:
        look["mic"] = bool(ar["enabled"])
    if any(isinstance(s, dict) and s.get("stop") == 0 for s in segs):
        look["clear_other_segments"] = True  # saved with segment bounds: keep deleting the rest
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
            return Resolved(None, "unavailable", [f"look {e['look']!r} has no preset id"])
        ids.append(int(look["preset_id"]))
    if not ids:
        return Resolved(None, "unavailable", ["a playlist needs at least one look"])
    end = 0
    if pl.get("end"):
        end_look = looks.get(pl["end"])
        if end_look is None or end_look.get("preset_id") is None:
            notes.append(f"end look {pl['end']!r} has no preset id; the playlist ends where it is")
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


# --- walls and zones ---------------------------------------------------------------

def wall_ranges(room: dict | None) -> dict[str, tuple[int, int]]:
    """A room model's labelled edges as LED ranges (stop exclusive); the first of a label wins."""
    out: dict[str, tuple[int, int]] = {}
    at = 0
    for e in (room or {}).get("edges", []):
        n = int(e.get("pixels", 0))
        label = e.get("label")
        if label and label not in out:
            out[label] = (at, at + n)
        at += n
    return out


def zone_ranges(room: dict | None) -> dict[str, tuple[int, int]]:
    """A room model's named zones (a door, a desk: LED ranges inside or across walls)."""
    return {z["label"]: (int(z["start"]), int(z["stop"])) for z in (room or {}).get("zones", [])}


def tag_areas(look: dict, room: dict | None) -> dict:
    """Name the wall or zone that each segment covers exactly (a wall first, then a zone).

    The look then follows it: if the room model's boundaries are corrected later (measured on
    the strip, say), every look on that wall or zone moves with it."""
    walls: dict[tuple[int, int], str] = {}
    for label, r in wall_ranges(room).items():
        walls.setdefault(r, label)
    zones: dict[tuple[int, int], str] = {}
    for label, r in zone_ranges(room).items():
        zones.setdefault(r, label)
    for s in look.get("segments", []):
        s.pop("wall", None)
        s.pop("zone", None)
        r = (s.get("start"), s.get("stop"))
        if r in walls:
            s["wall"] = walls[r]
        elif r in zones:
            s["zone"] = zones[r]
    return look


tag_walls = tag_areas  # the earlier name


# --- change check --------------------------------------------------------------

def _dims(d: tuple[int, ...]) -> str:
    return "/".join(f"{n}D" for n in d) or "unspecified"


def compare_meta(old_meta: str, new_meta: str, segment: dict) -> tuple[str, list[str]]:
    """How an effect's metadata changed since a look was saved, for that look's segment:
    the status ("ok", "check" or "review") and the reasons, in words."""
    if old_meta == new_meta:
        return "ok", []
    old, new = fxmeta.parse(old_meta), fxmeta.parse(new_meta)
    used = {k for k in SEG_SLIDERS + SEG_CHECKS if k in segment}
    old_c = {c.key: c for c in old.controls}
    new_c = {c.key: c for c in new.controls}
    review, check = [], []
    for key in sorted(old_c.keys() - new_c.keys()):
        (review if key in used else check).append(
            f"{old_c[key].label} ({key}) is gone" + ("" if key in used else ", not set by this look"))
    for key in sorted(old_c.keys() & new_c.keys()):
        if old_c[key].label != new_c[key].label:
            check.append(f"{key} relabelled: {old_c[key].label} -> {new_c[key].label}")
    for key in sorted(new_c.keys() - old_c.keys()):
        check.append(f"new control {new_c[key].label} ({key})")
    if old.audio != new.audio:
        review.append("now sound-reactive" if not old.audio else "no longer sound-reactive" if not new.audio
                      else f"sound input changed: {', '.join(old.audio)} -> {', '.join(new.audio)}")
    if old.dimensions != new.dimensions:
        review.append(f"dimensions changed: {_dims(old.dimensions)} -> {_dims(new.dimensions)}")
    if len(new.colours) < len(old.colours):
        review.append(f"colour slots: {len(old.colours)} -> {len(new.colours)}")
    if old.palette and not new.palette and "palette" in segment:
        review.append("no longer uses a palette")
    if review:
        return "review", review + check
    return "check", check or ["metadata text changed (defaults or labels)"]


def classify(old_meta: str, new_meta: str, segment: dict) -> str:
    return compare_meta(old_meta, new_meta, segment)[0]


def accept_snapshot(look: dict, lists: DeviceLists) -> dict:
    """Accept the device's current version of each effect the look uses: a new metadata
    snapshot and id, so the look's status is ok again. Effects the device doesn't have are
    left alone (the look stays unavailable)."""
    for s in look.get("segments", []):
        name = s.get("effect")
        fx = lists.effect_id(name) if name else None
        if fx is not None:
            look.setdefault("snapshot", {})[name] = lists.meta(fx)
            look.setdefault("imported_ids", {})[name] = fx
    return look


def check_library(looks: list[dict], playlists: list[dict], lists: DeviceLists,
                  room: dict | None = None) -> list[dict]:
    """Each look's change-check status on this device; a playlist takes the worst status of
    the looks it plays (a missing look makes it unavailable)."""
    out, by_name = [], {}
    for look in looks:
        r = resolve_look(look, lists, look.get("imported_ids"), room)
        by_name[look["name"]] = r.status
        out.append({"look": look["name"], "status": r.status, "notes": r.notes})
    for pl in playlists:
        names = [e["look"] for e in pl.get("entries", [])] + ([pl["end"]] if pl.get("end") else [])
        missing = [n for n in names if n not in by_name]
        st = "unavailable" if missing else worst(by_name[n] for n in names)
        notes = [f"look {n!r} isn't in the library" for n in missing]
        notes += [f"{n!r} is {by_name[n]}" for n in dict.fromkeys(names) if by_name.get(n, "ok") != "ok"]
        out.append({"playlist": pl["name"], "status": st, "notes": notes})
    return out


# --- export --------------------------------------------------------------------

@dataclass
class Resolved:
    preset: dict | None
    status: str
    notes: list[str] = field(default_factory=list)


def resolve_look(look: dict, lists: DeviceLists, imported_ids: dict | None = None,
                 room: dict | None = None) -> Resolved:
    """A look -> a presets.json entry for this device, with its change-check status.

    room: the device's room model; a segment named by wall takes that wall's LEDs from it."""
    notes: list[str] = []
    statuses: list[str] = []
    segs = []
    areas = ({"wall": wall_ranges(room), "zone": zone_ranges(room)} if room is not None else None)
    for i, s in enumerate(look.get("segments", [])):
        out: dict = {"id": i} if "id" in s else {}  # positions: padding after them must line up
        for k in SEG_PASSTHROUGH + SEG_SLIDERS + SEG_CHECKS:
            if k in s:
                out[k] = s[k]
        for kind in ("wall", "zone"):
            if s.get(kind) is None or areas is None:
                continue
            r = areas[kind].get(s[kind])
            if r is None:
                return Resolved(None, "unavailable", [f"{kind} {s[kind]!r} isn't in this device's room model"])
            if (out.get("start"), out.get("stop")) != r:
                notes.append(f"segment {i} follows {kind} {s[kind]!r} to LEDs {r[0]}-{r[1] - 1}")
            out["start"], out["stop"] = r
        name = s.get("effect")
        if name is not None:
            fx = lists.effect_id(name)
            if fx is None:
                return Resolved(None, "unavailable", [f"effect {name!r} isn't on this device"])
            out["fx"] = fx
            snap = look.get("snapshot", {}).get(name)
            st, reasons = compare_meta(snap, lists.meta(fx), s) if snap is not None else ("ok", [])
            if st == "ok" and imported_ids and imported_ids.get(name) not in (None, fx):
                st = "remapped"
                notes.append(f"{name!r}: id {imported_ids[name]} -> {fx}")
            if st in ("check", "review"):
                notes.append(f"{name!r} changed: " + "; ".join(reasons))
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
    # A look that owns the layout deletes the device's other segments, as WLED's own presets
    # saved with segment bounds do (serializeState pads to the segment limit), so a look with
    # fewer segments doesn't leave the previous look's extra ones running. WLED reads the
    # array by position, so {"stop": 0} needs no id.
    if (look.get("clear_other_segments") and segs and lists.max_segments
            and all("start" in s and "stop" in s for s in segs)):
        segs += [{"stop": 0} for _ in range(len(segs), lists.max_segments)]
    preset: dict = {"n": look["name"], "seg": segs}
    for k in PRESET_PASSTHROUGH:
        if k in look:
            preset[k] = look[k]
    if look.get("mic") is not None:
        preset["AudioReactive"] = {"enabled": bool(look["mic"])}
    return Resolved(preset, worst(statuses), notes)


def preset_name(preset: dict | None, pid: int) -> str | None:
    """What the device shows for a preset id: its name, "Preset <id>" if it has none, or None when
    nothing is stored there."""
    if not preset:
        return None
    return preset.get("n") or f"Preset {pid}"


def duplicate_ids(looks: list[dict], playlists: list[dict]) -> list[dict]:
    """Preset ids that more than one look or playlist wants: only one of them could be on the
    device, and which one would be left to chance. [{"preset_id", "looks", "playlists"}]"""
    by_id: dict[int, dict] = {}
    for kind, items in (("looks", looks), ("playlists", playlists)):
        for item in items:
            pid = item.get("preset_id")
            if isinstance(pid, int):
                by_id.setdefault(pid, {"preset_id": pid, "looks": [], "playlists": []})[kind].append(item["name"])
    return [d for _, d in sorted(by_id.items()) if len(d["looks"]) + len(d["playlists"]) > 1]


def duplicates_message(dups: list[dict]) -> str:
    """The write's refusal, in plain words."""
    parts = []
    for d in dups:
        names = [f"“{n}”" for n in d["looks"]] + [f"playlist “{n}”" for n in d["playlists"]]
        parts.append(f"preset {d['preset_id']}: {', '.join(names[:-1])} and {names[-1]}")
    return ("Not written: more than one look wants the same preset id, so which one ends up on the device "
            f"would be left to chance ({'; '.join(parts)}). Give each its own preset id, then write.")


def plan_presets(device_presets: dict, looks: list[dict], lists: DeviceLists,
                 accept_review: bool | Collection[str] = False, playlists: list[dict] | None = None,
                 room: dict | None = None) -> tuple[dict, list[dict]]:
    """Merge the library's looks (those with a preset_id) into the device's presets.

    Entries the library doesn't manage are kept as they are. Looks that resolve
    to 'unavailable', or to 'review' without accept_review (True, or the look's name
    among those given), are left out. Each report item says what the device holds at
    that id now (`on_device`: its name, or None when empty) and whether writing would
    change it (`changed`).
    """
    def reviewed(name: str) -> bool:
        return accept_review is True or (not isinstance(accept_review, bool) and name in accept_review)

    out = json.loads(json.dumps(device_presets))  # deep copy
    report = []
    for look in looks:
        pid = look.get("preset_id")
        if pid is None:
            continue
        if not 1 <= int(pid) <= 250:
            report.append({"look": look["name"], "status": "unavailable", "notes": ["preset id out of range"]})
            continue
        current = device_presets.get(str(pid))
        r = resolve_look(look, lists, look.get("imported_ids"), room)
        written = r.preset is not None and (r.status != "review" or reviewed(look["name"]))
        if written:
            out[str(pid)] = r.preset
        report.append({"look": look["name"], "preset_id": pid, "status": r.status, "notes": r.notes,
                       "written": written, "changed": written and r.preset != current,
                       "on_device": preset_name(current, pid)})
    by_name = {lk["name"]: lk for lk in looks}
    look_slots = {int(lk["preset_id"]) for lk in looks if lk.get("preset_id") is not None}
    for pl in playlists or []:
        pid = pl.get("preset_id")
        if pid is None:
            continue
        current = device_presets.get(str(pid))
        entry = {"playlist": pl["name"], "preset_id": pid, "on_device": preset_name(current, pid)}
        if int(pid) in look_slots:
            report.append({**entry, "status": "unavailable", "notes": ["preset id already used by a look"],
                           "written": False, "changed": False})
            continue
        r = resolve_playlist(pl, by_name)
        existing = out.get(str(pid))
        if r.preset is not None and existing is not None and normalized_playlist(existing) == normalized_playlist(r.preset):
            report.append({**entry, "status": r.status, "notes": r.notes + ["unchanged"], "written": False,
                           "changed": False})
            continue
        if r.preset is not None:
            out[str(pid)] = r.preset
        report.append({**entry, "status": r.status, "notes": r.notes, "written": r.preset is not None,
                       "changed": r.preset is not None})
    return out, report


# --- custom palettes -----------------------------------------------------------

HEX6 = __import__("re").compile(r"^[0-9a-fA-F]{6}$")


def check_palette(pal: dict) -> dict:
    """A palette: 2-18 stops [position 0-255, "rrggbb"], positions ascending from 0 to 255."""
    pal["name"] = check_name(pal["name"])
    stops = pal.get("stops")
    if not isinstance(stops, list) or not 2 <= len(stops) <= 18:
        raise LookError("a palette has 2 to 18 stops")
    last = -1
    for st in stops:
        if not (isinstance(st, list) and len(st) == 2 and isinstance(st[0], int) and isinstance(st[1], str)):
            raise LookError("a stop is [position, \"rrggbb\"]")
        if not 0 <= st[0] <= 255 or st[0] <= last or not HEX6.match(st[1]):
            raise LookError("positions are 0-255, ascending; colours are rrggbb")
        last = st[0]
    if stops[0][0] != 0 or stops[-1][0] != 255:
        raise LookError("the first stop is at 0 and the last at 255")
    pal["stops"] = [[st[0], st[1].lower()] for st in stops]
    return pal


def palette_file(pal: dict) -> str:
    """WLED's custom palette file: {"palette": [pos, "rrggbb", ...]}."""
    flat: list = []
    for pos, hexcol in pal["stops"]:
        flat += [pos, hexcol]
    return json.dumps({"palette": flat}, separators=(",", ":"))


def assign_palettes(palettes: list[dict], manifest: dict[str, dict]) -> tuple[dict[str, dict], list[dict]]:
    """Give each library palette a file index on the device, keeping existing ones.

    manifest: name -> {"index": i, "sha": content hash}. Returns the new manifest and the
    uploads needed (palettes that are new or changed)."""
    import hashlib
    used = {m["index"] for n, m in manifest.items() if n in {p["name"] for p in palettes}}
    out, uploads = {}, []
    for pal in sorted(palettes, key=lambda p: p["name"]):
        content = palette_file(pal)
        sha = hashlib.sha256(content.encode()).hexdigest()
        cur = manifest.get(pal["name"])
        if cur is not None:
            idx = cur["index"]
        else:
            idx = next(i for i in range(MAX_CUSTOM_PALETTES) if i not in used)
            used.add(idx)
        out[pal["name"]] = {"index": idx, "sha": sha}
        if cur is None or cur.get("sha") != sha:
            uploads.append({"name": pal["name"], "index": idx, "file": f"palette{idx}.json", "content": content})
    return out, uploads


# --- storage -------------------------------------------------------------------

def _keep_folder(old: dict | None, new: dict) -> None:
    """A look saved again (captured, edited, imported) stays in its folder unless told otherwise;
    a folder given is checked, and an empty one means none."""
    if "folder" in new:
        folder = check_folder(new["folder"])
        if folder is None:
            new.pop("folder")
        else:
            new["folder"] = folder
    elif old and "folder" in old:
        new["folder"] = old["folder"]


class LibraryStore:
    """Looks in data/library.json; every save keeps the previous file as a version."""

    def __init__(self, data_dir: Path):
        self.path = data_dir / "library.json"
        self.history = data_dir / "history"

    def load(self) -> dict:
        if not self.path.exists():
            return {"looks": {}, "playlists": {}, "palettes": {}, "sets": {}}
        lib = json.loads(self.path.read_text(encoding="utf-8"))
        lib.setdefault("playlists", {})
        lib.setdefault("palettes", {})
        lib.setdefault("sets", {})
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

    def rename_look(self, old: str, new: str) -> dict:
        """Rename a look, and every playlist's reference to it, in one save."""
        new = check_name(new)
        lib = self.load()
        if old not in lib["looks"]:
            raise KeyError(old)
        if new != old and new in lib["looks"]:
            raise LookError(f"a look named {new!r} exists already")
        look = lib["looks"].pop(old)
        look["name"] = new
        lib["looks"][new] = look
        for pl in lib["playlists"].values():
            for e in pl.get("entries", []):
                if e.get("look") == old:
                    e["look"] = new
            if pl.get("end") == old:
                pl["end"] = new
        for s in lib["sets"].values():
            s["looks"] = [new if n == old else n for n in s.get("looks", [])]
        self.save(lib)
        return look

    def looks(self) -> dict:
        return self.load()["looks"]

    def set_preset_id(self, name: str, preset_id: int | None) -> dict:
        """Give a look another preset id (None: none, library only). Nothing else changes: its name,
        folder, sets and the playlists that play it stay; the slot grid follows the id. Another item
        on the same id is allowed here; the write refuses until one of them moves."""
        lib = self.load()
        look = lib["looks"].get(name)
        if look is None:
            raise KeyError(name)
        if preset_id is None:
            look.pop("preset_id", None)
        else:
            look["preset_id"] = preset_id
        self.save(lib)
        return look

    def preset_users(self, preset_id: int, but: str | None = None) -> list[str]:
        """The looks (by name) and playlists ("playlist <name>") that want this preset id."""
        lib = self.load()
        return ([n for n, lk in lib["looks"].items() if lk.get("preset_id") == preset_id and n != but]
                + [f"playlist {n}" for n, pl in lib["playlists"].items() if pl.get("preset_id") == preset_id])

    def put(self, look: dict) -> dict:
        look["name"] = check_name(look["name"])
        lib = self.load()
        _keep_folder(lib["looks"].get(look["name"]), look)
        lib["looks"][look["name"]] = look
        self.save(lib)
        return look

    def delete(self, name: str) -> bool:
        lib = self.load()
        if lib["looks"].pop(name, None) is None:
            return False
        for s in lib["sets"].values():
            s["looks"] = [n for n in s.get("looks", []) if n != name]
        self.save(lib)
        return True

    def playlists(self) -> dict:
        return self.load()["playlists"]

    def put_playlist(self, pl: dict) -> dict:
        pl["name"] = check_name(pl["name"])
        lib = self.load()
        _keep_folder(lib["playlists"].get(pl["name"]), pl)
        lib["playlists"][pl["name"]] = pl
        self.save(lib)
        return pl

    # --- organising: folders and order (library only; never written to a device) ---
    def set_folder(self, kind: str, names: list[str], folder: str | None) -> list[str]:
        """Put the named looks or playlists in a folder (None: in none)."""
        folder = check_folder(folder)
        lib = self.load()
        coll = lib[kind]
        missing = [n for n in names if n not in coll]
        if missing:
            raise KeyError(missing[0])
        for n in names:
            if folder is None:
                coll[n].pop("folder", None)
            else:
                coll[n]["folder"] = folder
        self.save(lib)
        return names

    def reorder(self, kind: str, names: list[str]) -> list[str]:
        """The library's order of looks or playlists: `names` must be all of them, each once."""
        lib = self.load()
        coll = lib[kind]
        if sorted(names) != sorted(coll) or len(set(names)) != len(names):
            raise LookError("the order must list every item exactly once")
        lib[kind] = {n: coll[n] for n in names}
        self.save(lib)
        return names

    def rename_folder(self, old: str, new: str | None) -> int:
        """Rename a folder in looks and playlists alike (None: dissolve it). Returns the count moved."""
        new = check_folder(new)
        lib = self.load()
        moved = 0
        for kind in ("looks", "playlists"):
            for item in lib[kind].values():
                if item.get("folder") == old:
                    if new is None:
                        item.pop("folder", None)
                    else:
                        item["folder"] = new
                    moved += 1
        if moved:
            self.save(lib)
        return moved

    def palettes(self) -> dict:
        return self.load()["palettes"]

    def put_palette(self, pal: dict) -> dict:
        pal = check_palette(pal)
        lib = self.load()
        lib["palettes"][pal["name"]] = pal
        self.save(lib)
        return pal

    def delete_palette(self, name: str) -> bool:
        lib = self.load()
        if lib["palettes"].pop(name, None) is None:
            return False
        self.save(lib)
        return True

    def delete_playlist(self, name: str) -> bool:
        lib = self.load()
        if lib["playlists"].pop(name, None) is None:
            return False
        for s in lib["sets"].values():
            s["playlists"] = [n for n in s.get("playlists", []) if n != name]
        self.save(lib)
        return True

    # --- per-device sets: which looks and playlists go on which device ---
    def device_set(self, device_id: str) -> dict | None:
        """The device's set ({"looks": [...], "playlists": [...]}), or None: everything goes on it."""
        return self.load()["sets"].get(device_id)

    def put_set(self, device_id: str, looks: list[str] | None, playlists: list[str] | None = None) -> dict | None:
        """Set a device's set; looks None means everything (no set). Names must exist."""
        lib = self.load()
        if looks is None:
            lib["sets"].pop(device_id, None)
            self.save(lib)
            return None
        for kind, names in (("looks", looks), ("playlists", playlists or [])):
            missing = [n for n in names if n not in lib[kind]]
            if missing:
                raise KeyError(missing[0])
        order_l, order_p = list(lib["looks"]), list(lib["playlists"])
        s = {"looks": sorted(set(looks), key=order_l.index), "playlists": sorted(set(playlists or []), key=order_p.index)}
        lib["sets"][device_id] = s
        self.save(lib)
        return s

    def add_to_set(self, device_id: str, looks: list[str], playlists: list[str]) -> dict | None:
        """Add looks and playlists to a device's set; a device without a set has them already."""
        s = self.device_set(device_id)
        if s is None:
            return None
        return self.put_set(device_id, s["looks"] + looks, s["playlists"] + playlists)

    def for_device(self, device_id: str) -> tuple[list[dict], list[dict], list[str]]:
        """The looks and playlists that go on a device, in library order, and notes: a playlist
        in the set brings the looks it plays (they must be on the device for it to work)."""
        lib = self.load()
        s = lib["sets"].get(device_id)
        if s is None:
            return list(lib["looks"].values()), list(lib["playlists"].values()), []
        pls = [lib["playlists"][n] for n in lib["playlists"] if n in s.get("playlists", [])]
        wanted = set(s.get("looks", []))
        notes = []
        for pl in pls:
            needs = [e.get("look") for e in pl.get("entries", [])] + ([pl["end"]] if pl.get("end") else [])
            extra = [n for n in needs if n and n not in wanted and n in lib["looks"]]
            if extra:
                notes.append(f"{pl['name']} brings {', '.join(dict.fromkeys(extra))}")
                wanted.update(extra)
        looks = [lk for n, lk in lib["looks"].items() if n in wanted]
        return looks, pls, notes
