// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import type { Palette, PaletteStop } from "../types";

export function gradient(stops: PaletteStop[]): string {
  return `linear-gradient(to right, ${stops.map(([p, c]) => `#${c} ${Math.round((p / 255) * 100)}%`).join(", ")})`;
}

const START: PaletteStop[] = [[0, "ff3300"], [255, "3300ff"]];

/** Custom palettes: kept by name, uploaded to the device with the looks that need them. */
export function Palettes({ palettes, onChanged, notify }: {
  palettes: Palette[]; onChanged: () => void; notify: (msg: string, error?: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [stops, setStops] = useState<PaletteStop[]>(START);

  const set = (i: number, stop: PaletteStop) => setStops(stops.map((s, j) => (j === i ? stop : s)));
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);

  return (
    <section aria-label="Palettes">
      <h2>Palettes</h2>
      <ul className="look-list">
        {palettes.map((p) => (
          <li key={p.name}>
            <span className="name">{p.name}</span>
            <span className="swatch" style={{ background: gradient(p.stops) }} aria-hidden="true" />
            <button onClick={() => { setName(p.name); setStops(p.stops); }}>Edit</button>
            <button className="danger" aria-label={`Delete palette ${p.name}`}
              onClick={() => confirm(`Delete palette “${p.name}”?`) &&
                api.deletePalette(p.name).then(onChanged).catch((e) => notify(e.message, true))}>×</button>
          </li>
        ))}
        {palettes.length === 0 && <li className="muted">No custom palettes yet.</li>}
      </ul>
      <details>
        <summary>{name ? `Edit “${name}”` : "New palette"}</summary>
        <input placeholder="Name" value={name} maxLength={32} aria-label="Palette name" onChange={(e) => setName(e.target.value)} />
        <div className="gradient" style={{ background: gradient(sorted) }} aria-label="Palette preview" />
        {stops.map(([pos, col], i) => (
          <div className="row" key={i}>
            <input type="color" value={`#${col}`} aria-label={`Stop ${i + 1} colour`}
              onChange={(e) => set(i, [pos, e.target.value.slice(1)])} />
            <input type="range" min={0} max={255} value={pos} aria-label={`Stop ${i + 1} position`}
              disabled={i === 0 || i === stops.length - 1} onChange={(e) => set(i, [Number(e.target.value), col])} />
            {i > 0 && i < stops.length - 1 &&
              <button aria-label={`Remove stop ${i + 1}`} onClick={() => setStops(stops.filter((_, j) => j !== i))}>×</button>}
          </div>
        ))}
        <div className="row">
          <button disabled={stops.length >= 18} onClick={() => {
            const s = [...sorted];
            s.splice(s.length - 1, 0, [Math.round((s[s.length - 2][0] + 255) / 2), "ffffff"]);
            setStops(s);
          }}>Add stop</button>
          <button className="primary" disabled={!name.trim()} onClick={() =>
            api.putPalette({ name: name.trim(), stops: sorted })
              .then(() => { notify(`Saved palette “${name.trim()}”`); setName(""); setStops(START); onChanged(); })
              .catch((e) => notify(e.message, true))}>Save palette</button>
        </div>
        <p className="muted small">Uploaded to the device on the next write; looks pick it by name.</p>
      </details>
    </section>
  );
}
