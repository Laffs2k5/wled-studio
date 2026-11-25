// SPDX-License-Identifier: EUPL-1.2
import { useId, useState } from "react";
import { api } from "../api";
import type { Device } from "../types";

/** An address as people paste it, made into the host[:port] the app stores: a leading http:// or
 * https:// and trailing slashes go. Anything else (a path, say) is left for the backend to refuse. */
export function normaliseHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** After adding: a read of the device, to say what was found ("Found: WLED 16.0.1, 60 LEDs"). */
export async function testConnection(d: Device): Promise<{ ok: boolean; text: string }> {
  try {
    const p = await api.profile(d.id);
    const ver = p.info.ver ? ` ${String(p.info.ver)}` : "";
    return { ok: true, text: `Added ${d.name}. Found: WLED${ver}, ${p.leds.count} LEDs.` };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, text: /does not answer/.test(msg)
      ? `Added ${d.name}, but it does not answer at ${d.host} yet. Check that it is powered and on the network, and that the address is right.`
      : `Added ${d.name}, but reading it failed: ${msg}` };
  }
}

interface Props {
  /** "card": the first-run card, labelled fields above each other; "bar": the header's compact form. */
  variant: "card" | "bar";
  onAdded: (d: Device) => void;
  notify: (msg: string, error?: boolean) => void;
}

/** Adding a WLED device: a name, its address and, if it has one, its settings PIN. Adding stores the
 * device in the app and reads it once to say what was found; nothing is sent to it. */
export function AddDevice({ variant, onAdded, notify }: Props) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const card = variant === "card";
  const id = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api.addDevice(name.trim(), normaliseHost(host), pin || undefined);
      setName(""); setHost(""); setPin("");
      onAdded(d);
      const found = await testConnection(d);
      notify(found.text, !found.ok);
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const fields = {
    name: <input id={`${id}-name`} aria-describedby={card ? `${id}-name-hint` : undefined} value={name} required maxLength={64} placeholder={card ? "e.g. Living room" : "Name"}
      aria-label={card ? undefined : "Device name"} onChange={(e) => setName(e.target.value)} />,
    host: <input id={`${id}-host`} aria-describedby={card ? `${id}-host-hint` : undefined} value={host} required placeholder={card ? "192.168.1.50 or wled.local" : "Address (IP or host name)"}
      aria-label={card ? undefined : "Address (IP or host name)"} autoCapitalize="off" spellCheck={false}
      onChange={(e) => setHost(e.target.value)} />,
    pin: <input id={`${id}-pin`} aria-describedby={card ? `${id}-pin-hint` : undefined} value={pin} type="password" autoComplete="off" maxLength={16} placeholder={card ? "" : "Settings PIN (optional)"}
      aria-label={card ? undefined : "Settings PIN (optional)"} onChange={(e) => setPin(e.target.value)} />,
  };

  if (!card) {
    return (
      <form className="row add-device-bar" onSubmit={submit} aria-label="Add a device">
        {fields.name}{fields.host}{fields.pin}
        <button className="primary" disabled={busy}>Add</button>
        <span className="muted small">Adding only reads the device.</span>
      </form>
    );
  }
  return (
    <form className="add-device-card" onSubmit={submit} aria-label="Add your WLED controller">
      <h2>Add your WLED controller</h2>
      <p className="muted small">wled-studio works with WLED devices on your network. Add one to start.</p>
      <div className="field">
        <label htmlFor={`${id}-name`}>Device name</label>
        {fields.name}
        <small id={`${id}-name-hint`} className="muted">Any name; it's what the app calls the device.</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-host`}>Address (IP or host name)</label>
        {fields.host}
        <small id={`${id}-host-hint`} className="muted">For example 192.168.1.50 or wled.local, with :port if it isn't 80.
          A pasted http://… address is fine.</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-pin`}>Settings PIN (optional)</label>
        {fields.pin}
        <small id={`${id}-pin-hint`} className="muted">Only if you set one in WLED under Security. Used to unlock the device
          before writing presets or firmware.</small>
      </div>
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
      </div>
      <p className="muted small">Adding only reads the device: nothing on it changes.</p>
    </form>
  );
}
