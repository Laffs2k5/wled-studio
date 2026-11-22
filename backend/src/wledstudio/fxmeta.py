# SPDX-License-Identifier: EUPL-1.2
"""Parse WLED effect metadata strings into the controls an effect uses.

WLED describes each effect with a metadata string. `/json/fxdata` returns, per
effect id, the part after the name:

    <controls>;<colours>;<palette>;<flags>;<defaults>

- controls: comma-separated labels for the sliders speed (sx), intensity (ix),
  custom1..3 (c1, c2, c3), then the checkboxes o1..o3. An empty label hides the
  control; "!" means "use the default label".
- colours: up to three colour slots, same rules ("!" = default: Fx, Bg, Cs).
- palette: non-empty and not a number means the palette is used ("!" or a label).
- flags: characters: "0" (optimised for one pixel), "1" (1D), "2" (2D),
  "v" (volume reactive), "f" (frequency reactive).
- defaults: comma-separated key=value pairs (sx=128, ix=200, pal=35, c1=…, o1=1, …).

An empty string means the effect defines no controls: WLED then shows speed
and intensity (and, for ids from 128 up, all five sliders), all three colours
and the palette.

The full metadata string (as in WLED's source, with the name and an "@") is
accepted too.
"""
from __future__ import annotations

from dataclasses import dataclass, field

SLIDERS = ("sx", "ix", "c1", "c2", "c3")
CHECKS = ("o1", "o2", "o3")
SLIDER_DEFAULT_LABELS = {"sx": "Speed", "ix": "Intensity", "c1": "Custom 1", "c2": "Custom 2", "c3": "Custom 3"}
CHECK_DEFAULT_LABELS = {"o1": "Option 1", "o2": "Option 2", "o3": "Option 3"}
COLOUR_DEFAULT_LABELS = ("Fx", "Bg", "Cs")
# value ranges in WLED's segment state (c3 is 5 bits)
RANGES = {"sx": (0, 255), "ix": (0, 255), "c1": (0, 255), "c2": (0, 255), "c3": (0, 31)}
LEGACY_ALL_SLIDERS_FROM_ID = 128


@dataclass(frozen=True)
class Control:
    key: str          # sx, ix, c1, c2, c3, o1, o2, o3
    label: str
    kind: str         # "slider" or "checkbox"
    min: int = 0
    max: int = 255
    default: int | None = None


@dataclass(frozen=True)
class EffectMeta:
    name: str | None
    controls: tuple[Control, ...]
    colours: tuple[str, ...]          # labels of the colour slots used, in slot order
    palette: bool
    dimensions: tuple[int, ...]       # (1,), (2,), (1, 2); () if unspecified
    audio: tuple[str, ...]            # "volume", "frequency"
    defaults: dict = field(default_factory=dict)
    defined: bool = True              # False: no metadata, WLED's legacy defaults apply

    @property
    def audio_reactive(self) -> bool:
        return bool(self.audio)

    @property
    def is_2d_only(self) -> bool:
        return self.dimensions == (2,)

    def control(self, key: str) -> Control | None:
        return next((c for c in self.controls if c.key == key), None)


def _split(s: str, sep: str) -> list[str]:
    return [] if s == "" else s.split(sep)


def _int_or_none(v: str) -> int | None:
    try:
        return int(v)
    except ValueError:
        return None


def parse_defaults(s: str) -> dict:
    out: dict = {}
    for item in _split(s, ","):
        key, eq, value = item.partition("=")
        key = key.strip()
        if not eq or not key:
            continue
        n = _int_or_none(value.strip())
        out[key] = n if n is not None else value.strip()
    return out


def parse(meta: str, effect_id: int | None = None) -> EffectMeta:
    """Parse one effect's metadata (with or without "Name@")."""
    name = None
    if "@" in meta:
        name, _, meta = meta.partition("@")

    if meta == "":
        legacy = (effect_id is not None and effect_id >= LEGACY_ALL_SLIDERS_FROM_ID)
        keys = SLIDERS if legacy else SLIDERS[:2]
        controls = tuple(Control(k, SLIDER_DEFAULT_LABELS[k], "slider", *RANGES[k]) for k in keys)
        return EffectMeta(name=name, controls=controls, colours=COLOUR_DEFAULT_LABELS, palette=True,
                          dimensions=(), audio=(), defaults={}, defined=False)

    parts = meta.split(";")
    parts += [""] * (5 - len(parts))
    ctrl_s, col_s, pal_s, flag_s, def_s = parts[:5]
    defaults = parse_defaults(def_s)

    labels = _split(ctrl_s, ",")
    controls: list[Control] = []
    for i, key in enumerate(SLIDERS + CHECKS):
        if i >= len(labels) or labels[i] == "":
            continue
        is_slider = key in SLIDERS
        default_label = (SLIDER_DEFAULT_LABELS if is_slider else CHECK_DEFAULT_LABELS)[key]
        label = default_label if labels[i] == "!" else labels[i]
        lo, hi = RANGES.get(key, (0, 1))
        controls.append(Control(key, label, "slider" if is_slider else "checkbox", lo, hi,
                                defaults.get(key) if isinstance(defaults.get(key), int) else None))

    colours = []
    for i, lab in enumerate(_split(col_s, ",")[:3]):
        if lab == "":
            continue
        colours.append(COLOUR_DEFAULT_LABELS[i] if lab == "!" else lab)

    pal = pal_s.strip()
    palette = pal != "" and _int_or_none(pal) is None

    dims = tuple(sorted({int(c) for c in flag_s if c in "12"}))
    audio = tuple(a for c, a in (("v", "volume"), ("f", "frequency")) if c in flag_s)

    return EffectMeta(name=name, controls=tuple(controls), colours=tuple(colours), palette=palette,
                      dimensions=dims, audio=audio, defaults=defaults, defined=True)


def parse_all(names: list[str], fxdata: list[str]) -> list[dict]:
    """Combine /json/eff and /json/fxdata into a list of effect descriptions.

    Reserved slots (names containing "RSVD") are skipped, as WLED's UI does.
    """
    out = []
    for i, name in enumerate(names):
        if "RSVD" in name:
            continue
        meta = parse(fxdata[i] if i < len(fxdata) else "", effect_id=i)
        out.append({
            "id": i,
            "name": name,
            "controls": [c.__dict__ for c in meta.controls],
            "colours": list(meta.colours),
            "palette": meta.palette,
            "dimensions": list(meta.dimensions),
            "audio": list(meta.audio),
            "defaults": meta.defaults,
            "defined": meta.defined,
            "metadata": fxdata[i] if i < len(fxdata) else "",
        })
    return out
