// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, type DeviceSet, type EffectReplacement } from "../api";
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
  const [suggestions, setSuggestions] = useState<Record<string, EffectReplacement[]>>({});
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
                const key = `${device.id}:${look.name}`;
                const replacements = suggestions[key];
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
                    {status?.status === "unavailable" && !replacements && (
                      <button className="small" onClick={() => {
                        setBusy(`suggest:${key}`);
                        api.effectReplacements(device.id, look.name).then((result) => {
                          setSuggestions((current) => ({ ...current, [key]: result.replacements }));
                        }).catch((e) => notify(e.message, true)).finally(() => setBusy(""));
                      }} disabled={busy === `suggest:${key}`}>Find nearest effects</button>
                    )}
                    {replacements?.map((replacement) => (
                      <div className="effect-replacements" key={replacement.old}>
                        <p className="small warn">“{replacement.old}” is missing on {device.name}.</p>
                        {replacement.choices.map((choice) => (
                          <button key={choice.name} className="small" disabled={busy === `replace:${key}`}
                            title={`Name similarity ${Math.round(choice.score * 100)} percent. This explicitly changes the shared look.`}
                            onClick={() => {
                              if (!window.confirm(
                                `Replace “${replacement.old}” with “${choice.name}” in the shared look “${look.name}”? ` +
                                `This affects every device set that uses this look.`
                              )) return;
                              setBusy(`replace:${key}`);
                              api.replaceEffect(device.id, look.name, replacement.old, choice.name).then(() => {
                                notify(`Replaced “${replacement.old}” with “${choice.name}” in “${look.name}” across the shared library`);
                                setSuggestions((current) => ({ ...current, [key]: [] }));
                                onChanged();
                                return load();
                              }).catch((e) => notify(e.message, true)).finally(() => setBusy(""));
                            }}>
                            Use {choice.name}
                          </button>
                        ))}
                      </div>
                    ))}
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
