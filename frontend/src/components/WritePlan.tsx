// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import type { PushReportItem, PushResult } from "../types";
import { Notes } from "./StatusBadge";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const label = (r: PushReportItem) => r.look ?? `▶ ${r.playlist}`;
const keyOf = (r: PushReportItem) => r.look ?? `pl:${r.playlist}`;
const onDevice = (r: PushReportItem) => (r.on_device === undefined ? "" : r.on_device ?? "empty");

/** What writing would do, grouped by outcome: written, already the same, skipped, waiting for a
 * decision, and preset ids two items want (which block the write). */
export function groupPlan(plan: PushResult) {
  const dupIds = new Set((plan.duplicates ?? []).map((d) => d.preset_id));
  const rows = plan.report;
  const clash = (r: PushReportItem) => r.preset_id !== undefined && dupIds.has(r.preset_id);
  const same = (r: PushReportItem) => !r.changed && (r.written || r.notes.includes("unchanged"));
  return {
    write: rows.filter((r) => !clash(r) && r.written && r.changed !== false),
    same: rows.filter((r) => !clash(r) && same(r)),
    skipped: rows.filter((r) => !clash(r) && r.status === "unavailable"),
    decide: rows.filter((r) => !clash(r) && r.status === "review" && !r.written),
    duplicates: plan.duplicates ?? [],
  };
}

interface Props {
  deviceId: string;
  deviceName: string;
  plan: PushResult;
  notify: (msg: string, error?: boolean) => void;
  /** After a write that went through (or was refused by the device or the drift check). */
  onWritten: (result: PushResult) => void;
  /** A write that failed (the device didn't answer, say): the message, shown where the write was. */
  onFailed?: (message: string) => void;
}

/** The write plan: what writing the library to the device would change, and the write itself. */
export function WritePlan({ deviceId, deviceName, plan, notify, onWritten, onFailed }: Props) {
  const [adopt, setAdopt] = useState(false);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const g = groupPlan(plan);
  // looks whose effect changed are written once ticked: they don't count in the dry run's ids
  const ticked = g.decide.filter((r) => r.look && accepted.has(r.look));
  const count = plan.changed_ids.length + ticked.length;
  const palettes = plan.palettes ?? [];
  const blocked = g.duplicates.length > 0;
  const nothing = count === 0 && palettes.length === 0;

  async function write() {
    setBusy(true);
    try {
      const r = await api.push(deviceId, { dry_run: false, adopt_drift: adopt, accept_review: ticked.map((x) => x.look!) });
      onWritten(r);
    } catch (e) {
      if (onFailed) onFailed((e as Error).message);
      else notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const table = (rows: PushReportItem[], extra?: (r: PushReportItem) => React.ReactNode) => (
    <table>
      <thead><tr><th>Look</th><th>Preset</th><th>On device now</th><th>Notes</th>{extra && <th />}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={keyOf(r)} className={`status-${r.status}`}>
            <td>{label(r)}</td><td>{r.preset_id ?? ""}</td><td>{onDevice(r)}</td>
            <td><Notes item={r} where={deviceName} /></td>
            {extra && <td>{extra(r)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const summary = blocked
    ? `Nothing is written to ${deviceName} while two items want the same preset id.`
    : nothing
      ? `Nothing to write: ${deviceName} already has what the library puts on it.`
      : [
        count ? `Writes ${plural(count, "preset")} to ${deviceName}` : `Writes no presets to ${deviceName}`,
        palettes.length ? ` and uploads ${plural(palettes.length, "palette")}` : "",
        ". Other presets on the device are kept. A backup of presets.json is taken first.",
      ].join("");

  return (
    <div className="plan" aria-label="Write plan">
      {plan.drift && <p className="warn">The device's presets changed since the last write (another tool or WLED's own UI).</p>}
      {g.duplicates.length > 0 && (
        <section className="plan-group blocking" aria-label="Two looks want the same preset id">
          <h3>Two looks want the same preset id ({g.duplicates.length})</h3>
          <ul>
            {g.duplicates.map((d) => (
              <li key={d.preset_id}>
                Preset {d.preset_id}: {[...d.looks.map((n) => `“${n}”`), ...d.playlists.map((n) => `playlist “${n}”`)].join(" and ")}
              </li>
            ))}
          </ul>
          <p className="small">Only one can be on the device. Give each its own preset id (click the preset id on a look's
            row to change it), then check again.</p>
        </section>
      )}
      {g.write.length > 0 && (
        <section className="plan-group" aria-label="Will be written">
          <h3>Will be written ({g.write.length})</h3>
          {table(g.write)}
        </section>
      )}
      {g.decide.length > 0 && (
        <section className="plan-group" aria-label="Needs your decision">
          <h3>Needs your decision: effect changed ({g.decide.length})</h3>
          <p className="small muted">The effect on {deviceName} has other controls than when the look was saved, so it may
            not look the same. Tick the ones to write anyway.</p>
          {table(g.decide, (r) => r.look && (
            <label className="small">
              <input type="checkbox" checked={accepted.has(r.look)} aria-label={`Write ${r.look} anyway`}
                onChange={() => setAccepted((s) => { const n = new Set(s); if (n.has(r.look!)) n.delete(r.look!); else n.add(r.look!); return n; })} />
              {" "}Write anyway
            </label>
          ))}
        </section>
      )}
      {g.skipped.length > 0 && (
        <details className="plan-group" aria-label="Skipped: not on this device">
          <summary>Skipped: not on this device ({g.skipped.length})</summary>
          {table(g.skipped)}
        </details>
      )}
      {g.same.length > 0 && (
        <details className="plan-group" aria-label="Already the same">
          <summary>Already the same ({g.same.length})</summary>
          {table(g.same)}
        </details>
      )}
      {palettes.length > 0 && (
        <p className="small">Palettes to upload: {palettes.map((p) => `${p.palette} (id ${p.id})`).join(", ")}</p>
      )}
      {plan.drift && <label className="small"><input type="checkbox" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} /> Write anyway (keeps the other changes)</label>}
      <p className="small plan-summary">{summary}</p>
      <div className="row">
        <button className="primary" disabled={busy || blocked || nothing || (plan.drift && !adopt)} onClick={write}>
          Write {plural(count, "preset")} to {deviceName}
        </button>
      </div>
    </div>
  );
}
