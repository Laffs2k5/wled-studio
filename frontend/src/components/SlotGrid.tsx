// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, slots as slotsApi, type SlotCell, type SlotGridShape, type Slots } from "../api";
import { WriteBar } from "./WriteBar";

const DEFAULT: SlotGridShape = { rows: 3, cols: 4, first: 101, row_step: 10, col_step: 1, name: "R{row}·{col} {name}" };

const idOf = (g: SlotGridShape, row: number, col: number) => g.first + (row - 1) * g.row_step + (col - 1) * g.col_step;

/** Preset ids as a grid (a remote's banks, say): which look sits in each slot, and filling slots
 * from the library. Writing to a device is the usual write. */
export function SlotGrid({ notify, deviceId = null, deviceName }: {
  notify: (msg: string, error?: boolean) => void;
  /** The header's device: the write bar compares its presets with the library. */
  deviceId?: string | null;
  deviceName?: string;
}) {
  const [data, setData] = useState<Slots | null>(null);
  const [looks, setLooks] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<string[]>([]);
  const [editing, setEditing] = useState<SlotGridShape | null>(null);
  const [picked, setPicked] = useState<SlotCell | null>(null);
  const [source, setSource] = useState("");
  const [version, setVersion] = useState(0);   // bumped after every change: the write bar checks again

  const load = useCallback(() => Promise.all([slotsApi.get(), api.looks(), api.playlists()]).then(([s, l, p]) => {
    setData(s);
    setLooks(l.map((x) => x.name).sort());
    setPlaylists(p.map((x) => x.name).sort());
    if (!s.grid) setEditing((e) => e ?? DEFAULT);
  }).catch((e) => notify((e as Error).message, true)), [notify]);
  useEffect(() => { load(); }, [load]);

  const done = (s: Slots, msg: string) => {
    setData(s);
    setVersion((v) => v + 1);
    setPicked((p) => (p ? s.cells.find((c) => c.preset_id === p.preset_id) ?? null : null));
    notify(msg + (s.freed?.length ? ` (${s.freed.join(", ")} left the slot, kept in the library)` : ""));
    api.looks().then((l) => setLooks(l.map((x) => x.name).sort())).catch(() => {});
    api.playlists().then((p) => setPlaylists(p.map((x) => x.name).sort())).catch(() => {});
  };
  const fail = (e: unknown) => notify((e as Error).message, true);

  if (!data) return null;
  const bar = deviceId && <WriteBar key={deviceId} deviceId={deviceId} deviceName={deviceName ?? deviceId} notify={notify} version={version} />;
  if (editing) {
    const g = editing;
    const set = (k: keyof SlotGridShape) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setEditing({ ...g, [k]: k === "name" ? e.target.value : Number(e.target.value) });
    const last = idOf(g, g.rows, g.cols);
    return (
      <section className="slots">
        <h2>Slot grid</h2>
        <p className="muted small">
          A block of preset ids shown as rows and columns, for setups that give ids a meaning (a remote's banks of
          looks, say). Row r, column c is preset first + (r − 1) × row step + (c − 1) × column step.
        </p>
        <div className="grid-form">
          <label>Rows <input type="number" min={1} max={20} value={g.rows} onChange={set("rows")} /></label>
          <label>Columns <input type="number" min={1} max={20} value={g.cols} onChange={set("cols")} /></label>
          <label>First preset id <input type="number" min={1} max={250} value={g.first} onChange={set("first")} /></label>
          <label>Row step <input type="number" min={1} max={100} value={g.row_step} onChange={set("row_step")} /></label>
          <label>Column step <input type="number" min={1} max={100} value={g.col_step} onChange={set("col_step")} /></label>
          <label>Name pattern <input value={g.name} onChange={set("name")} aria-label="Name pattern" /></label>
        </div>
        <p className="small">
          Presets {g.first}–{last}{last > 250 ? " (past 250: too many)" : ""}; a look in row 2, column 3 is named “
          {g.name.replace("{row}", "2").replace("{col}", "3").replace("{name}", "Fire")}”.
        </p>
        <div className="row">
          <button className="primary" onClick={() => slotsApi.setGrid(g).then((s) => { setEditing(null); done(s, "Slot grid saved (in the app)"); }).catch(fail)}>
            Save the grid
          </button>
          {data.grid && <button onClick={() => setEditing(null)}>Cancel</button>}
        </div>
      </section>
    );
  }

  const g = data.grid!;
  const at = (r: number, c: number): SlotCell => data.cells.find((x) => x.row === r && x.col === c)
    ?? { row: r, col: c, preset_id: idOf(g, r, c), kind: null, name: null, base: null, notes: [] };
  const rows = Array.from({ length: g.rows }, (_, i) => i + 1), cols = Array.from({ length: g.cols }, (_, i) => i + 1);
  return (<>
    <section className="slots">
      <h2>Slot grid</h2>
      <p className="muted small">
        Presets {g.first}–{idOf(g, g.rows, g.cols)}. Pick a slot, then a look or playlist to copy into it; it takes the
        slot's preset id and name. The bar at the bottom says when the device is out of date, and writes to it.
      </p>
      <table className="slot-grid" aria-label="Slot grid">
        <thead><tr><th />{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th>{r}</th>
              {cols.map((c) => {
                const cell = at(r, c);
                return (
                  <td key={c}>
                    <button className={`slot ${cell.name ? "filled" : "empty"} ${picked?.preset_id === cell.preset_id ? "picked" : ""}`}
                      aria-label={`Slot ${r}·${c}, preset ${cell.preset_id}: ${cell.name ?? "empty"}`} onClick={() => setPicked(cell)}>
                      <span className="slot-name">{cell.kind === "playlist" ? "▶ " : ""}{cell.base ?? "—"}</span>
                      <span className="slot-id">{cell.preset_id}{cell.notes.length ? " ⚠" : ""}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {picked && (
        <div className="slot-edit">
          <h3>Slot {picked.row}·{picked.col}, preset {picked.preset_id}: {picked.name ?? "empty"}</h3>
          {picked.notes.map((n) => <p key={n} className="warn small">⚠ {n}</p>)}
          <div className="row">
            <select aria-label="Look or playlist to put here" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Copy a look or playlist here…</option>
              <optgroup label="Looks">{looks.map((n) => <option key={`l:${n}`} value={`l:${n}`}>{n}</option>)}</optgroup>
              <optgroup label="Playlists">{playlists.map((n) => <option key={`p:${n}`} value={`p:${n}`}>{n}</option>)}</optgroup>
            </select>
            <button className="primary" disabled={!source} onClick={() => {
              const name = source.slice(2);
              slotsApi.fill(picked.preset_id, source.startsWith("l:") ? { look: name } : { playlist: name })
                .then((s) => { setSource(""); done(s, `Put “${s.filled}” in slot ${picked.row}·${picked.col} (in the library; write presets to put it on the device)`); }).catch(fail);
            }}>Put here</button>
            {picked.name && <button onClick={() => slotsApi.clear(picked.preset_id).then((s) => done(s, "Slot emptied (in the library)")).catch(fail)}>
              Empty the slot
            </button>}
          </div>
        </div>
      )}
      <div className="row">
        <button onClick={() => setEditing(g)}>Change the grid</button>
        <button className="danger" onClick={() => slotsApi.removeGrid().then((s) => { setPicked(null); setData(s); setEditing(DEFAULT); })
          .catch(fail)}>Remove the grid</button>
        <span className="muted small">Removing the grid changes no look; it only hides this view's shape.</span>
      </div>
    </section>
    {bar}
  </>);
}
