// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import type { Look, Playlist, PlaylistEntry } from "../types";

interface Props {
  looks: Look[];
  playlists: Playlist[];
  onChanged: () => void;
  notify: (msg: string, error?: boolean) => void;
}

/** Playlists: looks in a row, each shown for a while. Written to the device with the looks. */
export function Playlists({ looks, playlists, onChanged, notify }: Props) {
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
      notify(`Saved playlist “${name.trim()}”`);
      setName(""); setSlot(""); setEntries([]); setShuffle(false);
      onChanged();
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  return (
    <section aria-label="Playlists">
      <h2>Playlists</h2>
      <ul className="look-list">
        {playlists.map((p) => (
          <li key={p.name}>
            <span className="name">▶ {p.name}</span>
            <span className="muted small">{p.entries.length} looks{p.shuffle ? ", shuffled" : ""} · {p.preset_id ? `slot ${p.preset_id}` : "no slot"}</span>
            <button className="danger" aria-label={`Delete playlist ${p.name}`}
              onClick={() => confirm(`Delete playlist “${p.name}”?`) &&
                api.deletePlaylist(p.name).then(onChanged).catch((e) => notify(e.message, true))}>×</button>
          </li>
        ))}
        {playlists.length === 0 && <li className="muted">No playlists yet.</li>}
      </ul>
      <details>
        <summary>New playlist</summary>
        <div className="row">
          <input placeholder="Name" value={name} maxLength={32} aria-label="Playlist name" onChange={(e) => setName(e.target.value)} />
          <input placeholder="Slot" value={slot} inputMode="numeric" className="slot" aria-label="Playlist slot" onChange={(e) => setSlot(e.target.value)} />
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
        {slotted.length < looks.length && <p className="muted small">Only looks with a slot can be in a playlist.</p>}
      </details>
    </section>
  );
}
