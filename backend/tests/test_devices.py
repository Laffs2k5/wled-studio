# SPDX-License-Identifier: EUPL-1.2
import os
import stat

import pytest

from wledstudio.devices import DeviceStore


def test_pin_files_are_private(tmp_path):
    s = DeviceStore(tmp_path)
    d = s.add("Desk", "wled.lan")
    s.set_pin(d.id, "1234")
    mode = stat.S_IMODE(os.stat(tmp_path / "secrets" / f"{d.id}.pin").st_mode)
    assert mode == 0o600
    assert stat.S_IMODE(os.stat(tmp_path / "devices.json").st_mode) == 0o600
    assert s.pin(d.id) == "1234"
    assert "1234" not in (tmp_path / "devices.json").read_text()


def test_pin_from_environment(tmp_path, monkeypatch):
    s = DeviceStore(tmp_path)
    d = s.add("Desk strip", "wled.lan")
    monkeypatch.setenv("WLEDSTUDIO_PIN_DESK_STRIP", "9876")
    assert s.pin(d.id) == "9876"


def test_ids_are_unique_and_safe(tmp_path):
    s = DeviceStore(tmp_path)
    a = s.add("Desk", "a.lan")
    b = s.add("Desk", "b.lan")
    assert a.id != b.id
    c = s.add("../../etc", "c.lan")
    assert "/" not in c.id and ".." not in c.id
    with pytest.raises(ValueError):
        s.set_pin("../x", "1")


def test_remove_deletes_pin(tmp_path):
    s = DeviceStore(tmp_path)
    d = s.add("Desk", "a.lan")
    s.set_pin(d.id, "1")
    assert s.remove(d.id)
    assert s.pin(d.id) is None
    assert not s.remove(d.id)


def test_update_keeps_the_id_and_forgets_virtual_on_a_new_address(tmp_path):
    s = DeviceStore(tmp_path)
    d = s.add("Desk", "a.lan")
    s.mark_virtual(d.id, True)
    assert s.update(d.id, name="Desk 2").virtual is True
    u = s.update(d.id, host="b.lan")
    assert (u.id, u.name, u.host, u.virtual) == (d.id, "Desk 2", "b.lan", False)
    assert s.get(d.id).host == "b.lan"
    assert s.update("nope", name="x") is None
