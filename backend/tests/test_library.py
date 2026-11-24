# SPDX-License-Identifier: EUPL-1.2
import pytest

from wledstudio.library import (DeviceLists, LibraryStore, LookError, accept_snapshot, check_library, check_name,
                                classify, compare_meta, duplicate_ids, duplicates_message, import_presets,
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
    # accepted one by one: only the looks named
    assert plan_presets(device, [look], changed, accept_review=["Comet look"])[0]["1"]["n"] == "Comet look"
    assert plan_presets(device, [look], changed, accept_review=["Another"])[0]["1"] == {"n": "old"}


def test_duplicate_preset_ids():
    looks = [{"name": "A", "preset_id": 4}, {"name": "B", "preset_id": 4}, {"name": "C", "preset_id": 5},
             {"name": "D"}]
    pls = [{"name": "P", "preset_id": 5}, {"name": "Q", "preset_id": 6}]
    dups = duplicate_ids(looks, pls)
    assert dups == [{"preset_id": 4, "looks": ["A", "B"], "playlists": []},
                    {"preset_id": 5, "looks": ["C"], "playlists": ["P"]}]
    assert "preset 4: “A” and “B”; preset 5: “C” and playlist “P”" in duplicates_message(dups)
    assert duplicate_ids(looks[2:], pls[1:]) == []


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


def test_a_look_that_owns_the_layout_deletes_other_segments():
    lists = DeviceLists(LISTS.effects, LISTS.fxdata, LISTS.palettes, max_segments=4)
    look = {"name": "L", "clear_other_segments": True,
            "segments": [{"start": 0, "stop": 30, "effect": "Glow"}, {"start": 30, "stop": 60, "effect": "Comet"}]}
    segs = resolve_look(look, lists).preset["seg"]
    assert [s.get("fx") for s in segs[:2]] == [1, 3]
    assert segs[2:] == [{"stop": 0}, {"stop": 0}]  # by position, as WLED pads its own presets


@pytest.mark.parametrize("change", [
    {"clear_other_segments": False},                                   # the look doesn't own the layout
    {"segments": [{"effect": "Glow"}]},                                # no bounds: applies to the current layout
])
def test_no_padding_unless_the_look_owns_bounded_segments(change):
    lists = DeviceLists(LISTS.effects, LISTS.fxdata, LISTS.palettes, max_segments=4)
    look = {"name": "L", "clear_other_segments": True, "segments": [{"start": 0, "stop": 60, "effect": "Glow"}]}
    look.update(change)
    assert len(resolve_look(look, lists).preset["seg"]) == 1


def test_no_padding_when_the_segment_limit_is_unknown():
    look = {"name": "L", "clear_other_segments": True, "segments": [{"start": 0, "stop": 60, "effect": "Glow"}]}
    assert len(resolve_look(look, LISTS).preset["seg"]) == 1


def test_padded_presets_survive_an_import_round_trip():
    lists = DeviceLists(LISTS.effects, LISTS.fxdata, LISTS.palettes, max_segments=4)
    padded = preset(3, 1)
    padded["seg"] += [{"stop": 0}] * 3
    plain = preset(1)
    device = {"0": {}, "1": padded, "2": plain}
    looks, _ = import_presets(device, lists)
    assert [lk.get("clear_other_segments") for lk in looks] == [True, None]
    out, _ = plan_presets(device, looks, lists)
    assert out == device  # unchanged: the padding is kept where it was, and not added where it wasn't


ROOM = {"edges": [{"direction": "right", "pixels": 20, "label": "A"}, {"direction": "down", "pixels": 10},
                  {"direction": "left", "pixels": 30, "label": "L2"}, {"direction": "up", "pixels": 5, "label": "A"}]}


def test_wall_ranges_are_the_labelled_edges():
    from wledstudio.library import wall_ranges
    assert wall_ranges(ROOM) == {"A": (0, 20), "L2": (30, 60)}  # the first "A" wins
    assert wall_ranges(None) == {}


def test_segments_covering_one_wall_are_named_by_it():
    from wledstudio.library import tag_walls
    look = {"segments": [{"start": 30, "stop": 60}, {"start": 0, "stop": 25}, {"start": 0, "stop": 20, "wall": "X"}]}
    tag_walls(look, ROOM)
    assert [s.get("wall") for s in look["segments"]] == ["L2", None, "A"]


def test_a_look_follows_its_wall_when_the_room_model_changes():
    look = {"name": "L", "segments": [{"start": 30, "stop": 60, "wall": "L2", "effect": "Glow"}]}
    assert resolve_look(look, LISTS, room=ROOM).notes == []
    moved = {"edges": [{"direction": "right", "pixels": 21, "label": "A"}, {"direction": "down", "pixels": 10},
                       {"direction": "left", "pixels": 29, "label": "L2"}]}
    r = resolve_look(look, LISTS, room=moved)
    assert (r.preset["seg"][0]["start"], r.preset["seg"][0]["stop"]) == (31, 60)
    assert r.status == "ok" and r.notes == ["segment 0 follows wall 'L2' to LEDs 31-59"]


def test_a_look_on_a_wall_the_room_no_longer_has_is_unavailable():
    look = {"name": "L", "segments": [{"start": 30, "stop": 60, "wall": "TV", "effect": "Glow"}]}
    r = resolve_look(look, LISTS, room=ROOM)
    assert r.preset is None and r.status == "unavailable"


def test_without_a_room_model_the_saved_leds_are_used():
    look = {"name": "L", "segments": [{"start": 30, "stop": 60, "wall": "L2", "effect": "Glow"}]}
    seg = resolve_look(look, LISTS).preset["seg"][0]
    assert (seg["start"], seg["stop"]) == (30, 60) and "wall" not in seg


@pytest.mark.parametrize("old,new,seg,reasons", [
    ("!,Tail;!;!;1", "!;!;!;1", {"ix": 1}, ["Tail (ix) is gone"]),
    ("!,Tail;!;!;1", "!;!;!;1", {"sx": 1}, ["Tail (ix) is gone, not set by this look"]),
    ("!,Tail;!;!;1", "!,Length;!;!;1", {}, ["ix relabelled: Tail -> Length"]),
    ("!;!;!;1", "!,Fade;!;!;1", {}, ["new control Fade (ix)"]),
    ("!;!;!;1", "!;!;!;1v", {}, ["now sound-reactive"]),
    ("!;!;!;1v", "!;!;!;1", {}, ["no longer sound-reactive"]),
    ("!;!;!;1", "!;!;!;2", {}, ["dimensions changed: 1D -> 2D"]),
    ("!;!,!;!;1", "!;!;!;1", {}, ["colour slots: 2 -> 1"]),
    ("!;!;!;1", "!;!;;1", {"palette": "x"}, ["no longer uses a palette"]),
    ("!;!;!;1;sx=10", "!;!;!;1;sx=20", {}, ["metadata text changed (defaults or labels)"]),
])
def test_the_change_check_says_what_changed(old, new, seg, reasons):
    assert compare_meta(old, new, seg)[1] == reasons


def test_review_notes_name_the_change():
    (look,), _ = import_presets({"1": preset(3)}, LISTS)
    changed = DeviceLists(LISTS.effects, ["", "", "", "!;!;!;1", ""], LISTS.palettes)
    r = resolve_look(look, changed, look["imported_ids"])
    assert r.status == "review" and r.notes == ["'Comet' changed: Tail (ix) is gone"]


def test_accepting_takes_a_new_snapshot():
    (look,), _ = import_presets({"1": preset(3)}, LISTS)
    moved = DeviceLists(["Solid", "Comet", "Glow"], ["", "!;!;!;1", ""], LISTS.palettes)
    assert resolve_look(look, moved, look["imported_ids"]).status == "review"
    accept_snapshot(look, moved)
    assert look["snapshot"] == {"Comet": "!;!;!;1"} and look["imported_ids"] == {"Comet": 1}
    assert resolve_look(look, moved, look["imported_ids"]).status == "ok"


def test_playlists_take_the_worst_status_of_their_looks():
    (a,), _ = import_presets({"1": preset(3)}, LISTS)
    a["name"] = "A"
    b = {"name": "B", "segments": [{"start": 0, "stop": 60, "effect": "Glow"}]}
    changed = DeviceLists(LISTS.effects, ["", "!,!;!;!;1", "", "!;!;!;1", ""], LISTS.palettes)
    pls = [{"name": "P", "entries": [{"look": "A"}, {"look": "B"}]},
           {"name": "Q", "entries": [{"look": "B"}], "end": "Gone"}]
    rows = {r.get("look") or "pl:" + r["playlist"]: r for r in check_library([a, b], pls, changed)}
    assert rows["A"]["status"] == "review" and rows["B"]["status"] == "ok"
    assert rows["pl:P"]["status"] == "review" and rows["pl:P"]["notes"] == ["'A' is review"]
    assert rows["pl:Q"]["status"] == "unavailable" and rows["pl:Q"]["notes"] == ["look 'Gone' isn't in the library"]


def test_presets_saved_by_wled_survive_an_import_round_trip():
    # shaped like WLED 16's own preset save: "bs" at the top, every segment field, padding
    wled_saved = {"n": "Saved in WLED", "on": True, "bri": 128, "transition": 7, "bs": 0, "mainseg": 0, "ql": "W",
                  "seg": [{"id": 0, "start": 0, "stop": 60, "grp": 1, "spc": 0, "of": 0, "on": True, "frz": False,
                           "bri": 255, "cct": 127, "set": 0, "lc": 9, "n": "", "col": [[255, 160, 0, 0], [0, 0, 0, 0],
                           [0, 0, 0, 0]], "fx": 3, "sx": 128, "ix": 128, "pal": 1, "c1": 128, "c2": 128, "c3": 16,
                           "sel": True, "rev": False, "mi": False, "o1": False, "o2": False, "o3": False, "si": 0,
                           "m12": 0, "bm": 0}] + [{"stop": 0}] * 3}
    no_ids = {"n": "Written by a script", "on": True, "bri": 200, "seg": [{"fx": 1, "sx": 50, "pal": 2}]}
    lists = DeviceLists(LISTS.effects, LISTS.fxdata, LISTS.palettes, max_segments=4)
    device = {"0": {}, "1": wled_saved, "2": no_ids}
    looks, _ = import_presets(device, lists)
    out, _ = plan_presets(device, looks, lists)
    assert out == device


def test_only_preset_fields_reach_a_preset():
    look = {"name": "L", "rb": True, "nl": {"on": True}, "bs": 2,
            "segments": [{"start": 0, "stop": 60, "effect": "Glow", "rb": True, "pin": "1", "cct": 10}]}
    p = resolve_look(look, LISTS).preset
    assert p == {"n": "L", "bs": 2, "seg": [{"start": 0, "stop": 60, "fx": 1, "cct": 10}]}


ZONED = {"edges": [{"direction": "right", "pixels": 40, "label": "A"}, {"direction": "down", "pixels": 60, "label": "L"}],
         "zones": [{"label": "Door", "start": 50, "stop": 62}, {"label": "Whole A", "start": 0, "stop": 40}]}


def test_segments_on_a_zone_are_named_by_it_walls_first():
    from wledstudio.library import tag_areas
    look = {"segments": [{"start": 50, "stop": 62}, {"start": 0, "stop": 40}, {"start": 1, "stop": 2, "zone": "x"}]}
    tag_areas(look, ZONED)
    assert [(s.get("wall"), s.get("zone")) for s in look["segments"]] == [(None, "Door"), ("A", None), (None, None)]


def test_a_look_follows_its_zone_or_is_unavailable_without_it():
    look = {"name": "L", "segments": [{"start": 50, "stop": 62, "zone": "Door", "effect": "Glow"}]}
    moved = {**ZONED, "zones": [{"label": "Door", "start": 52, "stop": 63}]}
    r = resolve_look(look, LISTS, room=moved)
    assert (r.preset["seg"][0]["start"], r.preset["seg"][0]["stop"]) == (52, 63)
    assert r.notes == ["segment 0 follows zone 'Door' to LEDs 52-62"]
    gone = {**ZONED, "zones": []}
    assert resolve_look(look, LISTS, room=gone).status == "unavailable"
