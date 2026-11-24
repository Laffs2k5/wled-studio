// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { parsePresetId, presetUsers, takenWarning } from "../presets";
import type { Look, Playlist } from "../types";

interface Props {
  look: Look;
  looks: Look[];
  playlists: Playlist[];
  disabled?: boolean;
  /** Save the new id (null: none); resolves when saved, rejects to keep the field open. */
  onSave: (presetId: number | null) => Promise<unknown>;
}

/** A look row's preset id: "preset 6" (or "no preset id"), changed in place. */
export function PresetIdEdit({ look, looks, playlists, disabled, onSave }: Props) {
  const [text, setText] = useState<string | null>(null);   // null: not editing
  const [busy, setBusy] = useState(false);
  const shown = look.preset_id ? `preset ${look.preset_id}` : "no preset id";
  if (text === null) {
    return (
      <button className="link small preset-link" disabled={disabled} aria-label={`Preset id of ${look.name}: ${shown}`}
        title="Change the preset id this look is written to" onClick={() => setText(look.preset_id ? String(look.preset_id) : "")}>
        {shown}
      </button>
    );
  }
  const id = parsePresetId(text);
  const users = typeof id === "number" ? presetUsers(id, looks, playlists, look.name) : [];
  const save = async () => {
    if (id === "bad") return;
    setBusy(true);
    try {
      await onSave(id);
      setText(null);
    } catch { /* the caller said why; the field stays to fix it */ } finally {
      setBusy(false);
    }
  };
  return (
    <span className="preset-edit">
      <input value={text} inputMode="numeric" autoFocus aria-label={`New preset id for ${look.name}`} placeholder="none"
        className="slot" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setText(null); }} />
      <button className="small" disabled={busy || id === "bad"} onClick={save}>Save</button>
      <button className="small" disabled={busy} onClick={() => setText(null)}>Cancel</button>
      {id === "bad" && <span className="warn small note">A preset id is a whole number from 1 to 250 (empty: none).</span>}
      {id === null && <span className="muted small note">No preset id: the look stays in the library only.</span>}
      {users.length > 0 && typeof id === "number" && <span className="warn small note">{takenWarning(id, users)}</span>}
    </span>
  );
}
