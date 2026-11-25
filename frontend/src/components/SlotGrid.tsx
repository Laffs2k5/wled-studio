// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, slots as slotsApi, type SlotCell, type SlotGridShape, type Slots } from "../api";
import type { PushResult } from "../types";

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

/** A filled slot against the header's device, from the write bar's dry run: is the look that sits
 * there what the device holds at that preset id? null for an empty slot or before the first check. */
export function cellState(cell: SlotCell, plan: PushResult | null): { key: string; text: string; title: string } | null {
  if (!cell.name || !plan) return null;
  const item = plan.report.find((r) => (cell.kind === "playlist" ? r.playlist : r.look) === cell.name
    && r.preset_id === cell.preset_id);
  if (!item) return { key: "absent", text: "not for this device", title: "Not among the looks that go on this device" };
  if ((plan.duplicates ?? []).some((d) => d.preset_id === cell.preset_id)) {
    return { key: "differs", text: "shared id", title: "Another look has this preset id too: nothing is written until each has its own" };
  }
  if (item.status === "unavailable") return { key: "absent", text: "can't show here", title: "Its effect isn't on this device: it is skipped" };
  if (item.status === "review" && !item.written) return { key: "differs", text: "effect changed", title: "Waiting for your decision in the write plan" };
  if (!item.changed) return { key: "same", text: "on device", title: "The device holds this look at this preset id" };
  if (item.on_device == null) return { key: "new", text: "not written", title: "The device has nothing at this preset id yet" };
  return { key: "differs", text: "differs", title: `The device holds another version (“${item.on_device}”) at this preset id` };
}

/** The name a look gets in a slot (the grid's pattern), as the backend makes it: for the panel's words. */
const nameIn = (g: SlotGridShape, cell: SlotCell, base: string) =>
  g.name.replace("{row}", String(cell.row)).replace("{col}", String(cell.col)).replace("{name}", base);

type Item = { kind: "look" | "playlist"; name: string; preset_id?: number };
const itemKey = (i: Item) => `${i.kind === "look" ? "l" : "p"}:${i.name}`;

/** Preset ids as a grid (a remote's banks, say): which look sits in each slot, and filling slots
 * from the library beside it (click a slot, then a look; or drag a look onto a slot). Each slot says
 * whether the header's device has it; writing is the usual write bar. */
export function SlotGrid({ notify, deviceId = null, deviceName, onOpenLook, plan = null, onChanged }: {
  notify: (msg: string, error?: boolean) => void;
  /** The header's device: the write bar compares its presets with the library. */
  deviceId?: string | null;
  deviceName?: string;
  onOpenLook?: (name: string) => void;
  plan?: PushResult | null;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<Slots | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [editing, setEditing] = useState<SlotGridShape | null>(null);
  const [picked, setPicked] = useState<SlotCell | null>(null);
  const [over, setOver] = useState<number | null>(null);   // the slot a look is dragged over
  const [confirmRemove, setConfirmRemove] = useState(false);

  const loadItems = useCallback(() => Promise.all([api.looks(), api.playlists()]).then(([l, p]) => setItems([
    ...l.map((x): Item => ({ kind: "look", name: x.name, preset_id: x.preset_id })).sort((a, b) => a.name.localeCompare(b.name)),
    ...p.map((x): Item => ({ kind: "playlist", name: x.name, preset_id: x.preset_id })).sort((a, b) => a.name.localeCompare(b.name)),
  ])), []);
  const load = useCallback(() => Promise.all([slotsApi.get(), loadItems()]).then(([s]) => {
    setData(s);
    if (!s.grid) setEditing((e) => e ?? DEFAULT);
  }).catch((e) => notify((e as Error).message, true)), [notify, loadItems]);
  useEffect(() => { load(); }, [load]);
  const done = (s: Slots, msg: string) => {
    setData(s);
    onChanged?.();
    setPicked((p) => (p ? s.cells.find((c) => c.preset_id === p.preset_id) ?? null : null));
    notify(msg + (s.freed?.length ? ` (${s.freed.join(", ")} left the slot, kept in the library)` : ""));
    loadItems().catch(() => {});
  };
  const fail = (e: unknown) => notify((e as Error).message, true);
  const fill = (cell: SlotCell, item: Item) =>
    slotsApi.fill(cell.preset_id, item.kind === "look" ? { look: item.name } : { playlist: item.name })
      .then((s) => done(s, `Copied “${item.name}” into slot ${cell.row}·${cell.col} as “${s.filled}” (in the library; write presets to put it on the device)`))
      .catch(fail);
  const show = (cell: SlotCell) => {
    if (!deviceId || !cell.name) return;
    (cell.kind === "playlist" ? api.play(deviceId, cell.name) : api.apply(deviceId, cell.name))
      .then(() => notify(`Showing “${cell.name}” on ${deviceName ?? deviceId} (nothing stored on the device)`))
      .catch(fail);
  };

  if (!data) return null;
  if (editing) {
    const g = editing;
    const set = (k: keyof SlotGridShape) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setEditing({ ...g, [k]: k === "name" ? e.target.value : e.target.value === "" ? NaN : Number(e.target.value) });
    const num = (k: keyof SlotGridShape) => (Number.isNaN(g[k]) ? "" : g[k]);
    const problem = gridProblem(g);
    return (
      <section className="slots">
        <h2>Slot grid</h2>
        {items.length === 0 && (
          <p className="first-run-note">Fill this once you have saved some looks.</p>
        )}
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
  const where = deviceName ?? deviceId;
  const dropped = (cell: SlotCell) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const key = e.dataTransfer.getData("text/plain");
    const item = items.find((i) => itemKey(i) === key);
    if (item) { setPicked(cell); fill(cell, item); }
  };
  const pickedState = picked && cellState(picked, plan);
  const duplicate = picked
    ? (plan?.duplicates ?? []).find((d) => d.preset_id === picked.preset_id)
    : undefined;
  return (<>
    <section className="slots">
      <h2>Slot grid</h2>
      {items.length === 0 && (
        <p className="first-run-note">Fill this once you have saved some looks.</p>
      )}
      <p className="muted small">
        Presets {g.first}–{idOf(g, g.rows, g.cols)}. Click a slot, then a look or playlist in the library beside the
        grid (or drag one onto a slot): a copy of it takes the slot's preset id. The bar at the bottom says when
        the device is out of date, and writes to it.
      </p>
      <div className="slots-layout">
        <div className="slot-grid-box">
          {deviceId && (
            <p className="small slot-legend" aria-label="What the slot states mean">
              Against {where}: <span className="slot-state same">on device</span> · <span className="slot-state differs">differs</span>
              {" · "}<span className="slot-state new">not written</span>{!plan && <span className="muted"> (checking…)</span>}
            </p>
          )}
          <table className="slot-grid" aria-label="Slot grid">
            <thead><tr><th />{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r}>
                  <th>{r}</th>
                  {cols.map((c) => {
                    const cell = at(r, c);
                    const st = cellState(cell, plan);
                    return (
                      <td key={c} onDragOver={(e) => { e.preventDefault(); setOver(cell.preset_id); }}
                        onDragLeave={() => setOver((o) => (o === cell.preset_id ? null : o))} onDrop={dropped(cell)}>
                        <button className={`slot ${cell.name ? "filled" : "empty"} ${picked?.preset_id === cell.preset_id ? "picked" : ""} ${over === cell.preset_id ? "drop" : ""} ${st?.text === "shared id" ? "shared-id" : ""}`}
                          aria-label={`Slot ${r}·${c}, preset ${cell.preset_id}: ${cell.name ?? "empty"}${st ? ` (${st.text})` : ""}`}
                          aria-pressed={picked?.preset_id === cell.preset_id} onClick={() => setPicked(cell)}>
                          <span className="slot-name">{cell.kind === "playlist" ? "▶ " : ""}{cell.base ?? "—"}</span>
                          <span className="slot-id">{cell.preset_id}{cell.notes.length ? " ⚠" : ""}
                            {st && <span className={`slot-state ${st.key}`} title={st.title}> {st.text}</span>}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {picked ? (
            <div className="slot-edit" aria-label="The picked slot">
              <h3>Slot {picked.row}·{picked.col}, preset {picked.preset_id}: {picked.name ?? "empty"}</h3>
              {pickedState && <p className="small">On {where}: <span className={`slot-state ${pickedState.key}`}>{pickedState.text}</span>. {pickedState.title}.</p>}
              {picked.notes.map((n) => <p key={n} className="warn small">⚠ {n}</p>)}
              {duplicate && (
                <section className="slot-duplicate warn" aria-label="Shared preset id">
                  <strong>Two looks have preset id {duplicate.preset_id}:</strong>{" "}
                  {[...duplicate.looks, ...duplicate.playlists].map((n) => `“${n}”`).join(" and ")}.
                  Only one can be on the device.
                  <div className="row">
                    {duplicate.looks.map((name) => (
                      <span className="row small" key={name}>
                        <button className="small" onClick={() => api.setPresetId(name, null).then(() => {
                          loadItems().catch(() => {});
                          load();
                          onChanged?.();
                          notify(`Removed preset id ${duplicate.preset_id} from “${name}”; it remains in the library`);
                        }).catch(fail)}>Remove the id from “{name}”</button>
                        {onOpenLook && <button className="small" onClick={() => onOpenLook(name)}>Open “{name}”</button>}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              <p className="small">
                Now click a look or playlist in the library to put it here. <strong>Filling copies:</strong> this slot gets a
                copy named like “{nameIn(g, picked, "Fire")}” with preset {picked.preset_id}; later changes to the original
                don't reach the copy (edit the copy in Looks &amp; effects).
                {picked.name && ` What is here now keeps its name and loses the preset id.`}
              </p>
              <div className="row">
                {picked.name && (
                  <button disabled={!deviceId} title={deviceId ? "Plays it on the strip now; nothing is stored on the device" : "Pick a device in the header"}
                    onClick={() => show(picked)}>Show on strip</button>
                )}
                {picked.name && <button onClick={() => slotsApi.clear(picked.preset_id).then((s) => done(s, "Slot emptied (in the library)")).catch(fail)}>
                  Empty the slot
                </button>}
                <button onClick={() => setPicked(null)}>Done</button>
              </div>
            </div>
          ) : <p className="muted small">Click a slot to fill it, show it on the strip or empty it.</p>}
        </div>
        <aside className="slot-library" aria-label="Library">
          <h3>Library</h3>
          <p className="muted small">
            {picked ? `Click one to copy it into slot ${picked.row}·${picked.col}.` : "Click a slot first, or drag one onto a slot."}
          </p>
          {(["look", "playlist"] as const).map((kind) => {
            const list = items.filter((i) => i.kind === kind);
            return list.length > 0 && (
              <div key={kind}>
                <h4>{kind === "look" ? "Looks" : "Playlists"}</h4>
                <ul className="slot-items">
                  {list.map((i) => (
                    <li key={itemKey(i)} className={(plan?.duplicates ?? []).some((d) => d.preset_id === i.preset_id) ? "shared-id" : undefined}
                      draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", itemKey(i)); e.dataTransfer.effectAllowed = "copy"; }}>
                      <button aria-label={`${kind === "playlist" ? "Playlist " : ""}${i.name}`}
                        title={picked ? `Copy into slot ${picked.row}·${picked.col}` : "Click a slot first"}
                        onClick={() => (picked ? fill(picked, i) : notify("Click a slot first, then the look to put in it."))}>
                        <span className="grow">{kind === "playlist" ? "▶ " : ""}{i.name}</span>
                        <span className="muted small">{i.preset_id ? `preset ${i.preset_id}` : ""}</span>
                        {(plan?.duplicates ?? []).some((d) => d.preset_id === i.preset_id) && <span className="warn small">shared id</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {items.length === 0 && <p className="muted small">Nothing saved yet: save looks in Looks &amp; effects first.</p>}
        </aside>
      </div>
      <details className="grid-settings">
        <summary>Grid settings</summary>
        <p className="muted small">One grid for now.</p>
        <button onClick={() => setEditing(g)}>Change the grid</button>
        {confirmRemove ? (
          <div className="inline-confirm warn" aria-label="Confirm removing the grid">
            <p>The looks keep their preset ids; only this layout is forgotten.</p>
            <button className="danger" onClick={() => slotsApi.removeGrid().then((s) => {
              setConfirmRemove(false); setPicked(null); setData(s); setEditing(DEFAULT);
            }).catch(fail)}>Yes, remove the grid</button>
            <button onClick={() => setConfirmRemove(false)}>Keep the grid</button>
          </div>
        ) : <button className="danger" onClick={() => setConfirmRemove(true)}>Remove the grid</button>}
      </details>
    </section>
  </>);
}
