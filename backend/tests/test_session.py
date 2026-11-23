# SPDX-License-Identifier: EUPL-1.2
from wledstudio.session import Sessions, restore_payload

SNAP = {"on": True, "bri": 90, "transition": 7, "mainseg": 0, "bs": 0, "ps": 3, "pl": -1, "nl": {"on": False},
        "AudioReactive": {"on": False},
        "seg": [{"id": 0, "start": 0, "stop": 40, "len": 40, "lc": 9, "fx": 8, "pal": 3, "sx": 10, "col": [[1, 2, 3, 0]]},
                {"id": 1, "start": 40, "stop": 60, "len": 20, "fx": 0, "bm": 2, "n": "rest"}]}


def test_restore_puts_back_segments_and_deletes_new_ones():
    current = {"seg": [{"id": 0}, {"id": 1}, {"id": 2}, {"id": 5}]}
    body = restore_payload(SNAP, current)
    assert body["seg"] == [
        {"id": 0, "fx": 8, "pal": 3, "start": 0, "stop": 40, "col": [[1, 2, 3, 0]], "sx": 10},  # no len, no lc
        {"id": 1, "fx": 0, "start": 40, "stop": 60, "n": "rest", "bm": 2},
        {"id": 2, "stop": 0}, {"id": 5, "stop": 0},
    ]
    assert {k: body[k] for k in ("on", "bri", "transition", "mainseg", "bs")} == {
        "on": True, "bri": 90, "transition": 7, "mainseg": 0, "bs": 0}
    assert body["AudioReactive"] == {"enabled": False}
    assert "nl" not in body and "ps" not in body


def test_a_running_playlist_is_started_again():
    assert restore_payload({**SNAP, "pl": 12}, {"seg": []}) == {"ps": 12}


def test_one_session_per_device():
    s = Sessions()
    assert s.get("d") is None
    started = s.start("d", SNAP)
    assert s.get("d") is started and s.get("other") is None
    assert s.end("d") is started and s.get("d") is None and s.end("d") is None
