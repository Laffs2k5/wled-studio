// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { firmware, type PresetBackup, type PresetsOnDevice } from "../api";

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

  const load = useCallback(() => {
    setPresets(null);
    setSelected(new Set());
    setBackup(null);
    setDeleting(false);
    setRestoring("");
    setRestoreConfirm("");
    Promise.all([firmware.presetsOnDevice(deviceId), firmware.backups(deviceId)])
      .then(([current, files]) => { setPresets(current); setBackups(files); })
      .catch((e) => setResult({ ok: false, text: e.message }));
  }, [deviceId]);
  useEffect(load, [load, version]);

  const remove = async () => {
    if (!presets) return;
    try {
      setResult(null);
      const out = await firmware.deletePresets(deviceId, {
        confirm, inspected_sha256: presets.sha256, preset_ids: [...selected],
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

  return (
    <section className="preset-safety" aria-label="Device preset safety">
      <h2>Presets stored on {deviceName}</h2>
      <p className="muted small">Normal library writes never delete presets. Remove them here only when they are not in the library.</p>
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
                    </label>
                  </li>
                ))}
              </ul>
              {!deleting && selected.size > 0 && <button className="danger" onClick={() => setDeleting(true)}>
                Delete {selected.size} preset{selected.size === 1 ? "" : "s"} from {deviceName}
              </button>}
              {deleting && (
                <div className="inline-confirm" role="group" aria-label="Confirm preset deletion">
                  <p>This changes stored presets on {deviceName}. The file is backed up first, uploaded, and verified.</p>
                  <label>Type the device name: <strong>{deviceName}</strong>
                    <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
                  </label>
                  <button className="danger" disabled={confirm !== deviceName} onClick={remove}>Delete selected presets</button>
                  <button onClick={() => setDeleting(false)}>Cancel</button>
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
            <label>Type the device name: <strong>{deviceName}</strong>
              <input value={restoreConfirm} onChange={(e) => setRestoreConfirm(e.target.value)} autoComplete="off" />
            </label>
            <button className="danger" disabled={restoreConfirm !== deviceName} onClick={restore}>Restore this backup</button>
            <button onClick={() => { setBackup(null); setRestoring(""); setRestoreConfirm(""); }}>Cancel</button>
          </div>
        )}
      </details>
      {result && <p className={`action-result ${result.ok ? "done" : "error"}`} role={result.ok ? "status" : "alert"}>{result.text}</p>}
    </section>
  );
}
