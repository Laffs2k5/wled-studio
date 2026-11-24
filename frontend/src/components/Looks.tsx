// SPDX-License-Identifier: EUPL-1.2
import { deviceLabel } from "../devices";
import { useCallback, useEffect, useState } from "react";
import { api, type DeviceSet } from "../api";
import { folders, groupByFolder, moveWithin, sortWithin } from "../organise";
import type { CheckItem, Device, Look, Playlist, PushResult } from "../types";
import { ACCEPTABLE, explain, StatusBadge } from "./StatusBadge";

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
  // a look whose effect (or palette, or wall) this device lacks can't be shown or edited here
  const showable = (name: string) => status.get(name)?.status !== "unavailable";
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
  const [copyTo, setCopyTo] = useState("");
  const [set, setSet] = useState<DeviceSet | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const loadSet = useCallback(() => api.getSet(deviceId)
    .then((s) => setSet(s && Array.isArray(s.looks) && s.on_device ? s : null)).catch(() => setSet(null)), [deviceId]);
  useEffect(() => {
    loadSet();
    api.devices().then((d) => setDevices(Array.isArray(d) ? d : [])).catch(() => setDevices([]));
  }, [loadSet, looks]);
  const onDevice = (n: string) => !set || set.all || set.on_device.looks.includes(n);
  const chosen = (n: string) => !!set && !set.all && set.looks.includes(n);
  const deviceName = devices.find((d) => d.id === deviceId)?.name ?? deviceId;
  const others = devices.filter((d) => d.id !== deviceId);
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
  function changeSet(f: () => Promise<DeviceSet>, ok: string) {
    setBusy(true);
    f().then((s) => { setSet(s); notify(ok); }).catch((e) => notify((e as Error).message, true)).finally(() => setBusy(false));
  }
  function copySelected() {
    const target = others.find((d) => d.id === copyTo);
    if (!target) return;
    const names = order.filter((n) => selected.has(n));
    setBusy(true);
    api.addToSet(target.id, names).then((s) => {
      notify(s.all ? `${target.name} takes everything in the library already` : `Copied ${names.length} to ${target.name}'s set`);
      setCopyTo("");
    }).catch((e) => notify((e as Error).message, true)).finally(() => setBusy(false));
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
      <p className="muted small library-line">Library: kept in the app, shared by all devices. Nothing here is on a device until you write presets.</p>
      <div className="row">
        <button disabled={busy} onClick={() => run(() => api.importPresets(deviceId),
          (r) => `Imported ${r.imported.length} preset${r.imported.length === 1 ? "" : "s"} from ${deviceName} into the library, kept ${r.kept_existing.length} existing`).then(onChanged)}>
          Import from device
        </button>
      </div>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        run(() => api.capture(deviceId, name, slot ? Number(slot) : undefined, keepLayout), (l) => `Saved “${l.name}” in the library (not on the device yet)`)
          // only a saved look clears the form: the preset id too, so the next look doesn't land on the
          // same preset; after a failure both stay, to fix and try again
          .then((l) => { if (!l) return; setName(""); setSlot(""); onChanged(); });
      }}>
        <input placeholder="Name" value={name} maxLength={32} required aria-label="Look name"
          onChange={(e) => setName(e.target.value)} />
        <input placeholder="Preset id (1-250)" value={slot} inputMode="numeric" pattern="[0-9]*" aria-label="Preset id"
          className="preset-id" title="The WLED preset this look is written to; without one it stays in the library only" onChange={(e) => setSlot(e.target.value)} />
        <button disabled={busy || !name.trim()}>Save current</button>
        <label className="small" title="Save effects and colours only: showing the look then leaves the segments as they are">
          <input type="checkbox" checked={keepLayout} onChange={(e) => setKeepLayout(e.target.checked)} /> Without the layout
        </label>
      </form>
      {set && (
        <div className="row device-set small" aria-label="What goes on this device">
          {set.all ? (
            <>
              <span>Everything in the library goes on {deviceName}.</span>
              <button className="small" disabled={busy} onClick={() => changeSet(() => api.putSet(deviceId, order, []),
                `${deviceName} now has its own set`)}>Choose what goes on it</button>
            </>
          ) : (
            <>
              <span>{deviceName} has its own set: {set.looks.length} looks, {set.playlists.length} playlists{set.brought.length ? ` (${set.brought.join("; ")})` : ""}.</span>
              <button className="small" disabled={busy} onClick={() => changeSet(() => api.putSet(deviceId, null),
                `Everything goes on ${deviceName} again`)}>Everything again</button>
              <span className="muted">Taking a look out doesn't remove it from the device: writing never deletes presets.</span>
            </>
          )}
        </div>
      )}
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
          {others.length > 0 && (
            <>
              <select aria-label="Copy the selected looks to device" value={copyTo} onChange={(e) => setCopyTo(e.target.value)}>
                <option value="">Copy to device…</option>
                {others.map((d) => <option key={d.id} value={d.id}>{deviceLabel(d)}</option>)}
              </select>
              <button disabled={busy || !copyTo} onClick={copySelected}>Copy</button>
            </>
          )}
          <button disabled={busy} onClick={() => changeSet(() => api.removeFromSet(deviceId, order.filter((n) => selected.has(n))),
            `Took ${selected.size} off ${deviceName}'s set`)}>Take off this device</button>
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
              <li key={l.name} className={onDevice(l.name) ? "" : "off-device"}>
                <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.name)}
                  onChange={() => setSelected(toggle(selected, l.name))} />
                <span className="order">
                  <button disabled={busy || i === 0} aria-label={`Move ${l.name} up`} title="Up"
                    onClick={() => organise(() => api.setOrder("looks", moveWithin(order, group, l.name, -1)))}>▲</button>
                  <button disabled={busy || i === group.length - 1} aria-label={`Move ${l.name} down`} title="Down"
                    onClick={() => organise(() => api.setOrder("looks", moveWithin(order, group, l.name, 1)))}>▼</button>
                </span>
                <span className="name">{l.name}</span>
                {set && !set.all && (onDevice(l.name)
                  ? (chosen(l.name)
                    ? <button className="small" disabled={busy} aria-label={`Take ${l.name} off this device`} title={`Take it out of ${deviceName}'s set`}
                        onClick={() => changeSet(() => api.removeFromSet(deviceId, [l.name]), `Took “${l.name}” off ${deviceName}'s set`)}>−</button>
                    : <span className="badge" title="On this device because a playlist in its set plays it">via playlist</span>)
                  : <button className="small" disabled={busy} aria-label={`Add ${l.name} to this device`} title={`Add it to ${deviceName}'s set`}
                      onClick={() => changeSet(() => api.addToSet(deviceId, [l.name]), `Added “${l.name}” to ${deviceName}'s set`)}>＋</button>)}
                <span className="muted small">{l.preset_id ? `preset ${l.preset_id}` : "no preset id"}</span>
                {l.segments.some((s) => s.wall) && (
                  <span className="muted small" title="Follows these walls of the room model">
                    {[...new Set(l.segments.map((s) => s.wall).filter(Boolean))].join(" · ")}
                  </span>
                )}
                {l.mic !== undefined && <span className="badge" title={l.mic ? "Mic on" : "Mic off"}>{l.mic ? "♪" : "–"}</span>}
                {usedIn(l.name).length > 0 && (
                  <span className="badge" title={`In ${usedIn(l.name).join(", ")}`}>▶{usedIn(l.name).length}</span>
                )}
                <StatusBadge item={status.get(l.name)} where={deviceName} />
                {ACCEPTABLE.has(status.get(l.name)?.status ?? "ok") && (
                  <button disabled={busy} title="Take the device's version of this look's effects as the new reference"
                    onClick={() => confirm(`Accept the device's version of the effects in “${l.name}”?\n\n${status.get(l.name)?.notes.join("\n")}`)
                      && run(() => api.accept(deviceId, l.name), (r) => `Accepted “${l.name}” (now ${r.status})`).then(onChanged)}>
                    Accept
                  </button>
                )}
                <button disabled={busy || !showable(l.name)} title={showable(l.name) ? "Show it on the strip now" : explain(status.get(l.name), deviceName)}
                  onClick={() => run(() => api.apply(deviceId, l.name), (r) => `Showing “${l.name}” on ${deviceName}${r.status === "ok" ? "" : ` (${r.status})`}`).then(onApplied)}>
                  Show
                </button>
                {onEdit && (
                  <button disabled={busy || !showable(l.name)} aria-label={`Edit ${l.name}`}
                    title={showable(l.name) ? "Edit it in the library, without showing it" : explain(status.get(l.name), deviceName)}
                    onClick={() => onEdit(l.name)}>Edit</button>
                )}
                <button disabled={busy} aria-label={`Rename ${l.name}`} title="Rename; playlists that use it follow"
                  onClick={() => {
                    const to = prompt(`New name for “${l.name}”`, l.name)?.trim();
                    if (to && to !== l.name) run(() => api.renameLook(l.name, to), (r) => `Renamed to “${r.name}” in the library`).then(onChanged);
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
            <thead><tr><th>Look</th><th>Preset</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              {plan.report.map((r) => (
                <tr key={r.look ?? `pl:${r.playlist}`} className={`status-${r.status}`}>
                  <td>{r.look ?? `▶ ${r.playlist}`}</td><td>{r.preset_id ?? ""}</td><td>{r.status === "unavailable" ? "not on this device" : r.status}</td><td>{r.notes.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">Presets that would change: {plan.changed_ids.length ? plan.changed_ids.join(", ") : "none"}</p>
          {plan.palettes && plan.palettes.length > 0 && (
            <p className="small">Palettes to upload: {plan.palettes.map((p) => `${p.palette} (id ${p.id})`).join(", ")}</p>
          )}
          {plan.drift && <label className="small"><input type="checkbox" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} /> Write anyway (keeps the other changes)</label>}
          {plan.report.some((r) => r.status === "review") && <label className="small"><input type="checkbox" checked={acceptReview} onChange={(e) => setAcceptReview(e.target.checked)} /> Write looks marked “review” too</label>}
          <div className="row">
            <button className="primary" disabled={busy || (plan.changed_ids.length === 0 && !plan.palettes?.length) || (plan.drift && !adopt)}
              onClick={() => run(() => api.push(deviceId, { dry_run: false, adopt_drift: adopt, accept_review: acceptReview }),
                (r) => (r.done ? `Written to ${deviceName} and verified (backup ${r.backup})` : `Not written to ${deviceName}: ${r.reason}`))
                .then((r) => r && setPlan(null))}>
              Write {plan.changed_ids.length} preset{plan.changed_ids.length === 1 ? "" : "s"} to {deviceName}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
