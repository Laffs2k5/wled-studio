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

/** A look saved as "effects and colours only": its segments have no bounds, so it leaves the strip's layout alone. */
export const colourOnly = (l: Look) => l.segments.length > 0 && l.segments.some((s) => !("start" in s) || !("stop" in s));

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** What an import did, in words: new looks and playlists, what was left alone, what wasn't taken. */
export function importText(r: { imported: string[]; kept_existing: string[]; imported_playlists?: string[]; skipped_presets?: string[] },
  deviceName: string): string {
  const parts = [r.imported.length || r.imported_playlists?.length
    ? `Imported ${[r.imported.length ? n(r.imported.length, "new look") : "", r.imported_playlists?.length ? n(r.imported_playlists.length, "playlist") : ""]
      .filter(Boolean).join(" and ")} from ${deviceName} into the library.`
    : `Nothing new to import from ${deviceName}.`];
  if (r.kept_existing.length) {
    parts.push(`${n(r.kept_existing.length, "look")} already in the library ${r.kept_existing.length === 1 ? "was" : "were"} left as ${r.kept_existing.length === 1 ? "it is" : "they are"}.`);
  }
  if (r.skipped_presets?.length) {
    parts.push(`Left out: preset${r.skipped_presets.length === 1 ? "" : "s"} ${r.skipped_presets.join(", ")} (playlists already in the library, or not readable as a look).`);
  }
  return parts.join(" ");
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
  // the look whose ⋯ menu is open, and whether it shows the folder picker
  const [menu, setMenu] = useState<string | null>(null);
  const [folderFor, setFolderFor] = useState<string | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest?.(".row-menu")) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [menu]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const [copyTo, setCopyTo] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [libraryMenu, setLibraryMenu] = useState(false);
  const [renamingLook, setRenamingLook] = useState<string | null>(null);
  const [lookName, setLookName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [dissolving, setDissolving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newRowFolder, setNewRowFolder] = useState("");
  const [set, setSet] = useState<DeviceSet | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [imported, setImported] = useState<{ ok: boolean; text: string } | null>(null);
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
    return f().then((s) => { setSet(s); notify(ok); onChanged(); })
      .catch((e) => notify((e as Error).message, true)).finally(() => setBusy(false));
  }
  function copySelected(value = copyTo) {
    const target = others.find((d) => d.id === value);
    if (!target) return;
    const names = order.filter((n) => selected.has(n));
    setBusy(true);
    api.addToSet(target.id, names).then((s) => {
      notify(s.all ? `${target.name} takes everything in the library already` : `Copied ${names.length} to ${target.name}'s set`);
      setCopyTo("");
      setSelected(new Set());
    }).catch((e) => notify((e as Error).message, true)).finally(() => setBusy(false));
  }

  function moveSelected(value = moveTo, newName = newFolderName) {
    const folder: string | null = value === "\u0000none" ? null : value === "\u0000new" ? newName.trim() : value;
    if (value === "\u0000new" && !folder) return;
    const names = order.filter((n) => selected.has(n));
    organise(() => api.setFolder("looks", names, folder), `Moved ${names.length} to ${folder ? `“${folder}”` : "no folder"}`)
      .then(() => { setSelected(new Set()); setMoveTo(""); setNewFolderName(""); });
  }

  // the import's result stays under its button until the next import (or OK)
  async function importFromDevice() {
    setBusy(true);
    setImported(null);
    try {
      await beforeAction?.();
      const r = await api.importPresets(deviceId);
      setImported({ ok: true, text: importText(r, deviceName) });
      onChanged();
    } catch (e) {
      setImported({ ok: false, text: `Couldn't import from ${deviceName}: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
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
      <div className="row library-heading">
        <h2 className="grow">Looks</h2>
        <span className="row-menu">
          <button className="menu-button" aria-label="More library actions" aria-expanded={libraryMenu}
            onClick={() => setLibraryMenu(!libraryMenu)}>⋯</button>
          {libraryMenu && (
            <div className="menu" role="menu" aria-label="Library actions">
              <button role="menuitem" disabled={busy || !!offline}
                onClick={() => { setLibraryMenu(false); importFromDevice(); }}>
                Import presets from {deviceName}
              </button>
            </div>
          )}
        </span>
      </div>
      <p className="muted small library-line">Library: kept in the app, shared by all devices. Nothing here is on a device until you write presets.</p>
      {offline && <p className="small warn">Not checked against {offline}: it does not answer. Showing, editing and importing wait until it does.</p>}
      {imported && (
        <div className={`row action-result ${imported.ok ? "done" : "error"}`} aria-label="Import result">
          <span className="grow" role={imported.ok ? undefined : "alert"}>{imported.text}</span>
          <button className="small" onClick={() => setImported(null)}>OK</button>
        </div>
      )}
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
          <select aria-label="Move the selected looks to" value={moveTo} onChange={(e) => {
            setMoveTo(e.target.value);
            if (e.target.value && e.target.value !== "\u0000new") moveSelected(e.target.value);
          }}>
            <option value="">Move to…</option>
            {known.map((f) => <option key={f} value={f}>{f}</option>)}
            <option value={"\u0000new"}>A new folder…</option>
            <option value={"\u0000none"}>No folder</option>
          </select>
          {moveTo === "\u0000new" && (
            <label className="row small">New folder
              <input autoFocus aria-label="New folder for selected looks" value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); moveSelected(); } }} />
              <button disabled={busy || !newFolderName.trim()} onClick={() => moveSelected()}>Create and move</button>
            </label>
          )}
          {others.length > 0 && (
            <>
              <select aria-label="Copy the selected looks to device" value={copyTo} onChange={(e) => {
                setCopyTo(e.target.value);
                if (e.target.value) copySelected(e.target.value);
              }}>
                <option value="">Copy to device…</option>
                {others.map((d) => <option key={d.id} value={d.id}>{deviceLabel(d)}</option>)}
              </select>
            </>
          )}
          <button disabled={busy} onClick={() => changeSet(() => api.removeFromSet(deviceId, order.filter((n) => selected.has(n))),
            `Took ${selected.size} off ${deviceName}'s set`).then(() => setSelected(new Set()))}>Take off this device</button>
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
                <label className="small">
                  <input type="checkbox" aria-label={`Select all in ${folder ?? "Not in a folder"}`}
                    checked={group.every((name) => selected.has(name))}
                    onChange={(e) => setSelected((old) => {
                      const next = new Set(old);
                      group.forEach((name) => e.target.checked ? next.add(name) : next.delete(name));
                      return next;
                    })} />
                  {" "}Select all
                </label>
                <button className="small" disabled={busy || items.length < 2} title="Sort this group A–Z"
                  onClick={() => organise(() => api.setOrder("looks", sortWithin(order, group)), "Sorted A–Z")}>A–Z</button>
                {folder && renamingFolder === folder ? (
                  <span className="inline-edit row">
                    <input autoFocus aria-label={`New name for folder ${folder}`} value={folderName}
                      onChange={(e) => setFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setRenamingFolder(null);
                        if (e.key === "Enter" && folderName.trim() && folderName.trim() !== folder) {
                          organise(() => api.renameFolder(folder, folderName.trim()), `Renamed to “${folderName.trim()}”`)
                            .then(() => setRenamingFolder(null));
                        }
                      }} />
                    <button disabled={busy || !folderName.trim() || folderName.trim() === folder}
                      onClick={() => organise(() => api.renameFolder(folder, folderName.trim()), `Renamed to “${folderName.trim()}”`)
                        .then(() => setRenamingFolder(null))}>Save</button>
                    <button onClick={() => setRenamingFolder(null)}>Cancel</button>
                  </span>
                ) : folder && <button className="small" disabled={busy} aria-label={`Rename folder ${folder}`}
                  onClick={() => { setRenamingFolder(folder); setFolderName(folder); }}>✎</button>}
                {folder && dissolving === folder ? (
                  <span className="inline-confirm" role="group" aria-label={`Dissolve folder ${folder}?`}>
                    Looks and playlists stay in the library, in no folder.
                    <button className="danger" disabled={busy}
                      onClick={() => organise(() => api.renameFolder(folder, null), "Folder dissolved")
                        .then(() => setDissolving(null))}>Dissolve folder</button>
                    <button onClick={() => setDissolving(null)}>Cancel</button>
                  </span>
                ) : folder && <button className="small" disabled={busy} aria-label={`Dissolve folder ${folder}`}
                  title="Take its looks and playlists out of the folder (nothing is deleted)"
                  onClick={() => setDissolving(folder)}>×</button>}
              </div>
            )}
            {open && (
              <ul className="look-list">
                {items.map((l, i) => (
              <li key={l.name} className={`look-row${onDevice(l.name) ? "" : " off-device"}`}>
                <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.name)}
                  onChange={() => setSelected(toggle(selected, l.name))} />
                <div className="look-main">
                  {renamingLook === l.name ? (
                    <span className="inline-edit row">
                      <input autoFocus aria-label={`New name for ${l.name}`} value={lookName}
                        onChange={(e) => setLookName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setRenamingLook(null);
                          if (e.key === "Enter" && lookName.trim() && lookName.trim() !== l.name) {
                            run(() => api.renameLook(l.name, lookName.trim()), (r) => `Renamed to “${r.name}” in the library`)
                              .then(() => { setRenamingLook(null); onChanged(); });
                          }
                        }} />
                      <button disabled={busy || !lookName.trim() || lookName.trim() === l.name}
                        onClick={() => run(() => api.renameLook(l.name, lookName.trim()), (r) => `Renamed to “${r.name}” in the library`)
                          .then(() => { setRenamingLook(null); onChanged(); })}>Save</button>
                      <button onClick={() => setRenamingLook(null)}>Cancel</button>
                    </span>
                  ) : <span className="name" title={l.name}>{l.name}</span>}
                  <div className="look-meta small">
                    <PresetIdEdit look={l} looks={looks} playlists={playlists} disabled={busy}
                      onSave={(pid) => api.setPresetId(l.name, pid).then((r) => {
                        notify((pid ? `“${l.name}” now has preset ${pid}` : `“${l.name}” has no preset id now`)
                          + " (in the library; write presets to put it on the device)"
                          + (r.shared_with.length ? `. Preset ${pid} is also used by ${r.shared_with.join(", ")}: nothing can be written until one changes.` : ""),
                          r.shared_with.length > 0);
                        onChanged();
                      }, (e) => { notify((e as Error).message, true); throw e; })} />
                    <StatusBadge item={status.get(l.name)} where={deviceName} />
                    {ACCEPTABLE.has(status.get(l.name)?.status ?? "ok") && (
                      <button className="small" disabled={busy} aria-expanded={keeping === l.name}
                        title={`Show it on the strip first; if it looks right, keep ${deviceName}'s version of its effect`}
                        onClick={() => setKeeping(keeping === l.name ? null : l.name)}>
                        Looks right: keep
                      </button>
                    )}
                    {set && !set.all && !onDevice(l.name) && <span className="muted" title={`Not in ${deviceName}'s set`}>left off {deviceName}</span>}
                    {set && !set.all && onDevice(l.name) && !chosen(l.name) && (
                      <span className="badge" title="On this device because a playlist in its set plays it">via playlist</span>
                    )}
                    {l.segments.some((s) => s.wall) && (
                      <span className="muted" title="Follows these walls of the room model">
                        {[...new Set(l.segments.map((s) => s.wall).filter(Boolean))].join(" · ")}
                      </span>
                    )}
                    {colourOnly(l) && (
                      <span className="badge colours-only" title="Saved as effects and colours only: showing it sets them on whatever segments the strip has, and leaves the segments alone">
                        colours only
                      </span>
                    )}
                    {l.mic && <span className="badge" title="Turns the device's microphone on: a sound-reactive look">♪ mic</span>}
                    {usedIn(l.name).length > 0 && (
                      <span className="badge" title={`In ${usedIn(l.name).join(", ")}`}>
                        in {usedIn(l.name).length} {usedIn(l.name).length === 1 ? "playlist" : "playlists"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="look-actions">
                  <button disabled={busy || !showable(l.name)} title={showable(l.name) ? `Show it on ${deviceName}'s strip now (nothing is stored)` : whyNot(l.name)}
                    onClick={() => run(() => api.apply(deviceId, l.name), (r) => `Showing “${l.name}” on ${deviceName}${r.status === "ok" ? "" : ` (${r.status})`}`).then(onApplied)}>
                    Show on strip
                  </button>
                  {onEdit && (
                    <button disabled={busy || !showable(l.name)} aria-label={`Edit ${l.name}`}
                      title={showable(l.name) ? "Edit it in the library, without showing it" : whyNot(l.name)}
                      onClick={() => onEdit(l.name)}>Edit</button>
                  )}
                  <span className="row-menu">
                    <button className="menu-button" aria-label={`More for ${l.name}`} aria-haspopup="menu" aria-expanded={menu === l.name}
                      disabled={busy} onClick={() => { setMenu(menu === l.name ? null : l.name); setFolderFor(null); }}>⋯</button>
                    {menu === l.name && (
                      <div className="menu" role="menu" aria-label={`Actions for ${l.name}`}>
                        <button role="menuitem" title="Rename; playlists that use it follow" onClick={() => {
                          setMenu(null); setRenamingLook(l.name); setLookName(l.name);
                        }}>Rename…</button>
                        <button role="menuitem" disabled={i === 0}
                          onClick={() => { setMenu(null); organise(() => api.setOrder("looks", moveWithin(order, group, l.name, -1))); }}>Move up</button>
                        <button role="menuitem" disabled={i === group.length - 1}
                          onClick={() => { setMenu(null); organise(() => api.setOrder("looks", moveWithin(order, group, l.name, 1))); }}>Move down</button>
                        {folderFor === l.name ? (
                          <span className="inline-edit">
                            <select autoFocus aria-label={`Folder for ${l.name}`} value="" onChange={(e) => {
                            const v = e.target.value;
                            if (v === "\u0000new") return;
                            const folder = v === "\u0000none" ? null : v;
                            setMenu(null); setFolderFor(null);
                            if (folder === "") return;
                            organise(() => api.setFolder("looks", [l.name], folder), `Moved “${l.name}” to ${folder ? `“${folder}”` : "no folder"}`);
                          }}>
                            <option value="">Move to…</option>
                            {known.filter((f) => f !== l.folder).map((f) => <option key={f} value={f}>{f}</option>)}
                            <option value={"\u0000new"}>A new folder…</option>
                            {l.folder && <option value={"\u0000none"}>No folder</option>}
                            </select>
                            <input aria-label={`New folder for ${l.name}`} placeholder="New folder name" value={newRowFolder}
                              onChange={(e) => setNewRowFolder(e.target.value)} />
                            <button disabled={!newRowFolder.trim()} onClick={() => {
                              const folder = newRowFolder.trim();
                              setMenu(null); setFolderFor(null); setNewRowFolder("");
                              organise(() => api.setFolder("looks", [l.name], folder), `Moved “${l.name}” to “${folder}”`);
                            }}>Move</button>
                          </span>
                        ) : (
                          <button role="menuitem" onClick={() => setFolderFor(l.name)}>Move to folder…</button>
                        )}
                        {set && (onDevice(l.name)
                          ? (set.all || chosen(l.name)
                            ? <button role="menuitem" title={`Take it out of ${deviceName}'s set; its preset stays on the device until you remove it there`}
                                onClick={() => { setMenu(null); changeSet(() => api.removeFromSet(deviceId, [l.name]), `Took “${l.name}” off ${deviceName}'s set`); }}>
                                Remove from this device</button>
                            : <button role="menuitem" disabled title="A playlist in this device's set plays it">On this device through a playlist</button>)
                          : <button role="menuitem" title={`Add it to ${deviceName}'s set`}
                              onClick={() => { setMenu(null); changeSet(() => api.addToSet(deviceId, [l.name]), `Added “${l.name}” to ${deviceName}'s set`); }}>
                              Put on this device</button>)}
                        <button role="menuitem" className="danger" onClick={() => { setMenu(null); setDeleting(l.name); }}>Delete…</button>
                      </div>
                    )}
                  </span>
                </div>
                {deleting === l.name && (
                  <div className="inline-confirm" role="group" aria-label={`Delete ${l.name}?`}>
                    <p>Delete “{l.name}” from the library? Its preset stays on the device until you remove it there.</p>
                    <button className="danger" disabled={busy}
                      onClick={() => run(() => api.deleteLook(l.name)).then(() => { setDeleting(null); onChanged(); })}>Delete look</button>
                    <button onClick={() => setDeleting(null)}>Cancel</button>
                  </div>
                )}
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
