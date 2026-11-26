// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import type { DeviceState } from "../types";
import { clearLiveSnapshots, liveSnapshots, stateHash, type LiveSnapshot } from "../liveSnapshots";

function describe(snapshot: LiveSnapshot): string {
  const effects = snapshot.state.seg.map((segment) => `seg ${segment.id}`).join(", ");
  return `${new Date(snapshot.at).toLocaleTimeString()} · ${snapshot.label} · ${effects || "no segments"}`;
}

export function LiveSnapshots({ deviceId, notify, onRestored }: {
  deviceId: string;
  notify: (message: string, error?: boolean) => void;
  onRestored: (state: DeviceState) => void;
}) {
  const [rows, setRows] = useState(() => liveSnapshots(deviceId));
  const [selected, setSelected] = useState<LiveSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  if (rows.length === 0) return null;
  return (
    <details className="live-snapshots">
      <summary>Automatic live history ({rows.length})</summary>
      <p className="muted small">
        The previous state is saved in this browser before live changes. Restoring asks Studio to
        recheck the device first, so a newer Home Assistant or remote change is not silently overwritten.
      </p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span className="grow">{describe(row)}</span>
            <button className="small" onClick={() => setSelected(row)}>Restore…</button>
          </li>
        ))}
      </ul>
      <button className="small" onClick={() => {
        clearLiveSnapshots(deviceId);
        setRows([]);
        setSelected(null);
      }}>Forget this browser history</button>
      {selected && (
        <div className="inline-confirm">
          <p>Restore the live state from {describe(selected)}? This changes what the strip shows, but writes no preset.</p>
          <button className="danger" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const current = await api.state(deviceId);
              const result = await api.restoreSnapshot(deviceId, selected.state, await stateHash(current));
              onRestored(result.state);
              setSelected(null);
              notify("Live snapshot restored after rechecking the current device state");
            } catch (e) {
              notify((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}>Restore and verify</button>
          <button onClick={() => setSelected(null)}>Cancel</button>
        </div>
      )}
    </details>
  );
}
