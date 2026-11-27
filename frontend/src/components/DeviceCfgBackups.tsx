// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, token, type ConfigBackup, type ConfigChange, type ConfigRestorePlan } from "../api";

export function DeviceCfgBackups({ deviceId, deviceName, notify, version }: {
  deviceId: string;
  deviceName: string;
  notify: (message: string, error?: boolean) => void;
  version: number;
}) {
  const [backups, setBackups] = useState<ConfigBackup[]>([]);
  const [selected, setSelected] = useState("");
  const [plan, setPlan] = useState<ConfigRestorePlan | null>(null);
  const [confirm, setConfirm] = useState("");
  const [overrideDevice, setOverrideDevice] = useState(false);
  const [allowNetwork, setAllowNetwork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const protectedWrites = token.get() !== null;

  const load = useCallback(() => {
    api.configBackups(deviceId).then((rows) => setBackups(Array.isArray(rows) ? rows : []))
      .catch((e) => setResult({ ok: false, text: e.message }));
  }, [deviceId]);
  useEffect(load, [load, version]);

  const backupNow = async () => {
    setBusy(true);
    setResult(null);
    try {
      const saved = await api.backupConfig(deviceId);
      setBackups((old) => [saved, ...old.filter((row) => row.name !== saved.name)]);
      setResult({ ok: true, text: `Saved device settings backup ${saved.name}.` });
      notify(`Backed up settings from ${deviceName}`);
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const preview = async (name: string) => {
    setSelected(name);
    setPlan(null);
    setConfirm("");
    setOverrideDevice(false);
    setAllowNetwork(false);
    setResult(null);
    try {
      setPlan(await api.planConfigRestore(deviceId, name));
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
  };

  const restore = async () => {
    if (!plan) return;
    setBusy(true);
    setResult(null);
    try {
      const out = await api.restoreConfig(deviceId, {
        confirm, backup: plan.backup, inspected_sha256: plan.inspected_sha256,
        override_device: overrideDevice, allow_network_changes: allowNetwork,
      });
      const checked = out.differences.length
        ? ` WLED reported ${out.differences.length} normalized difference${out.differences.length === 1 ? "" : "s"}: ${out.differences.map((row) => row.path).join(", ")}.`
        : "";
      setResult({ ok: true, text: `Restored ${out.restored}. Safety backup: ${out.backup}.${checked}` });
      notify(`Restored settings on ${deviceName}`);
      setSelected("");
      setPlan(null);
      load();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const sections = groupChanges(plan?.changes ?? []);
  const differentDevice = plan?.identity_match === false;
  const networkChanges = plan?.network_sections ?? [];
  const canRestore = plan && protectedWrites && confirm === "restore"
    && (!differentDevice || overrideDevice)
    && (networkChanges.length === 0 || allowNetwork);

  return (
    <section className="device-cfg-backups" aria-label="Device settings backups">
      <h2>Device settings</h2>
      <p className="muted small">Back up or restore the complete cfg.json. Wi-Fi passwords, the settings PIN, and other wsec.json secrets are never read or stored here.</p>
      {!protectedWrites && (
        <p className="warn small">Restore is locked in this browser because no WLED Studio access token is stored. Set the token prompt before restoring settings.</p>
      )}
      <button disabled={busy} onClick={backupNow}>Back up now</button>
      <details className="cfg-backups">
        <summary>Backups ({backups.length})</summary>
        <p className="muted small">Includes settings backups made before firmware flashes and reverts.</p>
        {backups.map((backup) => (
          <button key={backup.name} onClick={() => preview(backup.name)}>
            {backup.name}{backup.source !== "manual" ? ` (${backup.source})` : ""}
          </button>
        ))}
        {plan && selected === plan.backup && (
          <div className="inline-confirm" role="group" aria-label="Confirm device settings restore">
            <h3>Restore {plan.backup}</h3>
            {sections.length === 0 ? <p className="ok small">No settings differ.</p> : (
              <div>
                <p>These settings would change:</p>
                {sections.map(([section, changes]) => (
                  <div key={section}>
                    <strong>{section}</strong>
                    <ul aria-label={`${section} changes`}>
                      {changes.map((change) => <li key={`${change.action}:${change.path}`}>
                        {change.action} <code>{change.path}</code>
                      </li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {differentDevice && (
              <div className="warn">
                <p>This backup identifies another device ({plan.identity_differences.join(", ")}).</p>
                <label><input type="checkbox" checked={overrideDevice} onChange={(e) => setOverrideDevice(e.target.checked)} />
                  {" "}Restore settings from another device anyway</label>
              </div>
            )}
            {networkChanges.length > 0 && (
              <div className="warn">
                <p>Changing {networkChanges.join(", ")} can make {deviceName} unreachable.</p>
                <label><input type="checkbox" checked={allowNetwork} onChange={(e) => setAllowNetwork(e.target.checked)} />
                  {" "}Allow network settings to change</label>
              </div>
            )}
            <p>This uploads the complete file, waits for the reboot, and reads it back. The current settings are backed up first.</p>
            <label>Type <strong>restore</strong> to confirm
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </label>
            <button className="danger" disabled={!canRestore || busy} onClick={restore}>Restore these settings</button>
            <button onClick={() => { setSelected(""); setPlan(null); setConfirm(""); }}>Cancel</button>
          </div>
        )}
      </details>
      {result && <p className={`action-result ${result.ok ? "done" : "error"}`}
        role={result.ok ? "status" : "alert"}>{result.text}</p>}
    </section>
  );
}

function groupChanges(changes: ConfigChange[]): [string, ConfigChange[]][] {
  const groups = new Map<string, ConfigChange[]>();
  for (const change of changes) groups.set(change.section, [...(groups.get(change.section) ?? []), change]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}
