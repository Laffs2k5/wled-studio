// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, slots as slotsApi, type SlotCell, type SlotGridShape, type Slots } from "../api";
import { WriteBar } from "./WriteBar";

const DEFAULT: SlotGridShape = { rows: 3, cols: 4, first: 101, row_step: 10, col_step: 1, name: "R{row}·{col} {name}" };

const idOf = (g: SlotGridShape, row: number, col: number) => g.first + (row - 1) * g.row_step + (col - 1) * g.col_step;

/** The setup's fields: their limits (the backend's) and their names in the reasons. */
const LIMITS: [keyof SlotGridShape, number, number, string][] = [
  ["rows", 1, 20, "Banks"], ["cols", 1, 20, "Buttons per bank"], ["first", 1, 250, "The first preset id"],
  ["row_step", 1, 100, "The step between banks"], ["col_step", 1, 100, "The step between buttons"],
];

/** Why a grid can't be saved, in words; null when it can. */
export function gridProblem(g: SlotGridShape): string | null {
  for (const [k, lo, hi, label] of LIMITS) {
    const v = g[k] as number;
    if (!Number.isInteger(v) || v < lo || v > hi) return `${label} must be a whole number from ${lo} to ${hi}.`;
  }
  const last = idOf(g, g.rows, g.cols);
  if (last > 250) return `The last button would be preset ${last}, but WLED's presets end at 250. Use fewer banks or buttons, or smaller steps.`;
  const ids = new Set<number>();
  for (let r = 1; r <= g.rows; r++) for (let c = 1; c <= g.cols; c++) {
    const id = idOf(g, r, c);
    if (ids.has(id)) return `Two buttons would share preset ${id}: make each next bank start at least ${g.cols * g.col_step} ids later.`;
    ids.add(id);
  }
  if (!g.name.includes("{name}") || /\{(?!row\}|col\}|name\})/.test(g.name)) {
    return "The name pattern (under Advanced) must contain {name}, and may use {row} and {col}.";
  }
  if (g.name.length < 6 || g.name.length > 40) return "The name pattern (under Advanced) must be 6 to 40 characters.";
  return null;
}

const MINI_ROWS = 6;

/** The grid's preset ids as a small table, while setting it up: what each bank's buttons will be. */
function Miniature({ g }: { g: SlotGridShape }) {
  if (!LIMITS.every(([k, lo, hi]) => Number.isInteger(g[k]) && (g[k] as number) >= lo && (g[k] as number) <= hi)) return null;
  const rows = Array.from({ length: Math.min(g.rows, MINI_ROWS) }, (_, i) => i + 1);
  const cols = Array.from({ length: g.cols }, (_, i) => i + 1);
  return (
    <table className="grid-mini" aria-label="Preset ids of the grid">
      <thead><tr><th />{cols.map((c) => <th key={c} scope="col">Button {c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <th scope="row">Bank {r}</th>
            {cols.map((c) => { const id = idOf(g, r, c); return <td key={c} className={id > 250 ? "warn" : undefined}>{id}</td>; })}
          </tr>
        ))}
        {g.rows > MINI_ROWS && (
          <tr><th scope="row">…</th><td colSpan={g.cols} className="muted">
            {g.rows - MINI_ROWS} more {g.rows - MINI_ROWS === 1 ? "bank" : "banks"}, up to Bank {g.rows}: {idOf(g, g.rows, 1)}–{idOf(g, g.rows, g.cols)}
          </td></tr>
        )}
      </tbody>
    </table>
  );
}

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
      setEditing({ ...g, [k]: k === "name" ? e.target.value : e.target.value === "" ? NaN : Number(e.target.value) });
    const num = (k: keyof SlotGridShape) => (Number.isNaN(g[k]) ? "" : g[k]);
    const problem = gridProblem(g);
    return (
      <section className="slots">
        <h2>Slot grid</h2>
        <p className="muted small">
          A block of preset ids laid out as banks and buttons, for setups that give ids a meaning: a remote whose
          bank 1 plays presets 101–104, say. Set where the ids start and how they step; the table below shows the
          result.
        </p>
        <div className="grid-form">
          <label>Banks (rows) <input type="number" min={1} max={20} value={num("rows")} onChange={set("rows")} /></label>
          <label>Buttons per bank (columns) <input type="number" min={1} max={20} value={num("cols")} onChange={set("cols")} /></label>
          <label>Preset id of bank 1, button 1 <input type="number" min={1} max={250} value={num("first")} onChange={set("first")} /></label>
        </div>
        <div className="grid-form steps">
          <label className="inline">
            <span>Each next bank starts</span>
            <input type="number" min={1} max={100} value={num("row_step")} onChange={set("row_step")}
              aria-label="Each next bank starts N ids later" />
            <span>ids later</span>
          </label>
          <label className="inline">
            <span>Each next button is</span>
            <input type="number" min={1} max={100} value={num("col_step")} onChange={set("col_step")}
              aria-label="Each next button is N ids later" />
            <span>ids later</span>
          </label>
        </div>
        <Miniature g={g} />
        <details className="small grid-advanced">
          <summary>Advanced: how looks in the grid are named</summary>
          <p className="muted">
            A look copied into a slot gets this name. {"{row}"} is the bank, {"{col}"} the button and {"{name}"} the
            look's own name.
          </p>
          <label>Name pattern <input value={g.name} onChange={set("name")} aria-label="Name pattern" /></label>
          <p>A look “Fire” in bank 2, button 3 is named “{g.name.replace("{row}", "2").replace("{col}", "3").replace("{name}", "Fire")}”.</p>
        </details>
        {problem && <p className="warn small" role="alert">{problem}</p>}
        <div className="row">
          <button className="primary" disabled={problem !== null}
            onClick={() => slotsApi.setGrid(g).then((s) => { setEditing(null); done(s, "Slot grid saved (in the app)"); }).catch(fail)}>
            Save the grid
          </button>
          {data.grid && <button onClick={() => setEditing(null)}>Cancel</button>}
          <span className="muted small">Saving changes only this view's shape: no look and nothing on the device.</span>
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
