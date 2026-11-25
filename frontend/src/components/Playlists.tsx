// SPDX-License-Identifier: EUPL-1.2
import { useId, useState } from "react";
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
  /** The device "Show on strip" plays a playlist on; none: no Show. */
  deviceId?: string;
  deviceName?: string;
  /** The device doesn't answer: Show waits. */
  offline?: boolean;
  /** Called after a playlist was shown on the strip (the live controls read the device again). */
  onShown?: () => void;
  /** In the shared library tree: render only this folder, or only the editor. */
  folder?: string | null;
  listOnly?: boolean;
  formOnly?: boolean;
}

/** Seconds as people read them: "45 s", "2 min", "1 min 15 s". */
export function duration(tenths: number): string {
  const s = Math.round(tenths / 10);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

/** A playlist's length for one round, or that it stops on a look that stays. */
export function total(entries: PlaylistEntry[]): string {
  const stay = entries.findIndex((e) => e.duration === 0);
  if (stay >= 0) return `stays on “${entries[stay].look}” once it gets there`;
  return `${duration(entries.reduce((n, e) => n + e.duration, 0))} per round`;
}

const DEFAULT_TRANSITION = 7;   // tenths of a second: WLED's default

/** Playlists: looks in a row, each shown for a while. Written to the device with the looks. */
export function Playlists({ looks, playlists, onChanged, notify, checks = [], deviceId, deviceName, offline = false, onShown,
  folder, listOnly = false, formOnly = false }: Props) {
  const id = useId();
  const status = new Map(checks.filter((c) => c.playlist).map((c) => [c.playlist as string, c]));
  const [open, setOpen] = useState(false);
  // the playlist being edited (its name can't change here); null: a new one
  const [editing, setEditing] = useState<Playlist | null>(null);
  const [name, setName] = useState("");
  const [slot, setSlot] = useState("");
  const [entries, setEntries] = useState<PlaylistEntry[]>([]);
  const [shuffle, setShuffle] = useState(false);
  const [transition, setTransition] = useState(String(DEFAULT_TRANSITION / 10));
  const [pick, setPick] = useState("");
  const [seconds, setSeconds] = useState("30");
  const [shown, setShown] = useState<{ name: string; ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newFolder, setNewFolder] = useState<{ name: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [entryDrop, setEntryDrop] = useState(false);
  const byName = new Map(looks.map((l) => [l.name, l]));

  function reset() {
    setEditing(null); setName(""); setSlot(""); setEntries([]); setShuffle(false);
    setTransition(String(DEFAULT_TRANSITION / 10)); setPick(""); setSeconds("30");
  }
  function edit(p: Playlist) {
    setEditing(p); setName(p.name); setSlot(p.preset_id ? String(p.preset_id) : ""); setEntries(p.entries.map((e) => ({ ...e })));
    setShuffle(p.shuffle); setTransition(String((p.entries[0]?.transition ?? DEFAULT_TRANSITION) / 10)); setOpen(true);
  }
  const tenths = (v: string) => Math.max(0, Math.round(Number(v || "0") * 10));
  const move = (i: number, by: -1 | 1) => setEntries((es) => {
    const n = [...es];
    [n[i], n[i + by]] = [n[i + by], n[i]];
    return n;
  });

  async function save() {
    const t = tenths(transition);
    const pl: Playlist = {
      name: name.trim(), preset_id: slot ? Number(slot) : undefined, shuffle,
      entries: entries.map((e) => ({ ...e, transition: t })),
      // what this form doesn't show is kept as it was
      repeat: editing?.repeat ?? 0, ...(editing?.end ? { end: editing.end } : {}),
    };
    try {
      await api.putPlaylist(pl);
      notify(`Saved playlist “${pl.name}” in the library (not on the device yet)`);
      reset(); setOpen(false);
      onChanged();
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  async function show(p: Playlist) {
    if (!deviceId) return;
    setBusy(true);
    setShown(null);
    try {
      await api.play(deviceId, p.name);
      setShown({ name: p.name, ok: true, text: `Playing “${p.name}” on ${deviceName ?? "the device"} (live; nothing is saved on it).` });
      onShown?.();
    } catch (e) {
      setShown({ name: p.name, ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const noId = looks.filter((l) => !l.preset_id);

  const rows = !formOnly && (
    <>
      {!listOnly && <h2>Playlists</h2>}
      {groupByFolder(playlists).filter((group) => !listOnly || group.folder === folder).map(({ folder: groupFolder, items }) => (
        <div key={groupFolder ?? ""} className={listOnly ? "playlist-folder-items" : "look-group"}>
          {!listOnly && folders([...playlists, ...looks]).length > 0 && <p className="small muted group-head">{groupFolder ?? "Not in a folder"}</p>}
          <ul className="look-list">
            {items.map((p) => (
              <li key={p.name}>
                <span className="name">▶ {p.name}</span>
                <StatusBadge item={status.get(p.name)} />
                <span className="muted small">{p.entries.length} {p.entries.length === 1 ? "look" : "looks"}{p.shuffle ? ", shuffled" : ""}, {total(p.entries)} · {p.preset_id ? `preset ${p.preset_id}` : "no preset id"}</span>
                {deviceId && (
                  <button disabled={busy || offline} title={offline ? `${deviceName ?? "The device"} does not answer` : "Plays its looks' presets as stored on the device"}
                    aria-label={`Show ${p.name} on strip`} onClick={() => show(p)}>Show on strip</button>
                )}
                <button aria-label={`Edit playlist ${p.name}`} onClick={() => edit(p)}>Edit</button>
                <span className="row-menu">
                  <button className="menu-button" aria-label={`More for playlist ${p.name}`} aria-expanded={menu === p.name}
                    onClick={() => setMenu(menu === p.name ? null : p.name)}>⋯</button>
                  {menu === p.name && (
                    <div className="menu" role="menu" aria-label={`Playlist actions for ${p.name}`}>
                      <button role="menuitem" onClick={() => { setMenu(null); setMoving(p.name); }}>Move to folder…</button>
                      <button role="menuitem" className="danger" onClick={() => { setMenu(null); setDeleting(p.name); }}>Delete…</button>
                    </div>
                  )}
                </span>
                {moving === p.name && (
                  <span className="inline-edit row">
                    <select autoFocus aria-label={`Folder for ${p.name}`} value="" onChange={(e) => {
                      const to = e.target.value || null;
                      if (to === "\u0000new") { setNewFolder({ name: p.name, value: "" }); return; }
                      if (to === (p.folder ?? null)) return;
                      api.setFolder("playlists", [p.name], to).then(() => { setMoving(null); onChanged(); })
                        .catch((er) => notify(er.message, true));
                    }}>
                      <option value="">Move to…</option>
                      {folders([...playlists, ...looks]).filter((f) => f !== p.folder).map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                      <option value={"\u0000new"}>A new folder…</option>
                      {p.folder && <option value={"\u0000none"}>No folder</option>}
                    </select>
                    <button onClick={() => setMoving(null)}>Cancel</button>
                  </span>
                )}
                {newFolder?.name === p.name && (
                  <span className="inline-edit row">
                    <input autoFocus aria-label={`New folder for playlist ${p.name}`} value={newFolder.value}
                      onChange={(e) => setNewFolder({ ...newFolder, value: e.target.value })} />
                    <button disabled={!newFolder.value.trim()} onClick={() => {
                      api.setFolder("playlists", [p.name], newFolder.value.trim())
                        .then(() => { setNewFolder(null); setMoving(null); onChanged(); }).catch((er) => notify(er.message, true));
                    }}>Move</button>
                    <button onClick={() => { setNewFolder(null); setMoving(null); }}>Cancel</button>
                  </span>
                )}
                {deleting === p.name && (
                  <div className="inline-confirm" role="group" aria-label={`Delete playlist ${p.name}?`}>
                    <p>Delete “{p.name}” from the library? Its preset stays on the device until you remove it there.</p>
                    <button className="danger" onClick={() => api.deletePlaylist(p.name)
                      .then(() => { setDeleting(null); onChanged(); }).catch((e) => notify(e.message, true))}>Delete playlist</button>
                    <button onClick={() => setDeleting(null)}>Cancel</button>
                  </div>
                )}
                {shown?.name === p.name && (
                  <div className={`row action-result ${shown.ok ? "done" : "error"}`} aria-label="Show result">
                    <span className="grow" role={shown.ok ? undefined : "alert"}>{shown.text}</span>
                    <button className="small" onClick={() => setShown(null)}>OK</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!listOnly && playlists.length === 0 && <p className="muted">No playlists yet.</p>}
    </>
  );

  const form = !listOnly && (
      <details className="playlist-form" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>{editing ? `Edit playlist “${editing.name}”` : "New playlist"}</summary>
        <p className="muted small">Looks shown in turn, each for a while. Only looks with a preset id can be in a playlist: it
          plays their presets on the device.</p>
        <div className="row">
          <label className="field">
            <span>Playlist name{editing ? " (can't be changed here)" : ""}</span>
            <input value={name} maxLength={32} disabled={!!editing} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Playlist's preset id (1-250)</span>
            <input value={slot} inputMode="numeric" className="preset-id" placeholder="optional" onChange={(e) => setSlot(e.target.value)} />
          </label>
        </div>
        <ol className={`small playlist-entries${entryDrop ? " drop" : ""}`} aria-label="Looks in the playlist"
          onDragOver={(e) => { e.preventDefault(); setEntryDrop(true); }}
          onDragLeave={() => setEntryDrop(false)}
          onDrop={(e) => {
            e.preventDefault();
            setEntryDrop(false);
            const look = e.dataTransfer.getData("text/look");
            if (look && byName.get(look)?.preset_id) {
              setEntries([...entries, { look, duration: tenths(seconds), transition: tenths(transition) }]);
            }
          }}>
          {entries.map((e, i) => (
            <li key={i} className="row">
              <span className="grow">{e.look}{byName.get(e.look)?.preset_id ? ` (preset ${byName.get(e.look)!.preset_id})` : ""}</span>
              <input value={e.duration / 10} inputMode="decimal" className="slot" aria-label={`Seconds for ${e.look}`}
                onChange={(ev) => setEntries(entries.map((x, j) => (j === i ? { ...x, duration: tenths(ev.target.value) } : x)))} />
              <span className="muted">s</span>
              <button aria-label={`Move ${e.look} up`} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
              <button aria-label={`Move ${e.look} down`} disabled={i === entries.length - 1} onClick={() => move(i, 1)}>▼</button>
              <button aria-label={`Remove ${e.look}`} onClick={() => setEntries(entries.filter((_, j) => j !== i))}>×</button>
            </li>
          ))}
        </ol>
        {entries.length > 0 && <p className="small" aria-label="Total duration">Total: {total(entries)}{shuffle ? ", in a random order" : ""}.</p>}
        <div className="row">
          <label className="field">
            <span>Add a look</span>
            <select id={`${id}-pick`} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a look…</option>
              {looks.map((l) => (
                <option key={l.name} value={l.name} disabled={!l.preset_id}>{l.name}{l.preset_id ? "" : " (needs a preset id)"}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Seconds</span>
            <input value={seconds} inputMode="decimal" className="slot" onChange={(e) => setSeconds(e.target.value)} />
          </label>
          <button className="add-entry" disabled={!pick} onClick={() => {
            setEntries([...entries, { look: pick, duration: tenths(seconds), transition: tenths(transition) }]);
            setPick(""); setSeconds("30");
          }}>Add</button>
        </div>
        {noId.length > 0 && <p className="muted small">Looks without a preset id are greyed out: give one a preset id (click
          “no preset id” on its row) to use it here.</p>}
        <div className="row">
          <label className="field">
            <span>Fade between looks (s)</span>
            <input value={transition} inputMode="decimal" className="slot" onChange={(e) => setTransition(e.target.value)} />
          </label>
          <label className="small"><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} /> Shuffle</label>
        </div>
        <div className="row">
          <button className="primary" disabled={!name.trim() || entries.length === 0} onClick={save}>
            {editing ? `Save “${editing.name}”` : "Save playlist"}
          </button>
          {editing && <button onClick={() => { reset(); setOpen(false); }}>Cancel</button>}
        </div>
      </details>
  );

  return (
    <section aria-label={formOnly ? "Playlist editor" : "Playlists"} className={listOnly ? "playlist-folder" : undefined}>
      {rows}
      {form}
    </section>
  );
}
