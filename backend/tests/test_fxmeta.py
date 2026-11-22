# SPDX-License-Identifier: EUPL-1.2
from wledstudio import fxmeta


def keys(meta):
    return [c.key for c in meta.controls]


def test_full_string_with_name():
    m = fxmeta.parse("Comet@!,Tail;!;!;1;sx=128,ix=200")
    assert m.name == "Comet"
    assert keys(m) == ["sx", "ix"]
    assert m.control("sx").label == "Speed"
    assert m.control("ix").label == "Tail"
    assert m.control("ix").default == 200
    assert m.colours == ("Fx",)
    assert m.palette is True
    assert m.dimensions == (1,)
    assert m.defaults == {"sx": 128, "ix": 200}


def test_hidden_controls_and_checkboxes():
    m = fxmeta.parse("Speed,Width,,,,Reverse;!;!;1")
    assert keys(m) == ["sx", "ix", "o1"]
    assert m.control("o1").kind == "checkbox"
    assert m.control("o1").label == "Reverse"
    assert m.control("o1").max == 1


def test_all_controls_and_c3_range():
    m = fxmeta.parse("a,b,c,d,e,f,g,h;x,y,z;!;1")
    assert keys(m) == ["sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3"]
    assert m.control("c3").max == 31
    assert m.colours == ("x", "y", "z")


def test_default_labels():
    m = fxmeta.parse("!,!,!,!,!,!,!,!;!,!,!;!")
    assert [c.label for c in m.controls] == ["Speed", "Intensity", "Custom 1", "Custom 2", "Custom 3",
                                             "Option 1", "Option 2", "Option 3"]
    assert m.colours == ("Fx", "Bg", "Cs")


def test_colour_slots_can_be_skipped():
    m = fxmeta.parse("!;,!,;!")
    assert m.colours == ("Bg",)


def test_palette_rules():
    assert fxmeta.parse("!;!;!").palette is True
    assert fxmeta.parse("!;!;Palette").palette is True
    assert fxmeta.parse("!;!;").palette is False
    assert fxmeta.parse("!;!;5").palette is False  # a number isn't a palette label


def test_flags():
    assert fxmeta.parse("!;!;!;2").is_2d_only
    assert fxmeta.parse("!;!;!;12").dimensions == (1, 2)
    m = fxmeta.parse("!;!;!;1vf")
    assert m.audio == ("volume", "frequency")
    assert m.audio_reactive
    assert fxmeta.parse("!;!;!;01").dimensions == (1,)


def test_empty_means_legacy_defaults():
    low = fxmeta.parse("", effect_id=5)
    assert not low.defined
    assert keys(low) == ["sx", "ix"]
    assert low.colours == ("Fx", "Bg", "Cs") and low.palette
    high = fxmeta.parse("", effect_id=150)
    assert keys(high) == ["sx", "ix", "c1", "c2", "c3"]


def test_short_strings_and_extra_fields():
    assert keys(fxmeta.parse("!")) == ["sx"]
    m = fxmeta.parse("!;;Color;;2;pal=35")  # six fields: extras ignored
    assert m.colours == ()
    assert m.palette is True


def test_defaults_parsing():
    assert fxmeta.parse_defaults("sx=1, ix=2,pal=35,m12=1,bad,=3,x=abc") == {
        "sx": 1, "ix": 2, "pal": 35, "m12": 1, "x": "abc"}


def test_parse_all_skips_reserved():
    out = fxmeta.parse_all(["Solid", "RSVD", "Comet"], ["", "", "!,Tail;!;!;1"])
    assert [e["name"] for e in out] == ["Solid", "Comet"]
    assert out[1]["id"] == 2
    assert [c["key"] for c in out[1]["controls"]] == ["sx", "ix"]
    assert out[0]["defined"] is False
