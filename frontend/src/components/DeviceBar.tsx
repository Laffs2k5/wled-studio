// SPDX-License-Identifier: EUPL-1.2
import { DEVICE_SELECT_ID, deviceLabel } from "../devices";
import { useState } from "react";
import { api } from "../api";
import type { Device } from "../types";
import { AddDevice } from "./AddDevice";

interface Props {
  devices: Device[];
  current: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  notify: (msg: string, error?: boolean) => void;
  /** Hide "Add device": the first-run card below asks for the first device. */
  hideAdd?: boolean;
}

export function DeviceBar({ devices, current, onSelect, onChanged, notify, hideAdd = false }: Props) {
  const [adding, setAdding] = useState(false);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");
  const cur = devices.find((d) => d.id === current);

  return (
    <div className="device-bar">
      {devices.length > 0 && (
        <>
          <label htmlFor={DEVICE_SELECT_ID} className="small muted" title="Every view works on this device">Device</label>
          <select id={DEVICE_SELECT_ID} value={current ?? ""} onChange={(e) => onSelect(e.target.value)}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{deviceLabel(d)} ({d.host})</option>
            ))}
          </select>
        </>
      )}
      {cur && (
        <button title="The device's settings PIN, needed to write presets and palettes"
          onClick={() => { setPinFor(pinFor ? null : cur.id); setNewPin(""); }}>
          {cur.has_pin ? "PIN ✓" : "PIN"}
        </button>
      )}
      {pinFor && (
        <form className="row" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.setPin(pinFor, newPin || null);
            notify(newPin ? "PIN saved in the app" : "PIN removed from the app");
            setPinFor(null); setNewPin("");
            onChanged();
          } catch (err) { notify((err as Error).message, true); }
        }}>
          <input type="password" value={newPin} autoComplete="off" maxLength={16} aria-label="New settings PIN"
            placeholder="PIN (empty removes it)" onChange={(e) => setNewPin(e.target.value)} />
          <button className="primary">Save PIN</button>
        </form>
      )}
      {!hideAdd && <button onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add device"}</button>}
      {adding && !hideAdd && (
        <AddDevice variant="bar" notify={notify} onAdded={(d) => { setAdding(false); onChanged(); onSelect(d.id); }} />
      )}
    </div>
  );
}
