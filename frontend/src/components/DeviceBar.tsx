// SPDX-License-Identifier: EUPL-1.2
import { deviceLabel } from "../devices";
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
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");
  const cur = devices.find((d) => d.id === current);

  return (
    <div className="device-bar">
      {devices.length > 0 && (
        <select value={current ?? ""} aria-label="Device" onChange={(e) => onSelect(e.target.value)}>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>{deviceLabel(d)} ({d.host})</option>
          ))}
        </select>
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
