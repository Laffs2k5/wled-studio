// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, firmware, token, type PresetBackup, type PresetsOnDevice } from "../api";

export function PresetSafety({ deviceId, deviceName, notify, version, onChanged }: {
  deviceId: string;
  deviceName: string;
  notify: (message: string, error?: boolean) => void;
  version: number;
  onChanged: () => void;
}) {
  const [presets, setPresets] = useState<PresetsOnDevice | null>(null);
  const [backups, setBackups] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [backup, setBackup] = useState<PresetBackup | null>(null);
  const [restoring, setRestoring] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [protectedIds, setProtectedIds] = useState<{ id: number; label: string }[]>([]);
  const [overrideDelete, setOverrideDelete] = useState(false);
  const [overrideRestore, setOverrideRestore] = useState(false);

  const load = useCallback(() => {
    setPresets(null);
    setSelected(new Set());
    setBackup(null);
    setDeleting(false);
    setRestoring("");
    setRestoreConfirm("");
    setOverrideDelete(false);
    setOverrideRestore(false);
    Promise.all([firmware.presetsOnDevice(deviceId), firmware.backups(deviceId)])
      .then(([current, files]) => { setPresets(current); setBackups(files); })
      .catch((e) => setResult({ ok: false, text: e.message }));
  }, [deviceId]);
  useEffect(() => {
    api.protectedPresets().then((rows) => setProtectedIds(Array.isArray(rows) ? rows : []))
      .catch(() => setProtectedIds([]));
  }, []);
  useEffect(load, [load, version]);

  const remove = async () => {
    if (!presets) return;
    try {
      setResult(null);
      const out = await firmware.deletePresets(deviceId, {
        confirm, inspected_sha256: presets.sha256, preset_ids: [...selected],
        override_protected: overrideDelete ? protectedSelected.map((p) => p.id) : [],
      });
      setResult({ ok: true, text: `Deleted ${out.deleted.length} preset${out.deleted.length === 1 ? "" : "s"} from ${deviceName}. Safety backup: ${out.backup}.` });
      notify(`Deleted presets from ${deviceName}`);
      onChanged();
      load();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setDeleting(false);
    }
  };

  const restore = async () => {
    if (!presets || !backup) return;
    try {
      setResult(null);
      const out = await firmware.restorePresets(deviceId, {
        confirm: restoreConfirm, inspected_sha256: presets.sha256, backup: backup.name,
        override_protected: overrideRestore ? restoreChanges.protectedIds : [],
      });
      setResult({ ok: true, text: `Restored ${backup.name} to ${deviceName}. Safety backup of the previous file: ${out.backup}.` });
      notify(`Restored presets on ${deviceName}`);
      onChanged();
      load();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
  };

  const unmanaged = presets?.presets.filter((p) => !p.library) ?? [];
  const offSet = presets?.presets.filter((p) => p.library && !p.on_device_set) ?? [];
  const protectedWrites = token.get() !== null;
  const protectedSelected = unmanaged.filter((p) => selected.has(p.id) && p.protected_by?.length);
  const restoreChanges = compareBackup(presets, backup, protectedIds);

  return (
    <section className="preset-safety" aria-label="Device preset safety">
      <h2>Presets stored on {deviceName}</h2>
      <p className="muted small">Normal library writes never delete presets. Remove them here only when they are not in the library.</p>
      {!protectedWrites && (
        <p className="warn small">Delete and restore are locked in this browser because no WLED Studio access token is stored. Set the token prompt, then reopen Presets.</p>
      )}
      {!presets ? <p className="muted small">Reading stored presets…</p> : (
        <>
          {unmanaged.length === 0 ? <p className="small ok">No presets are outside the library.</p> : (
            <div>
              <h3>On {deviceName}, not in the library</h3>
              <ul className="stored-presets">
                {unmanaged.map((preset) => (
                  <li key={preset.id}>
                    <label className="grow">
                      <input type="checkbox" checked={selected.has(preset.id)} onChange={(e) => setSelected((old) => {
                        const next = new Set(old);
                        e.target.checked ? next.add(preset.id) : next.delete(preset.id);
                        return next;
                      })} />
                      {" "}Preset {preset.id}: {preset.name}
                      {preset.protected_by?.length ? <span className="warn"> · protected: {preset.protected_by.join(", ")}</span> : null}
                      {preset.boot ? <span className="warn"> · shown at power-on</span> : null}
                      {preset.in_playlists?.length ? <span className="muted"> · played by playlist {preset.in_playlists.join(", ")}</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
              {!deleting && selected.size > 0 && <button className="danger" disabled={!protectedWrites} onClick={() => setDeleting(true)}>
                Delete {selected.size} preset{selected.size === 1 ? "" : "s"} from {deviceName}
              </button>}
              {deleting && (
                <div className="inline-confirm" role="group" aria-label="Confirm preset deletion">
                  <p>This changes stored presets on {deviceName}. The file is backed up first, uploaded, and verified.</p>
                  {protectedSelected.length > 0 && (
                    <div className="warn">
                      <p>Something outside the library depends on {protectedSelected.length === 1 ? "this preset" : "these presets"}:</p>
                      <ul>{protectedSelected.map((p) => <li key={p.id}>Preset {p.id} {p.name}: {p.protected_by?.join(", ")}</li>)}</ul>
                      <label><input type="checkbox" checked={overrideDelete} onChange={(e) => setOverrideDelete(e.target.checked)} />
                        {" "}Delete {protectedSelected.length === 1 ? "it" : "them"} anyway</label>
                    </div>
                  )}
                  <label>Type the device name: <strong>{deviceName}</strong>
                    <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
                  </label>
                  <button className="danger" disabled={confirm !== deviceName || (protectedSelected.length > 0 && !overrideDelete)} onClick={remove}>Delete selected presets</button>
                  <button onClick={() => { setDeleting(false); setOverrideDelete(false); }}>Cancel</button>
                </div>
              )}
            </div>
          )}
          {offSet.length > 0 && (
            <p className="muted small">In the library but left off this device's set: {offSet.map((p) => `${p.id} ${p.name}`).join(", ")}.</p>
          )}
        </>
      )}
      <details className="preset-backups">
        <summary>Backups ({backups.length})</summary>
        <p className="muted small">Restoring replaces the complete stored presets file. It does not restore firmware, settings, or palettes.</p>
        {backups.map((name) => (
          <button key={name} onClick={() => {
            setRestoring(name);
            firmware.backup(deviceId, name).then(setBackup).catch((e) => setResult({ ok: false, text: e.message }));
          }}>{name}</button>
        ))}
        {backup && restoring === backup.name && (
          <div className="inline-confirm" aria-label="Restore backup">
            <h3>Restore {backup.name}</h3>
            <p>{backup.presets.length} presets, {backup.bytes.toLocaleString()} bytes.</p>
            <ul>{backup.presets.map((p) => <li key={p.id}>Preset {p.id}: {p.name}</li>)}</ul>
            <p>This replaces all stored presets on {deviceName}; the current file is backed up first.</p>
            {restoreChanges.summary.length === 0
              ? <p className="ok small">Same presets as on {deviceName} now.</p>
              : <ul aria-label="What the restore changes">{restoreChanges.summary.map((line) => <li key={line}>{line}</li>)}</ul>}
            {restoreChanges.protectedIds.length > 0 && (
              <div className="warn">
                <p>Protected presets would change: {restoreChanges.protectedIds.join(", ")}.</p>
                <label><input type="checkbox" checked={overrideRestore} onChange={(e) => setOverrideRestore(e.target.checked)} />
                  {" "}Change them anyway</label>
              </div>
            )}
            <label>Type the device name: <strong>{deviceName}</strong>
              <input value={restoreConfirm} onChange={(e) => setRestoreConfirm(e.target.value)} autoComplete="off" />
            </label>
            <button className="danger" disabled={!protectedWrites || restoreConfirm !== deviceName || (restoreChanges.protectedIds.length > 0 && !overrideRestore)} onClick={restore}>Restore this backup</button>
            <button onClick={() => { setBackup(null); setRestoring(""); setRestoreConfirm(""); setOverrideRestore(false); }}>Cancel</button>
          </div>
        )}
      </details>
      <details className="protected-presets">
        <summary>Preset IDs owned by remotes or automations</summary>
        <p className="muted small">Deleting or restoring over these ids needs an explicit tick. Add a label for anything that depends on a fixed id. A slot grid's ids are protected without being listed here.</p>
        {protectedIds.map((row, index) => (
          <div className="row" key={`${row.id}:${index}`}>
            <input type="number" min={1} max={250} aria-label={`Protected preset ${index + 1} id`} value={row.id}
              onChange={(e) => setProtectedIds((rows) => rows.map((x, i) => i === index ? { ...x, id: Number(e.target.value) } : x))} />
            <input aria-label={`Protected preset ${index + 1} label`} value={row.label}
              onChange={(e) => setProtectedIds((rows) => rows.map((x, i) => i === index ? { ...x, label: e.target.value } : x))} />
            <button aria-label={`Remove protected preset ${index + 1}`} onClick={() => setProtectedIds((rows) => rows.filter((_, i) => i !== index))}>×</button>
          </div>
        ))}
        <button onClick={() => setProtectedIds([...protectedIds, { id: 100, label: "Remote" }])}>Add protected id</button>
        <button disabled={protectedIds.some((row) => !row.label.trim() || row.id < 1 || row.id > 250)}
          onClick={() => api.saveProtectedPresets(protectedIds.map((row) => ({ ...row, label: row.label.trim() })))
            .then(setProtectedIds).then(() => notify("Protected preset ids saved")).catch((e) => setResult({ ok: false, text: e.message }))}>
          Save protected ids
        </button>
      </details>
      {result && <p className={`action-result ${result.ok ? "done" : "error"}`} role={result.ok ? "status" : "alert"}>{result.text}</p>}
    </section>
  );
}

/** What restoring `backup` would change against what the device holds now, in plain lines, and the
 *  protected ids among those changes (the server refuses them unless named). */
export function compareBackup(current: PresetsOnDevice | null, backup: PresetBackup | null,
                              listed: { id: number; label: string }[]): { summary: string[]; protectedIds: number[] } {
  if (!current || !backup) return { summary: [], protectedIds: [] };
  const now = new Map(current.presets.map((p) => [p.id, p]));
  const then = new Map(backup.presets.map((p) => [p.id, p]));
  const removed = current.presets.filter((p) => !then.has(p.id));
  const added = backup.presets.filter((p) => !now.has(p.id));
  const changed = backup.presets.filter((p) => {
    const c = now.get(p.id);
    return c !== undefined && (c.name !== p.name || (c.sha !== undefined && p.sha !== undefined && c.sha !== p.sha));
  });
  const names = (rows: { id: number; name: string }[]) => rows.map((p) => `${p.id} ${p.name}`).join(", ");
  const summary = [
    ...(removed.length ? [`Removes ${removed.length}, added since: ${names(removed)}`] : []),
    ...(added.length ? [`Brings back ${added.length}: ${names(added)}`] : []),
    ...(changed.length ? [`Changes ${changed.length}: ${names(changed)}`] : []),
  ];
  const listedIds = new Set(listed.map((r) => r.id));
  const protectedIds = [...removed, ...added, ...changed].map((p) => p.id)
    .filter((id) => (now.get(id)?.protected_by?.length ?? 0) > 0 || listedIds.has(id))
    .sort((a, b) => a - b);
  return { summary, protectedIds };
}
