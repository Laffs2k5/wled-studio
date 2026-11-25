# SPDX-License-Identifier: EUPL-1.2
from fastapi.testclient import TestClient

from conftest import CSRF, private_resolver
from wledstudio.app import create_app
from wledstudio.config import Settings


def client(tmp_path, with_dir=True):
    eff = tmp_path / "effects"
    eff.mkdir()
    s = Settings(data_dir=tmp_path / "d", allowed_hosts=["testserver"], effects_dir=eff if with_dir else None)
    return TestClient(create_app(s, resolver=private_resolver)), eff


def test_disabled(tmp_path):
    c, _ = client(tmp_path, with_dir=False)
    assert c.get("/api/effects").status_code == 503


def test_create_edit_list(tmp_path):
    c, eff = client(tmp_path)
    r = c.post("/api/effects", json={"folder": "my_wave", "title": "My Wave", "effect_id": 250}, headers=CSRF)
    assert r.status_code == 201 and r.json()["files"] == ["library.json", "my_wave.cpp"]
    assert c.post("/api/effects", json={"folder": "my_wave", "title": "X", "effect_id": 250}, headers=CSRF).status_code == 409
    src = c.get("/api/effects/my_wave/my_wave.cpp").json()["content"]
    assert "constexpr uint8_t kId = 250;" in src and "My Wave@!,!;" in src and "REGISTER_USERMOD(my_wave_usermod);" in src
    assert '"name": "wled-my-wave"' in (eff / "my_wave" / "library.json").read_text()
    r = c.put("/api/effects/my_wave/my_wave.cpp", json={"content": src + "\n// changed\n"}, headers=CSRF)
    assert r.status_code == 200
    assert (eff / "my_wave" / "my_wave.cpp").read_text().endswith("// changed\n")
    assert c.put("/api/effects/my_wave/extra.h", json={"content": "#pragma once\n"}, headers=CSRF).status_code == 200
    assert c.get("/api/effects").json() == [{"folder": "my_wave", "files": ["extra.h", "library.json", "my_wave.cpp"],
                                             "effect_ids": [250]}]


def test_existing_folders_follow_the_builders_rule(tmp_path):
    # The builder compiles any usermod named [A-Za-z0-9_-]; the editor must show and edit the same
    # folders, such as a cloned repo with hyphens in its name. New folders stay C identifiers.
    c, eff = client(tmp_path)
    (eff / "wled-studio-effects").mkdir()
    (eff / "wled-studio-effects" / "fx.cpp").write_text("// fx\n")
    (eff / ".git").mkdir()
    assert c.get("/api/effects").json() == [{"folder": "wled-studio-effects", "files": ["fx.cpp"], "effect_ids": []}]
    assert c.get("/api/effects/wled-studio-effects/fx.cpp").json()["content"] == "// fx\n"
    r = c.put("/api/effects/wled-studio-effects/fx.cpp", json={"content": "// changed\n"}, headers=CSRF)
    assert r.status_code == 200 and (eff / "wled-studio-effects" / "fx.cpp").read_text() == "// changed\n"
    for bad in ("my-fx", "My_fx", "_fx"):
        assert c.post("/api/effects", json={"folder": bad, "title": "X", "effect_id": 240}, headers=CSRF).status_code == 422, bad


def test_library_json_is_checked(tmp_path):
    c, _ = client(tmp_path)
    c.post("/api/effects", json={"folder": "fx", "title": "Fx", "effect_id": 240}, headers=CSRF)
    assert c.put("/api/effects/fx/library.json", json={"content": "{nope"}, headers=CSRF).status_code == 422
    assert c.put("/api/effects/fx/library.json", json={"content": '{"name": "fx"}'}, headers=CSRF).status_code == 422
    assert c.put("/api/effects/fx/library.json", json={"content": '{"name": "wled-fx"}'}, headers=CSRF).status_code == 200


def test_paths_are_confined(tmp_path):
    c, eff = client(tmp_path)
    (tmp_path / "secret.cpp").write_text("x")
    c.post("/api/effects", json={"folder": "fx", "title": "Fx", "effect_id": 240}, headers=CSRF)
    for path in ("/api/effects/../secret.cpp", "/api/effects/fx/..%2F..%2Fsecret.cpp", "/api/effects/fx/run.sh",
                 "/api/effects/FX/fx.cpp", "/api/effects/nope/fx.cpp", "/api/effects/fx/.hidden.cpp"):
        assert c.get(path).status_code == 404, path
    assert c.put("/api/effects/fx/evil.sh", json={"content": "rm -rf /"}, headers=CSRF).status_code == 404
    for bad in ({"folder": "../x", "title": "X", "effect_id": 240}, {"folder": "Bad", "title": "X", "effect_id": 240},
                {"folder": "ok_name", "title": "X", "effect_id": 10}, {"folder": "ok_name", "title": "<script>", "effect_id": 240}):
        assert c.post("/api/effects", json=bad, headers=CSRF).status_code == 422
    big = "x" * (256 * 1024 + 1)
    assert c.put("/api/effects/fx/fx.cpp", json={"content": big}, headers=CSRF).status_code in (413, 422)


def test_room_map_header():
    from wledstudio.effects import room_map_header
    h = room_map_header({"edges": [{"direction": "right", "pixels": 2}, {"direction": "down", "pixels": 2}]})
    # LED midpoints in doubled grid units, shifted so the smallest is 0
    assert "kRoomLeds = 4;" in h and "kRoomW = 3;" in h and "kRoomH = 3;" in h
    assert "kRoomX[4] = {0, 2, 3, 3};" in h and "kRoomY[4] = {0, 0, 1, 3};" in h
    empty = room_map_header(None)
    assert "kRoomLeds = 0;" in empty and "kRoomX[1] = {0};" in empty


def test_room_template_and_map(tmp_path):
    c, eff = client(tmp_path)
    r = c.post("/api/effects", json={"folder": "room_wave", "title": "Room Wave", "effect_id": 249, "template": "room"},
               headers=CSRF)
    assert r.json()["files"] == ["library.json", "room_map.h", "room_wave.cpp"]
    src = (eff / "room_wave" / "room_wave.cpp").read_text()
    assert '#include "room_map.h"' in src and "kRoomX[i]" in src
    # no room model yet for this device
    assert c.post("/api/effects/room_wave/room-map", json={"device": "desk"}, headers=CSRF).status_code == 404
    rooms = tmp_path / "d" / "rooms"
    rooms.mkdir(parents=True)
    (rooms / "desk.json").write_text('{"edges": [{"direction": "right", "pixels": 3}]}')
    # the template's empty map: there, but not written from a device
    assert c.get("/api/effects/room_wave/room-map").json() == {"exists": True, "device": None}
    r = c.post("/api/effects/room_wave/room-map", json={"device": "desk"}, headers=CSRF)
    assert r.status_code == 200 and r.json()["leds"] == 3
    assert "kRoomLeds = 3;" in (eff / "room_wave" / "room_map.h").read_text()
    st = c.get("/api/effects/room_wave/room-map").json()
    assert st["device"] == "desk" and st["leds"] == 3 and st["stale"] is False and st["written"]
    assert st["device_name"] is None              # no device by that id in this app
    # the room shape changes (the same shape written differently doesn't count)
    (rooms / "desk.json").write_text('{"edges":[{"pixels": 3, "direction": "right"}]}')
    assert c.get("/api/effects/room_wave/room-map").json()["stale"] is False
    (rooms / "desk.json").write_text('{"edges": [{"direction": "right", "pixels": 4}]}')
    assert c.get("/api/effects/room_wave/room-map").json()["stale"] is True
    assert "desk" not in (eff / "room_wave" / "room_map.h").read_text()   # the record stays in the app's data
    (eff / "room_wave" / "room_map.h").unlink()
    assert c.get("/api/effects/room_wave/room-map").json() == {"exists": False, "device": None}
    assert c.post("/api/effects/room_wave/room-map", json={"device": "../x"}, headers=CSRF).status_code == 422
    assert c.post("/api/effects/nope/room-map", json={"device": "desk"}, headers=CSRF).status_code == 404


def test_the_effect_ids_a_folder_fixes_are_listed(tmp_path):
    c, eff = client(tmp_path)
    (eff / "fx").mkdir()
    (eff / "fx" / "fx.cpp").write_text("constexpr uint8_t kStudioVuId = 240;\nconstexpr uint8_t kSkyId=241;\nint kOtherId = 9;\n")
    (eff / "fx" / "ids.h").write_text("constexpr uint8_t kId = 241;\n")
    (eff / "fx" / "notes.txt").write_text("constexpr uint8_t kId = 7;\n")
    assert c.get("/api/effects").json() == [{"folder": "fx", "files": ["fx.cpp", "ids.h"], "effect_ids": [240, 241]}]
