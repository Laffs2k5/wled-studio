// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";

export function LibraryTransfer({ onChanged, notify }: {
  onChanged: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"keep" | "replace">("keep");
  const [preview, setPreview] = useState<{ looks: number; playlists: number; palettes: number; kept: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

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
      const text = `Imported ${out.looks} looks, ${out.playlists} playlists and ${out.palettes} palettes`
        + (out.kept.length ? `; kept ${out.kept.length} existing names` : "") + ".";
      setResult({ ok: true, text });
      setPreview(null);
      setFile(null);
      onChanged();
      notify(text);
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="library-transfer" aria-label="Library export and import">
      <h2>Portable library file</h2>
      <p className="muted small">Contains looks, playlists and palettes only. No tokens, PINs, device hosts, sets or grids.</p>
      <button onClick={() => api.exportLibrary().then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "wled-studio-library-v1.json";
        link.click();
        URL.revokeObjectURL(url);
      }).catch((e) => setResult({ ok: false, text: e.message }))}>Export library</button>
      <label className="field">
        <span>Import a library file</span>
        <input type="file" accept="application/json,.json" onChange={(e) => {
          setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null);
        }} />
      </label>
      {file && (
        <>
          <div className="row">
            <label><input type="radio" checked={mode === "keep"} onChange={() => { setMode("keep"); setPreview(null); }} /> Keep existing names</label>
            <label><input type="radio" checked={mode === "replace"} onChange={() => { setMode("replace"); setPreview(null); }} /> Replace same names</label>
          </div>
          <button disabled={busy} onClick={inspect}>Inspect before import</button>
        </>
      )}
      {preview && (
        <div className="inline-confirm" role="group" aria-label="Confirm library import">
          <p>Will merge {preview.looks} looks, {preview.playlists} playlists and {preview.palettes} palettes.</p>
          {preview.kept.length > 0 && <p>{preview.kept.length} existing names will be kept.</p>}
          <button className="primary" disabled={busy} onClick={doImport}>Import the library</button>
          <button onClick={() => setPreview(null)}>Cancel</button>
        </div>
      )}
      {result && <p className={`action-result ${result.ok ? "done" : "error"}`} role={result.ok ? "status" : "alert"}>{result.text}</p>}
    </section>
  );
}
