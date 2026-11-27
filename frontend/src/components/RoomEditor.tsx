// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useRef, useState } from "react";
import { deleted, request, type DeletedItem } from "../api";
import { gapText, totalPixels, type Direction, type Room, type RoomEdge, type RoomZone } from "../room";
import { drawMap, ledPositions } from "../room";
import { RecentlyDeleted } from "./RecentlyDeleted";

/** The strip's shape: edges in LED index order. Used to draw the live view and previews. Lives in
 * the device settings; `onSaved` is called after a save (not when the shape is first read). */
export function RoomEditor({ deviceId, ledCount, onSaved, notify, defaultOpen = false }: {
  deviceId: string;
  /** The device's LED count, if known (unknown while it doesn't answer). */
  ledCount?: number;
  onSaved: (room: Room | null) => void;
  notify: (msg: string, error?: boolean) => void;
  defaultOpen?: boolean;
}) {
  const [edges, setEdges] = useState<RoomEdge[]>([]);
  const [zones, setZones] = useState<RoomZone[]>([]);
  const [baseline, setBaseline] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [deletedVersion, setDeletedVersion] = useState(0);
  const [removed, setRemoved] = useState<{ id: string | null; text: string } | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const load = useCallback(() => {
    request<Room | null>("GET", `/api/devices/${encodeURIComponent(deviceId)}/room`)
      .then((r) => {
        const nextEdges = r?.edges ?? [], nextZones = r?.zones ?? [];
        setEdges(nextEdges); setZones(nextZones);
        setBaseline(JSON.stringify({ edges: nextEdges, zones: nextZones }));
      })
      .catch(() => { setEdges([]); setZones([]); });
  }, [deviceId]);
  useEffect(load, [load]);
  const total = totalPixels({ edges });
  const dirty = baseline !== JSON.stringify({ edges, zones });
  useEffect(() => {
    const canvas = preview.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !edges.length) return;
    const count = Math.max(1, total);
    drawMap(ctx, canvas.width, canvas.height, ledPositions(count, canvas.width, canvas.height, { edges, zones }),
      [], null, null, false);
  }, [edges, zones, total]);
  const set = (i: number, e: Partial<RoomEdge>) => setEdges(edges.map((x, j) => (j === i ? { ...x, ...e } : x)));
  const setZone = (i: number, z: Partial<RoomZone>) => setZones(zones.map((x, j) => (j === i ? { ...x, ...z } : x)));
  const undoRemove = () => {
    if (!removed?.id) return;
    const id = removed.id;
    deleted.restore(id).then(() => {
      setRemoved({ id: null, text: "Room model restored." });
      setDeletedVersion((n) => n + 1);
      load();
      onSaved(null);
    }).catch((e) => setRemoved({ id, text: e.message }));
  };

  return (
    <details className="room-editor" open={defaultOpen || undefined}>
      <summary>Room shape {edges.length ? `(${edges.length} walls)` : "(not set)"}</summary>
      <p className="muted small">Which LEDs are on which wall. The live view and the segment map draw it, looks can follow
        its walls, and room-aware effects take each LED's position from it.</p>
      <p className="muted small">Follow the strip from its first LED. Add one row per straight run.</p>
      <RecentlyDeleted refresh={deletedVersion} notify={notify} onRestored={(item) => {
        if (item.kind === "room" && item.device_id === deviceId) { load(); onSaved(null); }
      }} />
      {removed && (
        <p className="action-result done" role="status">
          {removed.text}{" "}
          {removed.id && <button className="small" onClick={undoRemove}>Undo</button>}
        </p>
      )}
      {edges.length > 0 && (
        <canvas ref={preview} width={960} height={300} className="room room-preview" aria-label="Room shape preview" />
      )}
      <div className="row small muted room-columns"><span>Wall name</span><span>Strip runs</span><span>LEDs</span></div>
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
      <p className="muted small">Zones: named LED ranges such as a door or a desk.
        Segments on a zone follow it when you correct it here.</p>
      <div className="row small muted room-columns"><span>Zone name</span><span>First LED</span><span>Last LED</span></div>
      {zones.map((z, i) => (
        <div className="row" key={`z${i}`}>
          <input value={z.label} placeholder={`Zone ${i + 1}`} maxLength={32} aria-label={`Zone ${i + 1} name`}
            onChange={(ev) => setZone(i, { label: ev.target.value })} />
          <input value={z.start} inputMode="numeric" className="slot" aria-label={`Zone ${i + 1} start`}
            onChange={(ev) => setZone(i, { start: Math.max(0, Number(ev.target.value) || 0) })} />
          <input value={z.stop - 1} inputMode="numeric" className="slot" aria-label={`Zone ${i + 1} last LED`}
            onChange={(ev) => setZone(i, { stop: Math.max(z.start + 1, Number(ev.target.value) + 1 || z.start + 1) })} />
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
        {ledCount === undefined ? <span className="small muted">{total} LEDs</span>
          : <span className={`small ${total === ledCount ? "muted" : "warn"}`}>{total} of {ledCount} LEDs</span>}
        {edges.length > 1 && gapText({ edges }) && (
          <span className="small warn" title="Fine for a strip along some walls only; round a whole room, opposite walls have the same LED count">
            {gapText({ edges })}: round a whole room, opposite walls need the same count.
          </span>
        )}
        <button className="primary" disabled={!edges.length || !dirty} onClick={() =>
          request<Room>("PUT", `/api/devices/${encodeURIComponent(deviceId)}/room`, zones.length ? { edges, zones } : { edges })
            .then((r) => {
              setBaseline(JSON.stringify({ edges: r.edges, zones: r.zones ?? [] }));
              onSaved(r); notify("Room shape saved in the app");
            }).catch((e) => notify(e.message, true))}>
          Save room shape (kept in the app)
        </button>
        {dirty && <span className="warn small">Unsaved room shape changes</span>}
        {dirty && !discarding && <button onClick={() => setDiscarding(true)}>Discard changes</button>}
        {discarding && (
          <span className="inline-confirm" role="group" aria-label="Discard room shape changes?">
            The saved room shape stays as it was.
            <button className="danger" onClick={() => {
              const old = JSON.parse(baseline || '{"edges":[],"zones":[]}');
              setEdges(old.edges); setZones(old.zones); setDiscarding(false);
            }}>Discard changes</button>
            <button onClick={() => setDiscarding(false)}>Keep editing</button>
          </span>
        )}
        {!dirty && JSON.parse(baseline || '{"edges":[]}').edges.length > 0 && !removing && (
          <button className="danger" onClick={() => setRemoving(true)}>Remove room model…</button>
        )}
        {removing && (
          <span className="inline-confirm warn" role="group" aria-label="Remove the saved room model?">
            Looks keep their saved LED ranges, but no longer follow this room model.
            <button className="danger" onClick={async () => {
              try {
                await request("DELETE", `/api/devices/${encodeURIComponent(deviceId)}/room`);
                setEdges([]); setZones([]);
                setBaseline(JSON.stringify({ edges: [], zones: [] }));
                setRemoved({ id: null, text: "Room model removed from the app." });
                setDeletedVersion((n) => n + 1);
                setRemoving(false);
                onSaved(null);
                deleted.list().then((rows) => {
                  const item = rows.find((row: DeletedItem) =>
                    row.kind === "room" && row.device_id === deviceId);
                  if (item) setRemoved((current) => current ? { ...current, id: item.id } : current);
                }).catch((e) => notify(e.message, true));
              } catch (e) {
                notify((e as Error).message, true);
              }
            }}>Yes, remove the room model</button>
            <button onClick={() => setRemoving(false)}>Keep the room model</button>
          </span>
        )}
      </div>
    </details>
  );
}
