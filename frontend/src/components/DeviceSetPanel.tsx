// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, type DeviceSet } from "../api";
import type { Look, Playlist } from "../types";

export function DeviceSetPanel({ deviceId, deviceName, looks, playlists, notify, onChanged }: {
  deviceId: string;
  deviceName: string;
  looks: Look[];
  playlists: Playlist[];
  notify: (message: string, error?: boolean) => void;
  onChanged: () => void;
}) {
  const [set, setSet] = useState<DeviceSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceCount, setDeviceCount] = useState(1);
  const load = useCallback(() => api.getSet(deviceId).then(setSet).catch((e) => notify(e.message, true)),
    [deviceId, notify]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.devices().then((devices) => setDeviceCount(devices.length)).catch(() => setDeviceCount(1)); }, []);

  const put = (action: () => Promise<DeviceSet>, message: string) => {
    setBusy(true);
    action().then((next) => {
      setSet(next);
      notify(message);
      onChanged();
    }).catch((e) => notify(e.message, true)).finally(() => setBusy(false));
  };
  const selected = (kind: "looks" | "playlists", name: string) => set?.on_device[kind].includes(name) ?? true;
  const included = (kind: "looks" | "playlists", name: string) => set?.[kind].includes(name) ?? true;

  if (!set) return <p className="muted small">Reading what goes on {deviceName}…</p>;
  return (
    <section className="device-set-panel" aria-label="What goes on this device">
      <h2>What goes on {deviceName}</h2>
      {set.all ? (
        <>
          <p>Everything in the library goes on {deviceName}.</p>
          <button disabled={busy} onClick={() => put(
            () => api.putSet(deviceId, looks.map((look) => look.name), playlists.map((playlist) => playlist.name)),
            `${deviceName} now has its own set`,
          )}>Choose what goes on it</button>
        </>
      ) : (
        <>
          <p>{deviceName} has its own set: {set.looks.length} {set.looks.length === 1 ? "look" : "looks"} and {set.playlists.length} {set.playlists.length === 1 ? "playlist" : "playlists"}.</p>
          {set.brought.length > 0 && <p className="muted small">{set.brought.join("; ")}</p>}
          <button disabled={busy} onClick={() => put(() => api.putSet(deviceId, null), `Everything goes on ${deviceName} again`)}>
            Everything again
          </button>
          <div className="device-set-items">
            <div>
              <h3>Looks</h3>
              <ul className="set-list">
                {looks.map((look) => (
                  <li key={look.name}>
                    {deviceCount > 1 && (
                      <label className="set-check">
                        <input type="checkbox" aria-label={`Put ${look.name} on ${deviceName}`}
                          checked={selected("looks", look.name)}
                          disabled={busy || (selected("looks", look.name) && !included("looks", look.name))}
                          onChange={(event) => put(
                            () => event.target.checked
                              ? api.addToSet(deviceId, [look.name])
                              : api.removeFromSet(deviceId, [look.name]),
                            event.target.checked ? `Put “${look.name}” on ${deviceName}`
                              : `Don't put “${look.name}” on ${deviceName}`,
                          )} />
                        On {deviceName}
                      </label>
                    )}
                    <span className="grow">{look.name}</span>
                    {deviceCount === 1 && (!selected("looks", look.name)
                      ? <button disabled={busy} onClick={() => put(
                        () => api.addToSet(deviceId, [look.name]), `Put “${look.name}” on ${deviceName}`,
                      )}>Put on {deviceName}</button>
                      : <button disabled={busy || !included("looks", look.name)}
                        title={!included("looks", look.name) ? "Needed by a playlist in this set" : undefined}
                        onClick={() => put(
                          () => api.removeFromSet(deviceId, [look.name]), `Don't put “${look.name}” on ${deviceName}`,
                        )}>Don't put on {deviceName}</button>)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Playlists</h3>
              <ul className="set-list">
                {playlists.map((playlist) => (
                  <li key={playlist.name}>
                    {deviceCount > 1 && (
                      <label className="set-check">
                        <input type="checkbox" aria-label={`Put playlist ${playlist.name} on ${deviceName}`}
                          checked={selected("playlists", playlist.name)} disabled={busy}
                          onChange={(event) => put(
                            () => event.target.checked
                              ? api.addToSet(deviceId, [], [playlist.name])
                              : api.removeFromSet(deviceId, [], [playlist.name]),
                            event.target.checked ? `Put “${playlist.name}” on ${deviceName}`
                              : `Don't put “${playlist.name}” on ${deviceName}`,
                          )} />
                        On {deviceName}
                      </label>
                    )}
                    <span className="grow">{playlist.name}</span>
                    {deviceCount === 1 && (!included("playlists", playlist.name)
                      ? <button disabled={busy} onClick={() => put(
                        () => api.addToSet(deviceId, [], [playlist.name]), `Put “${playlist.name}” on ${deviceName}`,
                      )}>Put on {deviceName}</button>
                      : <button disabled={busy} onClick={() => put(
                        () => api.removeFromSet(deviceId, [], [playlist.name]), `Don't put “${playlist.name}” on ${deviceName}`,
                      )}>Don't put on {deviceName}</button>)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="muted small">Taking an item out of the set does not delete a preset already on the device.</p>
        </>
      )}
    </section>
  );
}
