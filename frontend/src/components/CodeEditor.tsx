// SPDX-License-Identifier: EUPL-1.2
import { deviceLabel } from "../devices";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, effects, type EffectFolder } from "../api";
import { GitPanel } from "./GitPanel";

// CodeMirror loads when a file is first opened, not with the page
const Code = lazy(() => import("./Code").then((m) => ({ default: m.Code })));
import type { Device } from "../types";
import type { Place } from "../compileLog";

/** An effect id in use, and by what. */
export interface UsedId { id: number; by: string }

/** The highest effect id from 254 down that nothing uses (new effects sit above WLED's own). */
export function nextFreeId(used: UsedId[]): number | null {
  const taken = new Set(used.map((u) => u.id));
  for (let id = 254; id >= 200; id--) if (!taken.has(id)) return id;
  return null;
}

/** Edit your effect usermods' files (./effects), and start new ones from a template. */
export function CodeEditor({ notify, onSaved, onOpen, jump = null, device = null, previewIds = [], onCreated, onCompile }: {
  notify: (msg: string, error?: boolean) => void;
  onSaved?: (folder: string) => void;
  /** Effect ids the preview has (the built-in example's, say), besides the folders' own. */
  previewIds?: UsedId[];
  /** A new effect was created: the studio ticks its folder for compiling. */
  onCreated?: (folder: string) => void;
  /** Compile and preview the ticked folders (offered after creating an effect). */
  onCompile?: () => void;
  /** A file was opened (its folder): the studio ticks that folder for compiling. */
  onOpen?: (folder: string) => void;
  /** Open this file at this line (a compiler message's place); a new `seq` jumps again. */
  jump?: (Place & { seq: number }) | null;
  /** The header's device: the room map is taken from it unless another is picked here. */
  device?: string | null;
}) {
  const [folders, setFolders] = useState<EffectFolder[] | null>(null);
  const [file, setFile] = useState<{ folder: string; name: string } | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newId, setNewId] = useState("");
  const [template, setTemplate] = useState<"wave" | "room">("wave");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ folder: string; id: number } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [mapFor, setMapFor] = useState(device ?? "");
  useEffect(() => { setMapFor(device ?? ""); }, [device]);
  const [saves, setSaves] = useState(0);      // refreshes the git panel after a save
  useEffect(() => { api.devices().then(setDevices).catch(() => setDevices([])); }, []);

  const reload = useCallback(() => effects.list().then(setFolders).catch(() => setFolders(null)), []);
  useEffect(() => { reload(); }, [reload]);

  async function open(folder: string, name: string): Promise<boolean> {
    if (dirty && !confirm("Discard unsaved changes?")) return false;
    try {
      const r = await effects.read(folder, name);
      setFile({ folder, name });
      setText(r.content);
      setDirty(false);
      onOpen?.(folder);
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    }
  }

  // a compiler message clicked in the studio: open its file (unless it's open) and go to the line
  const [line, setLine] = useState<{ line: number; seq: number } | null>(null);
  useEffect(() => {
    if (!jump) return;
    (async () => {
      if ((file?.folder !== jump.folder || file?.name !== jump.file) && !(await open(jump.folder, jump.file))) return;
      setLine({ line: jump.line, seq: jump.seq });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.seq]);

  if (folders === null) return null; // no effects directory configured
  const used: UsedId[] = [
    ...folders.flatMap((f) => (f.effect_ids ?? []).map((id) => ({ id, by: f.folder }))),
    ...previewIds.filter((p) => !folders.some((f) => f.effect_ids?.includes(p.id))),
  ].sort((a, b) => a.id - b.id);
  const free = nextFreeId(used);
  const idNum = Number(newId || free || 0);
  const idProblem = !Number.isInteger(idNum) || idNum < 200 || idNum > 254 ? "The effect id must be a whole number from 200 to 254."
    : used.some((u) => u.id === idNum) ? `Effect id ${idNum} is taken by ${used.find((u) => u.id === idNum)!.by}.` : null;
  const folderProblem = newFolder && !/^[a-z][a-z0-9_]{1,40}$/.test(newFolder)
    ? "Lowercase letters, digits and _ only, starting with a letter (2 to 41 characters)."
    : folders.some((f) => f.folder === newFolder) ? "There is a folder with that name already." : null;
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
        <button className="new-effect" aria-expanded={creating} onClick={() => { setCreating(!creating); setCreated(null); setCreateError(null); }}>
          {creating ? "Close the new effect form" : "＋ New effect"}
        </button>
      </div>
      {creating && (
        <form className="new-effect-form" aria-label="New effect" onSubmit={async (e) => {
          e.preventDefault();
          setCreateError(null);
          try {
            const r = await effects.create(newFolder, newTitle, idNum, template);
            setCreated({ folder: r.folder, id: idNum });
            setNewFolder(""); setNewTitle(""); setNewId("");
            await reload();
            onCreated?.(r.folder);
            open(r.folder, `${r.folder}.cpp`);
          } catch (er) { setCreateError((er as Error).message); }
        }}>
          <h3>New effect</h3>
          <p className="muted small">Starts from a template: two colours and a moving wave, with its own effect id.</p>
          <label className="field">
            <span>Folder name (lowercase, e.g. my_wave)</span>
            <input value={newFolder} required autoCapitalize="off" spellCheck={false} onChange={(e) => setNewFolder(e.target.value)} />
          </label>
          {folderProblem && <p className="warn small">{folderProblem}</p>}
          <label className="field">
            <span>Name shown in WLED</span>
            <input value={newTitle} maxLength={28} required pattern="[A-Za-z0-9 _\-]+" onChange={(e) => setNewTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Effect id (200-254; never change it later: presets store it)</span>
            <input value={newId} placeholder={free ? String(free) : ""} inputMode="numeric" className="slot"
              aria-describedby="new-effect-ids" onChange={(e) => setNewId(e.target.value)} />
          </label>
          <p id="new-effect-ids" className="muted small">
            {free ? `${newId ? "" : `${free}, the next free one, unless you type another. `}` : "No id from 200 to 254 is free. "}
            {used.length ? `In use: ${used.map((u) => `${u.id} (${u.by})`).join(", ")}.` : "None in use yet."}
          </p>
          {newId && idProblem && <p className="warn small">{idProblem}</p>}
          <label className="field">
            <span>Start from</span>
            <select value={template} onChange={(e) => setTemplate(e.target.value as "wave" | "room")}>
              <option value="wave">A wave along the strip</option>
              <option value="room">Room-aware: a wave across the room (uses room_map.h)</option>
            </select>
          </label>
          <div className="row">
            <button className="primary" disabled={!!idProblem || !!folderProblem || !newFolder || !newTitle.trim()}>Create</button>
          </div>
          {createError && <p className="small action-result error" role="alert">{createError}</p>}
          {created && (
            <p className="small action-result done row">
              <span className="grow">Created {created.folder} (effect id {created.id}) and opened its code.
                {onCompile ? " It's ticked for compiling." : ""}</span>
              {onCompile && <button className="small primary" onClick={onCompile}>Compile and preview</button>}
            </p>
          )}
        </form>
      )}
      {(file?.folder ?? folders[0]?.folder) && (
        <GitPanel folder={file?.folder ?? folders[0].folder} version={saves} notify={notify} />
      )}
      {file && devices.length > 0 && (
        <div className="row small">
          <span className="muted">Room map from</span>
          <select value={mapFor} aria-label="Room map device" onChange={(e) => setMapFor(e.target.value)}>
            <option value="">Pick a device…</option>
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
          <Code value={text} fileName={file.name} line={line} onChange={(next) => { setText(next); setDirty(true); }} />
        </Suspense>
      )}
    </div>
  );
}
