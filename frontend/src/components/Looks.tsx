// SPDX-License-Identifier: EUPL-1.2
import { deviceLabel } from "../devices";
import { useCallback, useEffect, useState } from "react";
import { api, type DeviceSet } from "../api";
import { folders, groupByFolder, moveWithin, sortWithin } from "../organise";
import type { CheckItem, Device, Look, Playlist } from "../types";
import { ACCEPTABLE, changedEffects, explain, StatusBadge } from "./StatusBadge";
import { PresetIdEdit } from "./PresetIdEdit";

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
  /** The device's name while it doesn't answer: the library stays usable; showing and editing wait. */
  offline?: string;
}

export function Looks({ deviceId, looks, onChanged, onApplied, notify, beforeAction, checks = [], onEdit, playlists = [], offline }: Props) {
  const usedIn = (name: string) => playlists.filter((p) => p.entries.some((e) => e.look === name) || p.end === name).map((p) => p.name);
  const status = new Map(checks.filter((c) => c.look).map((c) => [c.look as string, c]));
  // a look whose effect (or palette, or wall) this device lacks can't be shown or edited here
  const showable = (name: string) => !offline && status.get(name)?.status !== "unavailable";
  const whyNot = (name: string) => (offline ? `${offline} does not answer` : explain(status.get(name), deviceName));
  const [busy, setBusy] = useState(false);
  // the look whose "Looks right: keep" waits for its confirmation in the row
  const [keeping, setKeeping] = useState<string | null>(null);
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
    // what goes on the device changed: the lists (and the write bar) are read again
    f().then((s) => { setSet(s); notify(ok); onChanged(); }).catch((e) => notify((e as Error).message, true)).finally(() => setBusy(false));
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
      {offline && <p className="small warn">Not checked against {offline}: it does not answer. Showing, editing and importing wait until it does.</p>}
      <div className="row">
        <button disabled={busy || !!offline} title={offline ? `${offline} does not answer` : undefined} onClick={() => run(() => api.importPresets(deviceId),
          (r) => `Imported ${r.imported.length} preset${r.imported.length === 1 ? "" : "s"} from ${deviceName} into the library, kept ${r.kept_existing.length} existing`).then(onChanged)}>
          Import from device
        </button>
      </div>
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
                <PresetIdEdit look={l} looks={looks} playlists={playlists} disabled={busy}
                  onSave={(pid) => api.setPresetId(l.name, pid).then((r) => {
                    notify((pid ? `“${l.name}” now has preset ${pid}` : `“${l.name}” has no preset id now`)
                      + " (in the library; write presets to put it on the device)"
                      + (r.shared_with.length ? `. Preset ${pid} is also used by ${r.shared_with.join(", ")}: nothing can be written until one changes.` : ""),
                      r.shared_with.length > 0);
                    onChanged();
                  }, (e) => { notify((e as Error).message, true); throw e; })} />
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
                  <button disabled={busy} aria-expanded={keeping === l.name}
                    title={`Show it on the strip first; if it looks right, keep ${deviceName}'s version of its effect`}
                    onClick={() => setKeeping(keeping === l.name ? null : l.name)}>
                    Looks right: keep
                  </button>
                )}
                <button disabled={busy || !showable(l.name)} title={showable(l.name) ? "Show it on the strip now" : whyNot(l.name)}
                  onClick={() => run(() => api.apply(deviceId, l.name), (r) => `Showing “${l.name}” on ${deviceName}${r.status === "ok" ? "" : ` (${r.status})`}`).then(onApplied)}>
                  Show
                </button>
                {onEdit && (
                  <button disabled={busy || !showable(l.name)} aria-label={`Edit ${l.name}`}
                    title={showable(l.name) ? "Edit it in the library, without showing it" : whyNot(l.name)}
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
                {keeping === l.name && (() => {
                  const item = status.get(l.name);
                  const fx = changedEffects(item);
                  const effects = fx.length ? fx.map((n) => `“${n}”`).join(" and ") : "its effects";
                  return (
                    <div className="keep-confirm small" role="group" aria-label={`Keep ${l.name} as it looks on ${deviceName}?`}>
                      <p>{explain(item, deviceName)}</p>
                      <p>
                        Use {deviceName}'s version of {effects} as the reference for “{l.name}”? Other devices with the old
                        version will then show “effect changed”. Nothing is sent to {deviceName}.
                      </p>
                      <details className="muted"><summary>Details</summary>{item?.notes.map((n, i) => <div key={i}>{n}</div>)}</details>
                      <div className="row">
                        <button className="primary" disabled={busy} onClick={() => run(() => api.accept(deviceId, l.name),
                          () => `Kept ${deviceName}'s version of ${effects} for “${l.name}” (in the library)`)
                          .then(() => { setKeeping(null); onChanged(); })}>Keep this version</button>
                        <button disabled={busy} onClick={() => setKeeping(null)}>Cancel</button>
                      </div>
                    </div>
                  );
                })()}
              </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {looks.length === 0 && <p className="muted">No looks yet. Import the device's presets, or save what the strip shows with
        “Save as look…” under the controls.</p>}

    </section>
  );
}
