# SPDX-License-Identifier: EUPL-1.2
import pytest

from wledstudio.library import (DeviceLists, LibraryStore, LookError, check_name, classify, import_presets,
                                mic_for, plan_presets, resolve_look, worst)

LISTS = DeviceLists(effects=["Solid", "Glow", "RSVD", "Comet", "Meter"],
                    fxdata=["", "!,!;!;!;1", "", "!,Tail;!;!;1", "Gain;!;!;1v"],
                    palettes=["Default", "Sunset", "Ocean"])


def preset(fx, pal=0, **kw):
    seg = {"id": 0, "start": 0, "stop": 60, "fx": fx, "pal": pal, "sx": 100, "ix": 50, "col": [[1, 2, 3, 0]]}
    seg.update(kw)
    return {"n": "P", "on": True, "bri": 100, "seg": [seg]}


def test_import_by_name_with_snapshot():
    looks, skipped = import_presets({"0": {}, "1": preset(3, 1), "2": {"playlist": {"ps": [1]}}}, LISTS)
    assert skipped == ["2"]
    (look,) = looks
    assert look["preset_id"] == 1
    assert look["segments"][0]["effect"] == "Comet"
    assert look["segments"][0]["palette"] == "Sunset"
    assert look["snapshot"] == {"Comet": "!,Tail;!;!;1"}
    assert look["imported_ids"] == {"Comet": 3}


def test_import_keeps_mic_and_unknown_ids():
    p = preset(99, 250)
    p["AudioReactive"] = {"enabled": True}
    (look,), _ = import_presets({"5": p}, LISTS)
    assert look["mic"] is True
    assert look["segments"][0]["effect_id"] == 99
    assert look["segments"][0]["palette_id"] == 250


def test_resolve_by_name_and_remap():
    (look,), _ = import_presets({"1": preset(3)}, LISTS)
    moved = DeviceLists(["Solid", "Comet", "Glow"], ["", "!,Tail;!;!;1", ""], LISTS.palettes)
    r = resolve_look(look, moved, look["imported_ids"])
    assert r.preset["seg"][0]["fx"] == 1
    assert r.status == "remapped"


def test_unavailable_effect_and_palette():
    (look,), _ = import_presets({"1": preset(3, 2)}, LISTS)
    gone = DeviceLists(["Solid"], [""], LISTS.palettes)
    assert resolve_look(look, gone).status == "unavailable"
    nopal = DeviceLists(LISTS.effects, LISTS.fxdata, ["Default"])
    assert resolve_look(look, nopal).status == "unavailable"


def test_mic_written_to_preset():
    (look,), _ = import_presets({"1": preset(4)}, LISTS)
    look["mic"] = False
    assert resolve_look(look, LISTS).preset["AudioReactive"] == {"enabled": False}


@pytest.mark.parametrize("old,new,seg,expected", [
    ("!,Tail;!;!;1", "!,Tail;!;!;1", {"sx": 1}, "ok"),
    ("!,Tail;!;!;1", "!,Length;!;!;1", {"ix": 1}, "check"),          # relabelled
    ("!,Tail;!;!;1", "!,Tail,New;!;!;1", {"ix": 1}, "check"),        # a new control
    ("!,Tail;!;!;1", "!;!;!;1", {"ix": 1}, "review"),                # a control the look sets is gone
    ("!,Tail;!;!;1", "!;!;!;1", {"sx": 1}, "check"),                 # gone, but not used
    ("!;!;!;1", "!;!;!;1v", {}, "review"),                           # became audio-reactive
    ("!;!;!;1", "!;!;!;2", {}, "review"),                            # 1D -> 2D
    ("!;!,!;!;1", "!;!;!;1", {}, "review"),                          # lost a colour slot
    ("!;!;!;1", "!;!;;1", {"palette": "x"}, "review"),               # palette no longer used
])
def test_classify(old, new, seg, expected):
    assert classify(old, new, seg) == expected


def test_worst():
    assert worst(["ok", "remapped", "check"]) == "check"
    assert worst([]) == "ok"


def test_plan_keeps_unmanaged_and_skips_review():
    (look,), _ = import_presets({"1": preset(3)}, LISTS)
    look["name"] = "Comet look"
    device = {"0": {}, "1": {"n": "old"}, "7": {"n": "not ours", "playlist": {}}}
    out, report = plan_presets(device, [look], LISTS)
    assert out["7"] == device["7"]
    assert out["1"]["n"] == "Comet look"
    assert report[0]["written"] is True
    changed = DeviceLists(LISTS.effects, ["", "", "", "!;!;!;1", ""], LISTS.palettes)
    out2, report2 = plan_presets(device, [look], changed)
    assert report2[0]["status"] == "review" and report2[0]["written"] is False
    assert out2["1"] == {"n": "old"}
    out3, _ = plan_presets(device, [look], changed, accept_review=True)
    assert out3["1"]["n"] == "Comet look"


def test_plan_ignores_looks_without_slot_and_bad_ids():
    (look,), _ = import_presets({"1": preset(3)}, LISTS)
    look.pop("preset_id")
    assert plan_presets({}, [look], LISTS) == ({}, [])
    look["preset_id"] = 999
    _, report = plan_presets({}, [look], LISTS)
    assert report[0]["status"] == "unavailable"


@pytest.mark.parametrize("bad", ["", "   ", "x" * 33, "ÆØÅ" * 6, "a\nb"])
def test_names_are_validated(bad):
    with pytest.raises(LookError):
        check_name(bad)


def test_store_keeps_history(tmp_path):
    s = LibraryStore(tmp_path)
    s.put({"name": "A", "segments": []})
    s.put({"name": "B", "segments": []})
    assert set(s.looks()) == {"A", "B"}
    assert len(list((tmp_path / "history").glob("*.json"))) == 1
    assert s.delete("A") and not s.delete("A")


def test_mic_rule():
    assert mic_for({"segments": [{"effect": "Meter"}]}, LISTS) is True
    assert mic_for({"segments": [{"effect": "Comet"}, {"effect": "Meter"}]}, LISTS) is True
    assert mic_for({"segments": [{"effect": "Comet"}]}, LISTS) is False
    assert mic_for({"segments": [{"effect_id": 4}]}, LISTS) is True
    assert mic_for({"segments": [{"effect": "Gone"}]}, LISTS) is False
    assert mic_for({"segments": []}, LISTS) is False
