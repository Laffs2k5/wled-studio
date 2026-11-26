// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { api, request, type DeviceSet, type FirmwareHistoryItem } from "../api";
import type { Device, DeviceState, EditingSession, Profile } from "../types";
import { when } from "../time";

export function DeviceHome({ deviceId, profile, state, device, devices = [], lastPresetWrite, onSelectDevice }: {
  deviceId: string;
  profile: Profile;
  state?: DeviceState;
  device?: Device;
  devices?: Device[];
  lastPresetWrite?: string | null;
  onSelectDevice?: (id: string) => void;
}) {
  const [history, setHistory] = useState<FirmwareHistoryItem[]>([]);
  const [failed, setFailed] = useState("");
  const [written, setWritten] = useState<string | null>(lastPresetWrite ?? null);
  const [set, setDeviceSet] = useState<DeviceSet | null>(null);
  const [session, setSession] = useState<EditingSession | null>(null);
  const [trial, setTrial] = useState(false);
  const [room, setRoom] = useState<{ edges?: unknown[]; zones?: unknown[] } | null>(null);
  useEffect(() => {
    api.firmwareHistory(deviceId).then(setHistory).catch((e) => setFailed(e.message));
    api.lastPresetWrite(deviceId).then((value) => setWritten(value.last_write)).catch((e) => setFailed(e.message));
    api.getSet(deviceId).then(setDeviceSet).catch((e) => setFailed(e.message));
    api.session(deviceId).then(setSession).catch((e) => setFailed(e.message));
    api.bankTrial(deviceId).then((value) => setTrial(value.active)).catch((e) => setFailed(e.message));
    request<typeof room>("GET", `/api/devices/${encodeURIComponent(deviceId)}/room`).then(setRoom).catch(() => {});
  }, [deviceId]);
  const twin = device?.twin_id ? devices.find((candidate) => candidate.id === device.twin_id) : null;
  const real = device?.virtual ? devices.find((candidate) => candidate.twin_id === device.id) : null;
  return (
    <section className="device-home" aria-label="Device status">
      <h2>{profile.device.name}</h2>
      <p className="small">
        Reachable · WLED {String(profile.info.ver ?? "?")}{profile.info.release ? ` (${profile.info.release})` : ""}
        {" · "}{profile.leds.count} LEDs{profile.info.arch === "virtual" ? " · virtual, no LEDs" : ""}
      </p>
      <p className="small muted">Presets last written by this app: {written ? new Date(written).toLocaleString() : "not yet"}.</p>
      <div className="device-status-grid" aria-label="Whole-device status">
        <div><strong>{state?.seg.length ?? "?"}</strong><span>segments live</span></div>
        <div><strong>{set ? (set.all ? "all" : (set.on_device?.looks.length ?? 0) + (set.on_device?.playlists.length ?? 0)) : "?"}</strong>
          <span>library items in this device set</span></div>
        <div><strong>{room?.edges?.length ?? 0}</strong><span>room walls</span></div>
        <div className={session?.active ? "warn" : trial ? "warn" : "ok"}><strong>{trial ? "bank trial" : session?.active ? "editing" : "idle"}</strong>
          <span>reversible live work</span></div>
      </div>
      {(twin || real) && (
        <p className="small">
          Linked {twin ? "virtual twin" : "real device"}: <strong>{twin?.name ?? real?.name}</strong>
          {" "}<button className="small" onClick={() => onSelectDevice?.((twin ?? real)!.id)}>
            Open {twin ? "offline twin" : "real device"}
          </button>
        </p>
      )}
      {!twin && !real && device && !device.virtual &&
        <p className="muted small">No virtual twin is linked. Add one in Device settings for offline work.</p>}
      <details>
        <summary>Firmware history ({history.length})</summary>
        {failed && <p className="warn small">{failed}</p>}
        {history.length === 0 ? <p className="muted small">No flashes or reverts recorded by this app.</p> : (
          <ul className="firmware-history">
            {history.map((row, index) => (
              <li key={row.id ?? `${row.when}-${index}`}>
                <strong>{row.kind === "flash" ? "Flash" : "Go back"}</strong> · {row.state}
                {row.ver ? ` · WLED ${row.ver}` : ""}{row.effects !== undefined ? ` · ${row.effects} effects` : ""}
                {row.when ? ` · ${when(row.when)}` : ""}
                {row.job ? ` · build ${row.job.slice(0, 8)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
