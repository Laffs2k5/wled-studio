// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { api, type FirmwareHistoryItem } from "../api";
import type { Profile } from "../types";
import { when } from "../time";

export function DeviceHome({ deviceId, profile, lastPresetWrite }: {
  deviceId: string;
  profile: Profile;
  lastPresetWrite?: string | null;
}) {
  const [history, setHistory] = useState<FirmwareHistoryItem[]>([]);
  const [failed, setFailed] = useState("");
  const [written, setWritten] = useState<string | null>(lastPresetWrite ?? null);
  useEffect(() => {
    api.firmwareHistory(deviceId).then(setHistory).catch((e) => setFailed(e.message));
    api.lastPresetWrite(deviceId).then((value) => setWritten(value.last_write)).catch((e) => setFailed(e.message));
  }, [deviceId]);
  return (
    <section className="device-home" aria-label="Device status">
      <h2>{profile.device.name}</h2>
      <p className="small">
        Reachable · WLED {String(profile.info.ver ?? "?")}{profile.info.release ? ` (${profile.info.release})` : ""}
        {" · "}{profile.leds.count} LEDs{profile.info.arch === "virtual" ? " · virtual, no LEDs" : ""}
      </p>
      <p className="small muted">Presets last written by this app: {written ? new Date(written).toLocaleString() : "not yet"}.</p>
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
