// SPDX-License-Identifier: EUPL-1.2
import { DEVICE_SELECT_ID, deviceLabel } from "../devices";
import { useState } from "react";
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
  /** Open or close the current device's settings (shown below the header). */
  onSettings?: () => void;
  settingsOpen?: boolean;
}

export function DeviceBar({ devices, current, onSelect, onChanged, notify, hideAdd = false, onSettings, settingsOpen = false }: Props) {
  const [adding, setAdding] = useState(false);
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
        <button className="gear" aria-label="Device settings" aria-expanded={settingsOpen} title="Device settings: name, address, PIN, room shape, remove"
          onClick={onSettings}>⚙<span className="gear-text"> Settings</span></button>
      )}
      {!hideAdd && <button onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add device"}</button>}
      {adding && !hideAdd && (
        <AddDevice variant="bar" notify={notify} onAdded={(d) => { setAdding(false); onChanged(); onSelect(d.id); }} />
      )}
    </div>
  );
}
