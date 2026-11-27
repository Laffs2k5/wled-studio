// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { api } from "../api";
import type { DevicePalette, Palette, PaletteStop } from "../types";

export function gradient(stops: PaletteStop[]): string {
  return `linear-gradient(to right, ${stops.map(([p, c]) => `#${c} ${Math.round((p / 255) * 100)}%`).join(", ")})`;
}

const START: PaletteStop[] = [[0, "ff3300"], [255, "3300ff"]];

/** Custom palettes: kept by name, uploaded to the device with the looks that need them. */
export function Palettes({ palettes, onChanged, notify, deviceId, deviceName, pending = null, onCheckAndWrite }: {
  palettes: Palette[]; onChanged: () => void; notify: (msg: string, error?: boolean) => void;
  /** Read custom palette files for this selected device. */
  deviceId?: string;
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
  const [onDevice, setOnDevice] = useState<DevicePalette[] | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [importNames, setImportNames] = useState<Record<number, string>>({});
  const [importResult, setImportResult] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<string[]>([]);

  useEffect(() => {
    if (!deviceId) return;
    let live = true;
    setOnDevice(null);
    setDeviceError(null);
    setImportResult(null);
    setConfirmReplace([]);
    api.devicePalettes(deviceId).then((rows) => {
      if (!live) return;
      setOnDevice(rows);
      setSelected(Object.fromEntries(rows.map((row) => [row.index, !row.owned && !row.in_library])));
      setImportNames(Object.fromEntries(rows.map((row) =>
        [row.index, row.owned_name ?? row.library_name ?? `Device palette ${row.id}`])));
    }).catch((e) => {
      if (!live) return;
      setDeviceError((e as Error).message);
    });
    return () => { live = false; };
  }, [deviceId]);

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

  async function importSelected(replace = false) {
    if (!deviceId || !onDevice) return;
    const rows = onDevice.filter((row) => selected[row.index]).map((row) => ({
      index: row.index, name: importNames[row.index]?.trim() ?? "",
    }));
    if (!rows.length) return;
    try {
      const result = await api.importDevicePalettes(deviceId, rows, replace);
      setConfirmReplace([]);
      setSelected({});
      setImportResult(`Imported ${result.imported.length} palette${result.imported.length === 1 ? "" : "s"}.`);
      setOnDevice((current) => current?.map((row) => selected[row.index] ? {
        ...row, owned: true, owned_name: importNames[row.index]?.trim(),
        in_library: true, library_name: importNames[row.index]?.trim(),
      } : row) ?? null);
      onChanged();
    } catch (e) {
      setImportResult((e as Error).message);
      notify((e as Error).message, true);
    }
  }

  function requestImport() {
    if (!deviceId || !onDevice) return;
    const libraryNames = new Set(palettes.map((palette) => palette.name));
    const clashes = onDevice.filter((row) => selected[row.index] && libraryNames.has(importNames[row.index]?.trim()))
      .map((row) => importNames[row.index].trim());
    if (clashes.length) setConfirmReplace([...new Set(clashes)]);
    else void importSelected();
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
      {deviceId && (
        <section className="device-palettes" aria-label="Palettes on the device">
          <h3>Palettes on the device{deviceName ? `: ${deviceName}` : ""}</h3>
          {onDevice === null && !deviceError && <p className="muted small">Reading palettes…</p>}
          {deviceError && <p className="warn small">{deviceError}</p>}
          {onDevice && onDevice.length === 0 && <p className="muted small">No custom palettes found.</p>}
          {onDevice && onDevice.length > 0 && (
            <>
              <ul className="look-list">
                {onDevice.map((row) => (
                  <li key={row.index}>
                    <input type="checkbox" checked={Boolean(selected[row.index])}
                      aria-label={`Import palette ${row.id}`}
                      onChange={(e) => setSelected({ ...selected, [row.index]: e.target.checked })} />
                    <span className="swatch" style={{ background: gradient(row.stops) }} aria-hidden="true" />
                    <label className="palette-import-name">
                      <span className="small muted">Palette {row.id} name</span>
                      <input value={importNames[row.index] ?? ""} maxLength={32}
                        aria-label={`Name for palette ${row.id}`}
                        onChange={(e) => setImportNames({ ...importNames, [row.index]: e.target.value })} />
                    </label>
                    <span className="small muted">
                      {row.owned_name ? `Owned as “${row.owned_name}”`
                        : row.library_name ? `Already in the library as “${row.library_name}”` : "WLED-made"}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="row">
                <button className="primary"
                  disabled={!onDevice.some((row) => selected[row.index] && importNames[row.index]?.trim())}
                  onClick={requestImport}>Import</button>
                {importResult && <span className="small" role="status">{importResult}</span>}
              </div>
              {confirmReplace.length > 0 && (
                <div className="inline-confirm" role="group" aria-label="Replace existing palettes?">
                  Replace {confirmReplace.map((name) => `“${name}”`).join(", ")} in the library?
                  <button className="danger" onClick={() => void importSelected(true)}>Replace and import</button>
                  <button onClick={() => setConfirmReplace([])}>Cancel</button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
