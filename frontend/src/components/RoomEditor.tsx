// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { request } from "../api";
import { totalPixels, type Direction, type Room, type RoomEdge, type RoomZone } from "../room";

/** The strip's shape: edges in LED index order. Used to draw the live view and previews. */
export function RoomEditor({ deviceId, ledCount, onSaved, notify }: {
  deviceId: string; ledCount: number; onSaved: (room: Room | null) => void; notify: (msg: string, error?: boolean) => void;
}) {
  const [edges, setEdges] = useState<RoomEdge[]>([]);
  const [zones, setZones] = useState<RoomZone[]>([]);
  useEffect(() => {
    request<Room | null>("GET", `/api/devices/${encodeURIComponent(deviceId)}/room`)
      .then((r) => { setEdges(r?.edges ?? []); setZones(r?.zones ?? []); onSaved(r); })
      .catch(() => { setEdges([]); setZones([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);
  const total = totalPixels({ edges });
  const set = (i: number, e: Partial<RoomEdge>) => setEdges(edges.map((x, j) => (j === i ? { ...x, ...e } : x)));
  const setZone = (i: number, z: Partial<RoomZone>) => setZones(zones.map((x, j) => (j === i ? { ...x, ...z } : x)));

  return (
    <details className="room-editor">
      <summary>Room shape {edges.length ? `(${edges.length} walls)` : ""}</summary>
      <p className="muted small">Walls in LED order, from the first LED: a direction and how many LEDs.</p>
      {edges.map((e, i) => (
        <div className="row" key={i}>
          <input value={e.label ?? ""} placeholder={`Wall ${i + 1}`} maxLength={32} aria-label={`Wall ${i + 1} name`}
            onChange={(ev) => set(i, { label: ev.target.value || undefined })} />
          <select value={e.direction} aria-label={`Wall ${i + 1} direction`}
            onChange={(ev) => set(i, { direction: ev.target.value as Direction })}>
            {(["right", "down", "left", "up"] as Direction[]).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input value={e.pixels} inputMode="numeric" className="slot" aria-label={`Wall ${i + 1} LEDs`}
            onChange={(ev) => set(i, { pixels: Math.max(1, Number(ev.target.value) || 1) })} />
          <button aria-label={`Remove wall ${i + 1}`} onClick={() => setEdges(edges.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <p className="muted small">Zones: named LED ranges such as a door or a desk (stop is the LED after the zone).
        Segments on a zone follow it when you correct it here.</p>
      {zones.map((z, i) => (
        <div className="row" key={`z${i}`}>
          <input value={z.label} placeholder={`Zone ${i + 1}`} maxLength={32} aria-label={`Zone ${i + 1} name`}
            onChange={(ev) => setZone(i, { label: ev.target.value })} />
          <input value={z.start} inputMode="numeric" className="slot" aria-label={`Zone ${i + 1} start`}
            onChange={(ev) => setZone(i, { start: Math.max(0, Number(ev.target.value) || 0) })} />
          <input value={z.stop} inputMode="numeric" className="slot" aria-label={`Zone ${i + 1} stop`}
            onChange={(ev) => setZone(i, { stop: Math.max(1, Number(ev.target.value) || 1) })} />
          <button aria-label={`Remove zone ${i + 1}`} onClick={() => setZones(zones.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setZones([...zones, { label: `Zone ${zones.length + 1}`, start: 0, stop: Math.min(10, total || 10) }])}>
          Add zone
        </button>
      </div>
      <div className="row">
        <button onClick={() => setEdges([...edges, { direction: (["right", "down", "left", "up"] as Direction[])[edges.length % 4], pixels: 10 }])}>
          Add wall
        </button>
        <span className={`small ${total === ledCount ? "muted" : "warn"}`}>{total} of {ledCount} LEDs</span>
        <button className="primary" disabled={!edges.length} onClick={() =>
          request<Room>("PUT", `/api/devices/${encodeURIComponent(deviceId)}/room`, zones.length ? { edges, zones } : { edges })
            .then((r) => { onSaved(r); notify("Room shape saved"); }).catch((e) => notify(e.message, true))}>
          Save shape
        </button>
      </div>
    </details>
  );
}
