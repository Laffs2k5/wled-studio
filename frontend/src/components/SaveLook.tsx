// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import { nextFreePresetId, parsePresetId, presetUsers, takenWarning } from "../presets";
import type { Look, Playlist } from "../types";

interface Props {
  deviceId: string;
  looks: Look[];
  playlists: Playlist[];
  notify: (msg: string, error?: boolean) => void;
  /** Called (and awaited) first: sends live changes still held back, so the look is what the strip shows. */
  beforeSave?: () => Promise<void>;
  onSaved: (look: Look) => void;
  onOpenPresets?: () => void;
}

/** "Save as look…" under the live controls: what the strip shows now, kept in the library. */
export function SaveLook({ deviceId, looks, playlists, notify, beforeSave, onSaved, onOpenPresets }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pid, setPid] = useState("");
  const [layout, setLayout] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Look | null>(null);

  if (!open) {
    return (
      <>
        <div className="row save-look">
          <button className="primary" onClick={() => { setSaved(null); setOpen(true); }}>Save as look…</button>
          <span className="muted small">Keeps what the strip shows now in the library.</span>
        </div>
        {saved && (
          <div className="row action-result done small" aria-label="Look saved">
            <span className="grow">Saved “{saved.name}” in the library. It is not on the device yet.</span>
            {onOpenPresets && saved.preset_id && <button className="small primary" onClick={() => {
              setSaved(null); onOpenPresets();
            }}>Open Presets on device</button>}
            <button className="small" onClick={() => setSaved(null)}>OK</button>
          </div>
        )}
      </>
    );
  }

  const id = parsePresetId(pid);
  const users = typeof id === "number" ? presetUsers(id, looks, playlists, name.trim()) : [];
  const next = nextFreePresetId(looks, playlists);
  const replaces = looks.some((l) => l.name === name.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (id === "bad") return;
    setBusy(true);
    try {
      await beforeSave?.();
      const l = await api.capture(deviceId, name.trim(), id ?? undefined, !layout);
      notify(`Saved “${l.name}” in the library. It is not on the device yet.`);
      setSaved(l);
      // only a saved look clears the form: the preset id too, so the next look doesn't land on the
      // same preset; after a failure both stay, to fix and try again
      setName(""); setPid(""); setOpen(false);
      onSaved(l);
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="save-look-form" aria-label="Save as look" onSubmit={save}>
      <h3>Save what the strip shows as a look</h3>
      <label className="field">
        <span>Name</span>
        <input value={name} maxLength={32} required autoFocus aria-label="Look name" onChange={(e) => setName(e.target.value)} />
      </label>
      {replaces && <p className="warn small">A look named “{name.trim()}” exists: saving replaces it.</p>}
      <label className="field">
        <span>Preset id (optional; without one the look stays in the library only)</span>
        <input value={pid} inputMode="numeric" className="preset-id" placeholder="1-250" onChange={(e) => setPid(e.target.value)} />
      </label>
      {next !== null && id === null && (
        <p className="small muted">
          Next free: {next}. <button type="button" className="link" onClick={() => setPid(String(next))}>Use {next}</button>
        </p>
      )}
      {id === "bad" && <p className="warn small">A preset id is a whole number from 1 to 250.</p>}
      {users.length > 0 && typeof id === "number" && <p className="warn small">{takenWarning(id, users)}</p>}
      <fieldset className="choice">
        <legend className="small">What the look keeps</legend>
        <label><input type="radio" name="layout" checked={layout} onChange={() => setLayout(true)} /> Whole strip setup: segments and
          their effects (showing it replaces the strip's segments)</label>
        <label><input type="radio" name="layout" checked={!layout} onChange={() => setLayout(false)} /> Effects and colours only:
          applied to whatever segments the strip has</label>
      </fieldset>
      <div className="row">
        <button className="primary" disabled={busy || !name.trim() || id === "bad"}>Save in the library</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
