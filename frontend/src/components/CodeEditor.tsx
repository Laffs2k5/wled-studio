// SPDX-License-Identifier: EUPL-1.2
import { deviceLabel } from "../devices";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, effects, type EffectFolder } from "../api";
import { GitPanel } from "./GitPanel";

// CodeMirror loads when a file is first opened, not with the page
const Code = lazy(() => import("./Code").then((m) => ({ default: m.Code })));
import type { Device } from "../types";

/** Edit your effect usermods' files (./effects), and start new ones from a template. */
export function CodeEditor({ notify, onSaved }: { notify: (msg: string, error?: boolean) => void; onSaved?: (folder: string) => void }) {
  const [folders, setFolders] = useState<EffectFolder[] | null>(null);
  const [file, setFile] = useState<{ folder: string; name: string } | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newId, setNewId] = useState("250");
  const [template, setTemplate] = useState<"wave" | "room">("wave");
  const [devices, setDevices] = useState<Device[]>([]);
  const [mapFor, setMapFor] = useState("");
  const [saves, setSaves] = useState(0);      // refreshes the git panel after a save
  useEffect(() => { api.devices().then(setDevices).catch(() => setDevices([])); }, []);

  const reload = useCallback(() => effects.list().then(setFolders).catch(() => setFolders(null)), []);
  useEffect(() => { reload(); }, [reload]);

  async function open(folder: string, name: string) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    try {
      const r = await effects.read(folder, name);
      setFile({ folder, name });
      setText(r.content);
      setDirty(false);
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  if (folders === null) return null; // no effects directory configured
  return (
    <div className="code-editor">
      <h2>Your effects' code</h2>
      <div className="row">
        <select aria-label="Effect file" value={file ? `${file.folder}/${file.name}` : ""}
          onChange={(e) => { const [f, n] = e.target.value.split("/"); if (f && n) open(f, n); }}>
          <option value="">Open a file…</option>
          {folders.flatMap((f) => f.files.map((n) => <option key={`${f.folder}/${n}`} value={`${f.folder}/${n}`}>{f.folder}/{n}</option>))}
        </select>
        <button className="primary" disabled={!file || !dirty} onClick={async () => {
          try {
            await effects.save(file!.folder, file!.name, text);
            setDirty(false);
            setSaves((n) => n + 1);
            notify(`Saved ${file!.folder}/${file!.name}`);
            onSaved?.(file!.folder);
          } catch (e) { notify((e as Error).message, true); }
        }}>Save</button>
      </div>
      {(file?.folder ?? folders[0]?.folder) && (
        <GitPanel folder={file?.folder ?? folders[0].folder} version={saves} notify={notify} />
      )}
      {file && devices.length > 0 && (
        <div className="row small">
          <select value={mapFor} aria-label="Room map device" onChange={(e) => setMapFor(e.target.value)}>
            <option value="">Room map from…</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{deviceLabel(d)}</option>)}
          </select>
          <button disabled={!mapFor} title="Write room_map.h (each LED's position) into this effect's folder"
            onClick={() => effects.roomMap(file.folder, mapFor)
              .then((r) => { notify(`room_map.h written: ${r.leds} LEDs`); reload(); })
              .catch((e) => notify(e.message, true))}>Write room map</button>
        </div>
      )}
      {file && (
        <Suspense fallback={<p className="muted small">Loading the editor…</p>}>
          <Code value={text} fileName={file.name} onChange={(next) => { setText(next); setDirty(true); }} />
        </Suspense>
      )}
      <details>
        <summary>New effect</summary>
        <form className="row" onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await effects.create(newFolder, newTitle, Number(newId), template);
            notify(`Created ${r.folder}`);
            setNewFolder(""); setNewTitle("");
            await reload();
            open(r.folder, `${r.folder}.cpp`);
          } catch (er) { notify((er as Error).message, true); }
        }}>
          <input placeholder="folder (my_effect)" value={newFolder} pattern="[a-z][a-z0-9_]{1,40}" required aria-label="New effect folder" onChange={(e) => setNewFolder(e.target.value)} />
          <input placeholder="Name shown in WLED" value={newTitle} maxLength={28} required aria-label="New effect name" onChange={(e) => setNewTitle(e.target.value)} />
          <input value={newId} className="slot" inputMode="numeric" aria-label="Effect id" title="Effect id, 200-254: keep it the same forever" onChange={(e) => setNewId(e.target.value)} />
          <select value={template} aria-label="Template" onChange={(e) => setTemplate(e.target.value as "wave" | "room")}>
            <option value="wave">A wave along the strip</option>
            <option value="room">Room-aware: a wave across the room</option>
          </select>
          <button>Create</button>
        </form>
        <p className="muted small">Starts from a template: a fixed effect id (200–254, keep it forever so presets keep working), two colours and a moving wave.</p>
      </details>
    </div>
  );
}
