// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { api } from "../api";
import { folders, groupByFolder, moveWithin, sortWithin } from "../organise";
import type { CheckItem, Look, Playlist, PushResult } from "../types";
import { ACCEPTABLE, StatusBadge } from "./StatusBadge";

interface Props {
  deviceId: string;
  looks: Look[];
  onChanged: () => void;
  onApplied: () => void;
  notify: (msg: string, error?: boolean) => void;
  /** Called (and awaited) before anything that reads or changes the device: flushes held-back live edits. */
  beforeAction?: () => Promise<void>;
  /** Each look's change-check status on this device. */
  checks?: CheckItem[];
  /** Open a look in the editor (edited in the library, not on the strip). */
  onEdit?: (name: string) => void;
  /** To show where each look is used. */
  playlists?: Playlist[];
}

export function Looks({ deviceId, looks, onChanged, onApplied, notify, beforeAction, checks = [], onEdit, playlists = [] }: Props) {
  const usedIn = (name: string) => playlists.filter((p) => p.entries.some((e) => e.look === name) || p.end === name).map((p) => p.name);
  const status = new Map(checks.filter((c) => c.look).map((c) => [c.look as string, c]));
  const [name, setName] = useState("");
  const [slot, setSlot] = useState("");
  const [plan, setPlan] = useState<PushResult | null>(null);
  const [adopt, setAdopt] = useState(false);
  const [acceptReview, setAcceptReview] = useState(false);
  const [keepLayout, setKeepLayout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const order = looks.map((l) => l.name);
  const known = folders(looks);
  const toggle = (set: Set<string>, key: string) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n; };

  // folders and order are library-only: they don't touch the device
  async function organise<T>(f: () => Promise<T>, ok?: string) {
    setBusy(true);
    try {
      await f();
      if (ok) notify(ok);
      onChanged();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  function moveSelected() {
    let folder: string | null = moveTo === "\u0000none" ? null : moveTo;
    if (moveTo === "\u0000new") {
      folder = prompt("New folder name")?.trim() || "";
      if (!folder) return;
    }
    const names = order.filter((n) => selected.has(n));
    organise(() => api.setFolder("looks", names, folder), `Moved ${names.length} to ${folder ? `“${folder}”` : "no folder"}`)
      .then(() => { setSelected(new Set()); setMoveTo(""); });
  }

  async function run<T>(f: () => Promise<T>, ok?: (v: T) => string) {
    setBusy(true);
    try {
      await beforeAction?.();
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
        run(() => api.capture(deviceId, name, slot ? Number(slot) : undefined, keepLayout), (l) => `Saved “${l.name}”`)
          .then(() => { setName(""); onChanged(); });
      }}>
        <input placeholder="Name" value={name} maxLength={32} required aria-label="Look name"
          onChange={(e) => setName(e.target.value)} />
        <input placeholder="Slot" value={slot} inputMode="numeric" pattern="[0-9]*" aria-label="Preset slot"
          className="slot" onChange={(e) => setSlot(e.target.value)} />
        <button disabled={busy || !name.trim()}>Save current</button>
        <label className="small" title="Save effects and colours only: showing the look then leaves the segments as they are">
          <input type="checkbox" checked={keepLayout} onChange={(e) => setKeepLayout(e.target.checked)} /> Without the layout
        </label>
      </form>
      {selected.size > 0 && (
        <div className="row bulk" aria-label="Selected looks">
          <span className="small">{selected.size} selected:</span>
          <select aria-label="Move the selected looks to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Move to…</option>
            {known.map((f) => <option key={f} value={f}>{f}</option>)}
            <option value={"\u0000new"}>A new folder…</option>
            <option value={"\u0000none"}>No folder</option>
          </select>
          <button disabled={busy || !moveTo} onClick={moveSelected}>Move</button>
          <button onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}
      {groupByFolder(looks).map(({ folder, items }) => {
        const group = items.map((x) => x.name);
        const key = folder ?? "";
        const open = !closed.has(key);
        return (
          <div key={key} className="look-group">
            {known.length > 0 && (
              <div className="row group-head">
                <button className="link" aria-expanded={open} onClick={() => setClosed(toggle(closed, key))}>
                  {open ? "▾" : "▸"} {folder ?? "Not in a folder"} ({items.length})
                </button>
                <button className="small" disabled={busy || items.length < 2} title="Sort this group A–Z"
                  onClick={() => organise(() => api.setOrder("looks", sortWithin(order, group)), "Sorted A–Z")}>A–Z</button>
                {folder && <button className="small" disabled={busy} aria-label={`Rename folder ${folder}`} onClick={() => {
                  const to = prompt(`New name for the folder “${folder}”`, folder)?.trim();
                  if (to && to !== folder) organise(() => api.renameFolder(folder, to), `Renamed to “${to}”`);
                }}>✎</button>}
                {folder && <button className="small" disabled={busy} aria-label={`Dissolve folder ${folder}`}
                  title="Take its looks and playlists out of the folder (nothing is deleted)"
                  onClick={() => confirm(`Dissolve the folder “${folder}”? Its looks and playlists stay, in no folder.`)
                    && organise(() => api.renameFolder(folder, null), "Folder dissolved")}>×</button>}
              </div>
            )}
            {open && (
              <ul className="look-list">
                {items.map((l, i) => (
              <li key={l.name}>
                <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.name)}
                  onChange={() => setSelected(toggle(selected, l.name))} />
                <span className="order">
                  <button disabled={busy || i === 0} aria-label={`Move ${l.name} up`} title="Up"
                    onClick={() => organise(() => api.setOrder("looks", moveWithin(order, group, l.name, -1)))}>▲</button>
                  <button disabled={busy || i === group.length - 1} aria-label={`Move ${l.name} down`} title="Down"
                    onClick={() => organise(() => api.setOrder("looks", moveWithin(order, group, l.name, 1)))}>▼</button>
                </span>
                <span className="name">{l.name}</span>
                <span className="muted small">{l.preset_id ? `slot ${l.preset_id}` : "no slot"}</span>
                {l.segments.some((s) => s.wall) && (
                  <span className="muted small" title="Follows these walls of the room model">
                    {[...new Set(l.segments.map((s) => s.wall).filter(Boolean))].join(" · ")}
                  </span>
                )}
                {l.mic !== undefined && <span className="badge" title={l.mic ? "Mic on" : "Mic off"}>{l.mic ? "♪" : "–"}</span>}
                {usedIn(l.name).length > 0 && (
                  <span className="badge" title={`In ${usedIn(l.name).join(", ")}`}>▶{usedIn(l.name).length}</span>
                )}
                <StatusBadge item={status.get(l.name)} />
                {ACCEPTABLE.has(status.get(l.name)?.status ?? "ok") && (
                  <button disabled={busy} title="Take the device's version of this look's effects as the new reference"
                    onClick={() => confirm(`Accept the device's version of the effects in “${l.name}”?\n\n${status.get(l.name)?.notes.join("\n")}`)
                      && run(() => api.accept(deviceId, l.name), (r) => `Accepted “${l.name}” (now ${r.status})`).then(onChanged)}>
                    Accept
                  </button>
                )}
                <button disabled={busy} onClick={() => run(() => api.apply(deviceId, l.name), (r) => `Showing “${l.name}” (${r.status})`).then(onApplied)}>
                  Show
                </button>
                {onEdit && (
                  <button disabled={busy} aria-label={`Edit ${l.name}`} title="Edit it in the library, without showing it"
                    onClick={() => onEdit(l.name)}>Edit</button>
                )}
                <button disabled={busy} aria-label={`Rename ${l.name}`} title="Rename; playlists that use it follow"
                  onClick={() => {
                    const to = prompt(`New name for “${l.name}”`, l.name)?.trim();
                    if (to && to !== l.name) run(() => api.renameLook(l.name, to), (r) => `Renamed to “${r.name}”`).then(onChanged);
                  }}>✎</button>
                <button disabled={busy} className="danger" aria-label={`Delete ${l.name}`}
                  onClick={() => confirm(`Delete “${l.name}” from the library?`) && run(() => api.deleteLook(l.name)).then(onChanged)}>
                  ×
                </button>
              </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {looks.length === 0 && <p className="muted">No looks yet. Import the device's presets, or save what it shows.</p>}

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
