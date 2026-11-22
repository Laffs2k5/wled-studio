// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import type { Device } from "../types";

interface Props {
  devices: Device[];
  current: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  notify: (msg: string, error?: boolean) => void;
}

export function DeviceBar({ devices, current, onSelect, onChanged, notify }: Props) {
  const [adding, setAdding] = useState(devices.length === 0);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [pin, setPin] = useState("");

  return (
    <div className="device-bar">
      {devices.length > 0 && (
        <select value={current ?? ""} aria-label="Device" onChange={(e) => onSelect(e.target.value)}>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>{d.name} ({d.host})</option>
          ))}
        </select>
      )}
      <button onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add device"}</button>
      {adding && (
        <form className="row" onSubmit={async (e) => {
          e.preventDefault();
          try {
            const d = await api.addDevice(name.trim(), host.trim(), pin || undefined);
            setName(""); setHost(""); setPin(""); setAdding(false);
            onChanged();
            onSelect(d.id);
            notify(`Added ${d.name}`);
          } catch (err) {
            notify((err as Error).message, true);
          }
        }}>
          <input placeholder="Name" value={name} required maxLength={64} aria-label="Device name" onChange={(e) => setName(e.target.value)} />
          <input placeholder="Host (wled.local or 192.168.x.y)" value={host} required aria-label="Device host" onChange={(e) => setHost(e.target.value)} />
          <input placeholder="Settings PIN (optional)" value={pin} type="password" autoComplete="off" maxLength={16}
            aria-label="Settings PIN" onChange={(e) => setPin(e.target.value)} />
          <button className="primary">Add</button>
        </form>
      )}
    </div>
  );
}
