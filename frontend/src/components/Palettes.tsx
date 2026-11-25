// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import type { Palette, PaletteStop } from "../types";

export function gradient(stops: PaletteStop[]): string {
  return `linear-gradient(to right, ${stops.map(([p, c]) => `#${c} ${Math.round((p / 255) * 100)}%`).join(", ")})`;
}

const START: PaletteStop[] = [[0, "ff3300"], [255, "3300ff"]];

/** Custom palettes: kept by name, uploaded to the device with the looks that need them. */
export function Palettes({ palettes, onChanged, notify, deviceName, pending = null, onCheckAndWrite }: {
  palettes: Palette[]; onChanged: () => void; notify: (msg: string, error?: boolean) => void;
  /** The device the write bar compares with, to say which palettes are on it. */
  deviceName?: string;
  /** The palettes the next write would upload to it (new or changed); null while unknown. */
  pending?: string[] | null;
  /** Open the write plan (the write bar's Review and write). */
  onCheckAndWrite?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // the palette being edited (null: a new one); the summary names it only once it's saved
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [stops, setStops] = useState<PaletteStop[]>(START);
  // the palette just saved: its row is marked, with how to use it, until the next action here
  const [saved, setSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const set = (i: number, stop: PaletteStop) => setStops(stops.map((s, j) => (j === i ? stop : s)));
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  const where = (n: string) => pending === null || !deviceName ? null
    : pending.includes(n) ? { on: false, text: `not on ${deviceName} yet` } : { on: true, text: `on ${deviceName}` };

  function edit(p: Palette | null) {
    setSaved(null);
    setEditing(p?.name ?? null);
    setName(p?.name ?? "");
    setStops(p?.stops ?? START);
    setOpen(true);
  }

  return (
    <section aria-label="Palettes">
      <h2>Palettes</h2>
      <ul className="look-list">
        {palettes.map((p) => {
          const w = where(p.name);
          return (
            <li key={p.name} className={saved === p.name ? "just-saved" : undefined}>
              <span className="name">{p.name}</span>
              <span className="swatch" style={{ background: gradient(p.stops) }} aria-hidden="true" />
              {w && <span className={`small ${w.on ? "muted" : "warn"}`}>{w.text}</span>}
              <button aria-label={`Edit palette ${p.name}`} onClick={() => edit(p)}>Edit</button>
              <button className="danger" aria-label={`Delete palette ${p.name}`}
                onClick={() => setDeleting(p.name)}>×</button>
              {deleting === p.name && (
                <span className="inline-confirm" role="group" aria-label={`Delete palette ${p.name}?`}>
                  Delete “{p.name}” from the library? Looks that use it keep their saved palette name.
                  <button className="danger" onClick={() => api.deletePalette(p.name)
                    .then(() => { setDeleting(null); onChanged(); }).catch((e) => notify(e.message, true))}>Delete palette</button>
                  <button onClick={() => setDeleting(null)}>Cancel</button>
                </span>
              )}
              {saved === p.name && (
                <div className="row action-result done small" aria-label="Palette saved">
                  <span className="grow">
                    Saved “{p.name}” in the library. To use it: write presets to {deviceName ?? "the device"} once, then pick it
                    in an effect's Palette list.
                  </span>
                  {onCheckAndWrite && <button className="small primary" onClick={() => { setSaved(null); onCheckAndWrite(); }}>Check and write</button>}
                  <button className="small" onClick={() => setSaved(null)}>OK</button>
                </div>
              )}
            </li>
          );
        })}
        {palettes.length === 0 && <li className="muted">No custom palettes yet.</li>}
      </ul>
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>{editing ? `Edit “${editing}”` : "New palette"}</summary>
        <label className="field">
          <span>Palette name{editing ? " (a new name saves a copy)" : ""}</span>
          <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="gradient" style={{ background: gradient(sorted) }} aria-label="Palette preview" />
        {stops.map(([pos, col], i) => (
          <div className="row" key={i}>
            <input type="color" value={`#${col}`} aria-label={`Stop ${i + 1} colour`}
              onChange={(e) => set(i, [pos, e.target.value.slice(1)])} />
            <input type="range" min={0} max={255} value={pos} aria-label={`Stop ${i + 1} position`}
              disabled={i === 0 || i === stops.length - 1} onChange={(e) => set(i, [Number(e.target.value), col])} />
            <span className="small muted stop-pos" aria-label={`Stop ${i + 1} at`}>{pos}</span>
            {i > 0 && i < stops.length - 1 &&
              <button aria-label={`Remove stop ${i + 1}`} onClick={() => setStops(stops.filter((_, j) => j !== i))}>×</button>}
          </div>
        ))}
        <p className="muted small">Positions run from 0 (the start) to 255 (the end); the first and last stay there.</p>
        <div className="row">
          <button disabled={stops.length >= 18} onClick={() => {
            const s = [...sorted];
            s.splice(s.length - 1, 0, [Math.round((s[s.length - 2][0] + 255) / 2), "ffffff"]);
            setStops(s);
          }}>Add stop</button>
          <button className="primary" disabled={!name.trim()} onClick={() =>
            api.putPalette({ name: name.trim(), stops: sorted })
              .then(() => {
                const n = name.trim();
                setEditing(null); setName(""); setStops(START); setOpen(false);
                setSaved(n);
                onChanged();
              })
              .catch((e) => notify(e.message, true))}>Save palette</button>
          {editing && <button onClick={() => { setEditing(null); setName(""); setStops(START); setOpen(false); }}>Cancel</button>}
        </div>
        <p className="muted small">A palette reaches the device with the next write of presets; then it's in the effects'
          Palette lists there, by name.</p>
      </details>
    </section>
  );
}
