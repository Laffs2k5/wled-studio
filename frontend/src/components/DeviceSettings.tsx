// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import type { Device } from "../types";
import { normaliseHost } from "./AddDevice";
import { RoomEditor } from "./RoomEditor";

type Where = "address" | "pin" | "remove";

interface Props {
  device: Device;
  /** Open with the room shape unfolded and in view (from "Set the room shape…" elsewhere). */
  focus?: "room" | "address" | null;
  onClose: () => void;
  /** The device list changed (name, address, PIN): read it again. */
  onChanged: () => void;
  /** The device was removed from the app. */
  onRemoved: () => void;
  /** The room shape was saved: views that draw it read it again. */
  onRoomSaved: () => void;
  notify: (msg: string, error?: boolean) => void;
}

/** One device's settings in the app: its name and address, its settings PIN, its room shape, and
 * removing it. None of this is sent to the device. */
export function DeviceSettings({ device, focus = null, onClose, onChanged, onRemoved, onRoomSaved, notify }: Props) {
  const id = useId();
  const [name, setName] = useState(device.name);
  const [host, setHost] = useState(device.host);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // the result of the last action here, until the next one
  const [result, setResult] = useState<{ where: Where; text: string; error: boolean } | null>(null);
  const [ledCount, setLedCount] = useState<number | undefined>(undefined);
  const roomRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLInputElement>(null);

  // the list read again after a save: the fields follow it, the result line stays
  useEffect(() => { setName(device.name); setHost(device.host); }, [device.name, device.host]);
  // the LED count, for the room shape's "n of m LEDs" (unknown while the device doesn't answer)
  useEffect(() => {
    let live = true;
    setLedCount(undefined);
    api.profile(device.id).then((p) => { if (live) setLedCount(p.leds.count); }).catch(() => {});
    return () => { live = false; };
  }, [device.id, device.host]);
  useEffect(() => {
    if (focus === "room") roomRef.current?.scrollIntoView?.({ block: "nearest" });
    if (focus === "address") hostRef.current?.focus();
  }, [focus]);

  async function run(where: Where, f: () => Promise<string>) {
    setBusy(true);
    setResult(null);
    try {
      setResult({ where, text: await f(), error: false });
    } catch (e) {
      setResult({ where, text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  const outcome = (where: Where) => result && result.where === where && result.text ? (
    <p className={`small action-result ${result.error ? "error" : "done"}`} role={result.error ? "alert" : "status"}>{result.text}</p>
  ) : null;

  const changed = name.trim() !== device.name || normaliseHost(host) !== device.host;

  return (
    <section className="device-settings" aria-label="Device settings">
      <div className="row">
        <h2 className="grow">Device settings: {device.name}</h2>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="muted small">Kept in this app. Nothing here is sent to the device.</p>

      <form className="settings-group" onSubmit={(e) => {
        e.preventDefault();
        run("address", async () => {
          const body: { name?: string; host?: string } = {};
          if (name.trim() !== device.name) body.name = name.trim();
          if (normaliseHost(host) !== device.host) body.host = normaliseHost(host);
          const d = await api.editDevice(device.id, body);
          onChanged();
          return body.host ? `Saved. The app now looks for ${d.name} at ${d.host}.` : `Saved: the app calls it ${d.name}.`;
        });
      }}>
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} value={name} required maxLength={64} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-host`}>Address (IP or host name)</label>
          <input id={`${id}-host`} ref={hostRef} value={host} required autoCapitalize="off" spellCheck={false}
            aria-describedby={`${id}-host-hint`} onChange={(e) => setHost(e.target.value)} />
          <small id={`${id}-host-hint`} className="muted">For example 192.168.1.50 or wled.local, with :port if it isn't 80.
            Change it when the device got a new address.</small>
        </div>
        <div className="row">
          <button className="primary" disabled={busy || !changed || !name.trim() || !host.trim()}>Save name and address</button>
        </div>
        {outcome("address")}
      </form>

      <div className="settings-group" role="group" aria-labelledby={`${id}-pin-h`}>
        <h3 id={`${id}-pin-h`}>Settings PIN</h3>
        <p className="muted small" id={`${id}-pin-hint`}>
          WLED's settings PIN, if you set one (in WLED under Security). Needed to write presets, palettes and firmware.{" "}
          {device.has_pin ? "A PIN is stored in the app." : "No PIN is stored in the app."}
        </p>
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          run("pin", async () => {
            await api.setPin(device.id, pin);
            setPin("");
            onChanged();
            return "PIN saved in the app.";
          });
        }}>
          <label className="sr-only" htmlFor={`${id}-pin`}>{device.has_pin ? "New settings PIN" : "Settings PIN"}</label>
          <input id={`${id}-pin`} type="password" value={pin} autoComplete="off" maxLength={16}
            placeholder={device.has_pin ? "New PIN" : "PIN"} aria-describedby={`${id}-pin-hint`}
            onChange={(e) => setPin(e.target.value)} />
          <button className="primary" disabled={busy || !pin}>Save PIN</button>
          {device.has_pin && (
            <button type="button" disabled={busy} onClick={() => run("pin", async () => {
              await api.setPin(device.id, null);
              onChanged();
              return "PIN removed from the app. The device keeps its own PIN.";
            })}>Remove PIN</button>
          )}
        </form>
        {outcome("pin")}
      </div>

      <div className="settings-group" ref={roomRef}>
        <RoomEditor deviceId={device.id} ledCount={ledCount} notify={notify} defaultOpen={focus === "room"}
          onSaved={onRoomSaved} />
      </div>

      <div className="settings-group">
        {!confirmRemove ? (
          <button className="danger" disabled={busy} onClick={() => { setConfirmRemove(true); setResult(null); }}>Remove device…</button>
        ) : (
          <div className="keep-confirm" role="alertdialog" aria-label={`Remove ${device.name}?`}>
            <p><strong>Remove {device.name} from wled-studio?</strong></p>
            <p className="small">
              The app forgets it: its address, the PIN stored here, its room shape, which looks go on it, and the
              app's record of what it last wrote and flashed there.
            </p>
            <p className="small">
              Nothing on the device changes: its presets, settings and firmware stay as they are. The looks,
              playlists and palettes in the library stay too. Backups of its presets stay in the app's data folder.
            </p>
            <div className="row">
              <button className="danger" disabled={busy} onClick={() => run("remove", async () => {
                await api.removeDevice(device.id);
                notify(`Removed ${device.name} from the app. Nothing on the device changed.`);
                onRemoved();
                return "";
              })}>Remove {device.name}</button>
              <button onClick={() => setConfirmRemove(false)}>Cancel</button>
            </div>
          </div>
        )}
        {outcome("remove")}
      </div>
    </section>
  );
}
