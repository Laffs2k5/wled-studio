// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import type { Look, PushResult } from "../types";

interface Props {
  deviceId: string;
  looks: Look[];
  onChanged: () => void;
  onApplied: () => void;
  notify: (msg: string, error?: boolean) => void;
}

export function Looks({ deviceId, looks, onChanged, onApplied, notify }: Props) {
  const [name, setName] = useState("");
  const [slot, setSlot] = useState("");
  const [plan, setPlan] = useState<PushResult | null>(null);
  const [adopt, setAdopt] = useState(false);
  const [acceptReview, setAcceptReview] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run<T>(f: () => Promise<T>, ok?: (v: T) => string) {
    setBusy(true);
    try {
      const v = await f();
      if (ok) notify(ok(v));
      return v;
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="looks" aria-label="Looks">
      <h2>Looks</h2>
      <div className="row">
        <button disabled={busy} onClick={() => run(() => api.importPresets(deviceId),
          (r) => `Imported ${r.imported.length}, kept ${r.kept_existing.length} existing`).then(onChanged)}>
          Import from device
        </button>
      </div>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        run(() => api.capture(deviceId, name, slot ? Number(slot) : undefined), (l) => `Saved “${l.name}”`)
          .then(() => { setName(""); onChanged(); });
      }}>
        <input placeholder="Name" value={name} maxLength={32} required aria-label="Look name"
          onChange={(e) => setName(e.target.value)} />
        <input placeholder="Slot" value={slot} inputMode="numeric" pattern="[0-9]*" aria-label="Preset slot"
          className="slot" onChange={(e) => setSlot(e.target.value)} />
        <button disabled={busy || !name.trim()}>Save current</button>
      </form>
      <ul className="look-list">
        {looks.map((l) => (
          <li key={l.name}>
            <span className="name">{l.name}</span>
            <span className="muted small">{l.preset_id ? `slot ${l.preset_id}` : "no slot"}</span>
            {l.mic !== undefined && <span className="badge" title={l.mic ? "Mic on" : "Mic off"}>{l.mic ? "♪" : "–"}</span>}
            <button disabled={busy} onClick={() => run(() => api.apply(deviceId, l.name), (r) => `Showing “${l.name}” (${r.status})`).then(onApplied)}>
              Show
            </button>
            <button disabled={busy} className="danger" aria-label={`Delete ${l.name}`}
              onClick={() => confirm(`Delete “${l.name}” from the library?`) && run(() => api.deleteLook(l.name)).then(onChanged)}>
              ×
            </button>
          </li>
        ))}
        {looks.length === 0 && <li className="muted">No looks yet. Import the device's presets, or save what it shows.</li>}
      </ul>

      <h2>Write to device</h2>
      <div className="row">
        <button disabled={busy} onClick={() => run(() => api.push(deviceId, { dry_run: true })).then((p) => p && setPlan(p))}>
          Check what would change
        </button>
      </div>
      {plan && (
        <div className="plan">
          {plan.drift && <p className="warn">The device's presets changed since the last write (another tool or WLED's own UI).</p>}
          <table>
            <thead><tr><th>Look</th><th>Slot</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              {plan.report.map((r) => (
                <tr key={r.look ?? `pl:${r.playlist}`} className={`status-${r.status}`}>
                  <td>{r.look ?? `▶ ${r.playlist}`}</td><td>{r.preset_id ?? ""}</td><td>{r.status}</td><td>{r.notes.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">Slots that would change: {plan.changed_ids.length ? plan.changed_ids.join(", ") : "none"}</p>
          {plan.palettes && plan.palettes.length > 0 && (
            <p className="small">Palettes to upload: {plan.palettes.map((p) => `${p.palette} (id ${p.id})`).join(", ")}</p>
          )}
          {plan.drift && <label className="small"><input type="checkbox" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} /> Write anyway (keeps the other changes)</label>}
          {plan.report.some((r) => r.status === "review") && <label className="small"><input type="checkbox" checked={acceptReview} onChange={(e) => setAcceptReview(e.target.checked)} /> Write looks marked “review” too</label>}
          <div className="row">
            <button className="primary" disabled={busy || (plan.changed_ids.length === 0 && !plan.palettes?.length) || (plan.drift && !adopt)}
              onClick={() => run(() => api.push(deviceId, { dry_run: false, adopt_drift: adopt, accept_review: acceptReview }),
                (r) => (r.done ? `Written and verified (backup ${r.backup})` : `Not written: ${r.reason}`))
                .then((r) => r && setPlan(null))}>
              Write {plan.changed_ids.length} slot(s)
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
