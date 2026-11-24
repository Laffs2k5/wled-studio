// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import { folders, groupByFolder } from "../organise";
import type { CheckItem, Look, Playlist, PlaylistEntry } from "../types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  looks: Look[];
  playlists: Playlist[];
  onChanged: () => void;
  notify: (msg: string, error?: boolean) => void;
  /** Each playlist's change-check status: the worst of its looks'. */
  checks?: CheckItem[];
}

/** Playlists: looks in a row, each shown for a while. Written to the device with the looks. */
export function Playlists({ looks, playlists, onChanged, notify, checks = [] }: Props) {
  const status = new Map(checks.filter((c) => c.playlist).map((c) => [c.playlist as string, c]));
  const [name, setName] = useState("");
  const [slot, setSlot] = useState("");
  const [entries, setEntries] = useState<PlaylistEntry[]>([]);
  const [shuffle, setShuffle] = useState(false);
  const [pick, setPick] = useState("");
  const [seconds, setSeconds] = useState("30");
  const slotted = looks.filter((l) => l.preset_id);

  async function save() {
    try {
      await api.putPlaylist({ name: name.trim(), preset_id: slot ? Number(slot) : undefined, entries, repeat: 0, shuffle });
      notify(`Saved playlist “${name.trim()}” in the library (not on the device yet)`);
      setName(""); setSlot(""); setEntries([]); setShuffle(false);
      onChanged();
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  return (
    <section aria-label="Playlists">
      <h2>Playlists</h2>
      {groupByFolder(playlists).map(({ folder, items }) => (
        <div key={folder ?? ""} className="look-group">
          {folders([...playlists, ...looks]).length > 0 && <p className="small muted group-head">{folder ?? "Not in a folder"}</p>}
          <ul className="look-list">
            {items.map((p) => (
              <li key={p.name}>
                <span className="name">▶ {p.name}</span>
                <StatusBadge item={status.get(p.name)} />
                <span className="muted small">{p.entries.length} looks{p.shuffle ? ", shuffled" : ""} · {p.preset_id ? `preset ${p.preset_id}` : "no preset id"}</span>
                <select aria-label={`Folder for ${p.name}`} value={p.folder ?? ""} onChange={(e) => {
                  let to: string | null = e.target.value || null;
                  if (to === "\u0000new") to = prompt("New folder name")?.trim() || null;
                  if (to === (p.folder ?? null)) return;
                  api.setFolder("playlists", [p.name], to).then(onChanged).catch((er) => notify(er.message, true));
                }}>
                  <option value="">No folder</option>
                  {folders([...playlists, ...looks]).map((f) => <option key={f} value={f}>{f}</option>)}
                  <option value={"\u0000new"}>A new folder…</option>
                </select>
                <button className="danger" aria-label={`Delete playlist ${p.name}`}
                  onClick={() => confirm(`Delete playlist “${p.name}”?`) &&
                    api.deletePlaylist(p.name).then(onChanged).catch((e) => notify(e.message, true))}>×</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {playlists.length === 0 && <p className="muted">No playlists yet.</p>}
      <details>
        <summary>New playlist</summary>
        <div className="row">
          <input placeholder="Name" value={name} maxLength={32} aria-label="Playlist name" onChange={(e) => setName(e.target.value)} />
          <input placeholder="Preset id (1-250)" value={slot} inputMode="numeric" className="preset-id" aria-label="Playlist preset id" onChange={(e) => setSlot(e.target.value)} />
        </div>
        <div className="row">
          <select value={pick} aria-label="Look to add" onChange={(e) => setPick(e.target.value)}>
            <option value="">Add a look…</option>
            {slotted.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
          <input value={seconds} inputMode="numeric" className="slot" aria-label="Seconds" onChange={(e) => setSeconds(e.target.value)} />
          <span className="small muted">s</span>
          <button disabled={!pick} onClick={() => {
            setEntries([...entries, { look: pick, duration: Math.round(Number(seconds || "0") * 10), transition: 7 }]);
            setPick("");
          }}>Add</button>
        </div>
        <ol className="small">
          {entries.map((e, i) => (
            <li key={i}>{e.look}, {e.duration / 10} s <button aria-label={`Remove ${e.look}`}
              onClick={() => setEntries(entries.filter((_, j) => j !== i))}>×</button></li>
          ))}
        </ol>
        <label className="small"><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} /> Shuffle</label>
        <div className="row">
          <button className="primary" disabled={!name.trim() || entries.length === 0} onClick={save}>Save playlist</button>
        </div>
        {slotted.length < looks.length && <p className="muted small">Only looks with a preset id can be in a playlist.</p>}
      </details>
    </section>
  );
}
