// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface Props {
  deviceId: string;
  notify: (msg: string, error?: boolean) => void;
  /** Called (and awaited) before the session ends: flushes held-back live edits. */
  beforeAction?: () => Promise<void>;
  /** Called after the device was put back. */
  onRestored: () => void;
}

/** An editing session: remember what the device shows, and put it back when editing is done. */
export function SessionBar({ deviceId, notify, beforeAction, onRestored }: Props) {
  const [started, setStarted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.session(deviceId)
    .then((s) => setStarted(s.active ? s.started : null)).catch(() => setStarted(null)), [deviceId]);
  useEffect(() => { load(); }, [load]);

  async function run(f: () => Promise<void>) {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      notify((e as Error).message, true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (started === null) {
    return (
      <div className="session row">
        <button disabled={busy} onClick={() => run(async () => {
          const s = await api.startSession(deviceId);
          setStarted(s.started);
        })}>
          Start editing session
        </button>
        <span className="muted small">Remembers what the device shows, to put it back when you're done.</span>
      </div>
    );
  }
  const since = new Date(started * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="session row active">
      <span>Editing since {since}</span>
      <button className="primary" disabled={busy} onClick={() => run(async () => {
        await beforeAction?.();
        await api.endSession(deviceId, true);
        setStarted(null);
        notify("The device is back as it was");
        onRestored();
      })}>
        Done: put the device back
      </button>
      <button disabled={busy} onClick={() => run(async () => {
        await beforeAction?.();
        await api.endSession(deviceId, false);
        setStarted(null);
        notify("Session ended; your changes stay on the device");
      })}>
        Keep my changes
      </button>
    </div>
  );
}
