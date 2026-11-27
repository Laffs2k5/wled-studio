# SPDX-License-Identifier: EUPL-1.2
"""Undoing deletion of room models and slot grids."""
from conftest import CSRF


ROOM = {"edges": [{"direction": "right", "pixels": 20, "label": "A"}]}
GRID = {"rows": 2, "cols": 2, "first": 40, "row_step": 5,
        "name": "G{row}-{col} {name}"}


def create_grid(client, name="Remote A", first=40):
    return client.post("/api/slots/grids", headers=CSRF,
                       json={"name": name, "grid": {**GRID, "first": first}}).json()


def test_deleted_room_can_be_restored_and_then_leaves_the_list(client, dev_id):
    assert client.put(f"/api/devices/{dev_id}/room", json=ROOM, headers=CSRF).status_code == 200
    assert client.delete(f"/api/devices/{dev_id}/room", headers=CSRF).status_code == 204
    assert client.get(f"/api/devices/{dev_id}/room").json() is None

    rows = client.get("/api/deleted").json()
    assert len(rows) == 1
    assert rows[0]["kind"] == "room" and rows[0]["label"] == "Desk strip room model"
    record = client.app.state.settings.data_dir / "deleted" / f"{rows[0]['id']}.json"
    assert record.exists()

    restored = client.post(f"/api/deleted/{rows[0]['id']}/restore", headers=CSRF)
    assert restored.status_code == 200
    assert restored.json()["content"] == ROOM
    assert client.get(f"/api/devices/{dev_id}/room").json() == ROOM
    assert client.get("/api/deleted").json() == []
    assert not record.exists()


def test_room_restore_refuses_a_missing_device_or_an_existing_room(client, dev_id):
    client.put(f"/api/devices/{dev_id}/room", json=ROOM, headers=CSRF)
    client.delete(f"/api/devices/{dev_id}/room", headers=CSRF)
    row = client.get("/api/deleted").json()[0]

    newer = {"edges": [{"direction": "down", "pixels": 10}]}
    client.put(f"/api/devices/{dev_id}/room", json=newer, headers=CSRF)
    conflict = client.post(f"/api/deleted/{row['id']}/restore", headers=CSRF)
    assert conflict.status_code == 409 and "replace" in conflict.json()["detail"]
    assert client.get(f"/api/devices/{dev_id}/room").json() == newer

    replaced = client.post(f"/api/deleted/{row['id']}/restore",
                           json={"replace": True}, headers=CSRF)
    assert replaced.status_code == 200
    assert client.get(f"/api/devices/{dev_id}/room").json() == ROOM

    client.delete(f"/api/devices/{dev_id}/room", headers=CSRF)
    row = client.get("/api/deleted").json()[0]
    assert client.delete(f"/api/devices/{dev_id}", headers=CSRF).status_code == 204
    missing = client.post(f"/api/deleted/{row['id']}/restore", headers=CSRF)
    assert missing.status_code == 409 and "no longer exists" in missing.json()["detail"]


def test_grid_restore_keeps_assignments_and_resolves_name_and_id_collisions(client):
    grid = create_grid(client)
    client.app.state.library.put({"name": "Calm", "preset_id": 40,
                                  "segments": [{"start": 0, "stop": 10}]})
    client.put("/api/slots/41?grid=" + grid["id"],
               json={"look": "Calm", "mode": "also"}, headers=CSRF)
    assert client.delete(f"/api/slots/grids/{grid['id']}", headers=CSRF).status_code == 200
    row = client.get("/api/deleted").json()[0]
    assert row["kind"] == "grid" and row["label"] == "Remote A"

    replacement = create_grid(client, first=101)
    assert replacement["id"] == grid["id"]
    restored = client.post(f"/api/deleted/{row['id']}/restore", headers=CSRF)
    assert restored.status_code == 200
    assert restored.json()["label"] == "Remote A (restored)"
    assert restored.json()["id"] != replacement["id"]
    grids = client.get("/api/slots/grids").json()["grids"]
    old = next(g for g in grids if g["id"] == restored.json()["id"])
    assert old["grid"] == {**GRID, "col_step": 1}
    assert old["cells"][1]["name"] == "Calm"
    assert client.get("/api/deleted").json() == []


def test_grid_restore_refuses_overlapping_preset_ids_and_names_them(client):
    grid = create_grid(client)
    client.delete(f"/api/slots/grid", headers=CSRF)
    row = client.get("/api/deleted").json()[0]
    create_grid(client, name="Another remote")

    refused = client.post(f"/api/deleted/{row['id']}/restore", headers=CSRF)
    assert refused.status_code == 409
    assert "Another remote (40, 41, 45, 46)" in refused.json()["detail"]
    assert client.get("/api/deleted").json() == [row]
    assert len(client.get("/api/slots/grids").json()["grids"]) == 1


def test_only_the_newest_fifty_deleted_items_are_kept(client, dev_id):
    kept_ids = []
    for n in range(55):
        client.put(f"/api/devices/{dev_id}/room", json={
            "edges": [{"direction": "right", "pixels": n + 1}]
        }, headers=CSRF)
        client.delete(f"/api/devices/{dev_id}/room", headers=CSRF)
        kept_ids.append(client.get("/api/deleted").json()[0]["id"])

    rows = client.get("/api/deleted").json()
    assert len(rows) == 50
    assert rows[0]["id"] == kept_ids[-1]
    assert len(list((client.app.state.settings.data_dir / "deleted").glob("*.json"))) == 50


def test_deleting_without_a_saved_room_does_not_add_an_item(client, dev_id):
    assert client.delete(f"/api/devices/{dev_id}/room", headers=CSRF).status_code == 204
    assert client.get("/api/deleted").json() == []
