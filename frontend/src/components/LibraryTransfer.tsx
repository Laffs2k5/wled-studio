// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, type ArchiveImport, type LibraryVersion } from "../api";
import { when } from "../time";

/** What an import does, in plain lines: the library, then grids, protected ids, rooms and sets. */
export function importLines(r: ArchiveImport, done: boolean): string[] {
  const verb = done ? "Imported" : "Will import";
  const lines = [`${verb} ${r.looks} looks, ${r.playlists} playlists and ${r.palettes} palettes.`];
  if (r.kept.length) lines.push(`Kept as they are here (same name): ${r.kept.join(", ")}.`);
  if (r.slot_grids) lines.push(`${done ? "Added or replaced" : "Adds or replaces"} ${r.slot_grids} slot grid${r.slot_grids === 1 ? "" : "s"}.`);
  if (r.kept_grids?.length) lines.push(`Slot grids kept as they are here: ${r.kept_grids.join(", ")}.`);
  if (r.protected_presets) lines.push(`${done ? "Added" : "Adds"} ${r.protected_presets} protected preset id${r.protected_presets === 1 ? "" : "s"}.`);
  if (r.rooms?.length) lines.push(`Room model for: ${r.rooms.join(", ")}.`);
  if (r.sets?.length) lines.push(`Device set for: ${r.sets.join(", ")}.`);
  if (r.unmatched_devices?.length) lines.push(`No device here named ${r.unmatched_devices.join(", ")}: its room and set are skipped.`);
  return lines;
}

export function LibraryTransfer({ onChanged, notify }: {
  onChanged: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"keep" | "replace">("keep");
  const [preview, setPreview] = useState<ArchiveImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [versions, setVersions] = useState<LibraryVersion[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const loadVersions = useCallback(() => {
    api.libraryVersions().then((rows) => setVersions(Array.isArray(rows) ? rows : [])).catch(() => setVersions([]));
  }, []);
  useEffect(loadVersions, [loadVersions]);

  async function inspect() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      setPreview(await api.importLibrary(file, mode, true));
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!file) return;
    setBusy(true);
    try {
      const out = await api.importLibrary(file, mode);
      const text = importLines(out, true).join(" ");
      setResult({ ok: true, text });
      setPreview(null);
      setFile(null);
      onChanged();
      loadVersions();
      notify(text);
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function restore(name: string) {
    setBusy(true);
    try {
      const out = await api.restoreLibraryVersion(name);
      const text = `Library restored: ${out.looks} looks, ${out.playlists} playlists, ${out.palettes} palettes. `
        + "The library from before is the newest earlier version, if you want it back.";
      setResult({ ok: true, text });
      setRestoring(null);
      onChanged();
      loadVersions();
      notify("Library restored");
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="library-transfer" aria-label="Library export and import">
      <h2>Studio file</h2>
      <p className="muted small">
        Looks, playlists and palettes, the slot grids, the protected preset ids, and each device's room
        model and set (by device name). No tokens, PINs or device addresses.
      </p>
      <button onClick={() => api.exportLibrary().then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "wled-studio-library-v2.json";
        link.click();
        URL.revokeObjectURL(url);
      }).catch((e) => setResult({ ok: false, text: e.message }))}>Export</button>
      <label className="field">
        <span>Import a library file</span>
        <input type="file" accept="application/json,.json" onChange={(e) => {
          setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null);
        }} />
      </label>
      {file && (
        <>
          <div className="row">
            <label><input type="radio" checked={mode === "keep"} onChange={() => { setMode("keep"); setPreview(null); }} /> Keep what is here under the same name</label>
            <label><input type="radio" checked={mode === "replace"} onChange={() => { setMode("replace"); setPreview(null); }} /> Replace it with the file's</label>
          </div>
          <button disabled={busy} onClick={inspect}>Inspect before import</button>
        </>
      )}
      {preview && (
        <div className="inline-confirm" role="group" aria-label="Confirm library import">
          {importLines(preview, false).map((line) => <p key={line}>{line}</p>)}
          <p className="muted small">The library as it is now stays among its earlier versions below.</p>
          <button className="primary" disabled={busy} onClick={doImport}>Import the library</button>
          <button onClick={() => setPreview(null)}>Cancel</button>
        </div>
      )}
      <details className="library-versions" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadVersions(); }}>
        <summary>Earlier versions of the library ({versions?.length ?? "…"})</summary>
        <p className="muted small">
          What the library held before each change, newest first. Restoring one brings back its looks,
          playlists and palettes; the library from before the restore becomes an earlier version itself.
          Devices are not touched until the next write.
        </p>
        <ul>
          {versions?.map((v) => (
            <li key={v.name}>
              {when(Date.parse(v.saved) / 1000)}: {v.looks} looks, {v.playlists} playlists, {v.palettes} palettes{" "}
              {restoring === v.name ? (
                <span role="group" aria-label={`Confirm restoring the version from ${when(Date.parse(v.saved) / 1000)}`}>
                  <button className="danger" disabled={busy} onClick={() => restore(v.name)}>Restore this version</button>
                  <button onClick={() => setRestoring(null)}>Cancel</button>
                </span>
              ) : <button onClick={() => setRestoring(v.name)}>Restore…</button>}
            </li>
          ))}
        </ul>
      </details>
      {result && <p className={`action-result ${result.ok ? "done" : "error"}`} role={result.ok ? "status" : "alert"}>{result.text}</p>}
    </section>
  );
}
