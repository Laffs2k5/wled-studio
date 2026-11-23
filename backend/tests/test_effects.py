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
    assert c.get("/api/effects").json() == [{"folder": "my_wave", "files": ["extra.h", "library.json", "my_wave.cpp"]}]


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
