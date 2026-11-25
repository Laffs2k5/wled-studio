// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, type DeviceSet } from "../api";
import type { CheckItem, Device, Look } from "../types";
import { StatusBadge } from "./StatusBadge";

type Compared = { device: Device; checks: CheckItem[]; set: DeviceSet };

export function CrossDevice({ current, looks, notify, onChanged }: {
  current: string;
  looks: Look[];
  notify: (message: string, error?: boolean) => void;
  onChanged: () => void;
}) {
  const [others, setOthers] = useState<Compared[]>([]);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const devices = await api.devices();
    const targets = devices.filter((device) => device.id !== current);
    const rows = await Promise.all(targets.map(async (device) => ({
      device,
      checks: await api.check(device.id).catch(() => [] as CheckItem[]),
      set: await api.getSet(device.id),
    })));
    setOthers(rows);
  }, [current]);
  useEffect(() => { load().catch((e) => notify(e.message, true)); }, [load, notify]);

  if (others.length === 0) return null;
  return (
    <section className="cross-device" aria-label="Compare devices">
      <h2>Compare devices</h2>
      <p className="muted small">A comparison only. Putting a look in another device's set does not write presets to it.</p>
      <table className="compare-devices">
        <thead><tr><th>Look</th>{others.map(({ device }) => <th key={device.id}>{device.name}</th>)}</tr></thead>
        <tbody>
          {looks.map((look) => (
            <tr key={look.name}>
              <th scope="row">{look.name}</th>
              {others.map(({ device, checks, set }) => {
                const status = checks.find((item) => item.look === look.name);
                const selected = set.all || set.on_device.looks.includes(look.name);
                const forced = selected && !set.all && !set.looks.includes(look.name);
                return (
                  <td key={device.id}>
                    <StatusBadge item={status} where={device.name} />
                    <div className="small muted">{selected ? (forced ? "needed by playlist" : "on device set") : "not in device set"}</div>
                    {!selected && (
                      <button className="small" disabled={busy === `${device.id}:${look.name}`}
                        onClick={() => {
                          setBusy(`${device.id}:${look.name}`);
                          api.addToSet(device.id, [look.name]).then(() => {
                            notify(`Put “${look.name}” on ${device.name}'s set (not written yet)`);
                            onChanged();
                            return load();
                          }).catch((e) => notify(e.message, true)).finally(() => setBusy(""));
                        }}>Put in {device.name}'s set</button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
