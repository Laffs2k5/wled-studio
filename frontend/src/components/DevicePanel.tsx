// SPDX-License-Identifier: EUPL-1.2
import { VIRTUAL } from "../devices";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, request } from "../api";
import type { CheckItem, DeviceState, Look, Palette, Playlist, Profile, Segment } from "../types";
import { EffectControls } from "./EffectControls";
import { EffectList } from "./EffectList";
import { areas, type Room } from "../room";
import { LiveStrip } from "./LiveStrip";
import { LookEditor } from "./LookEditor";
import { SegmentLayout, SOUND_SIMULATIONS } from "./SegmentLayout";
import { SegmentMap } from "./SegmentMap";
import { SessionBar } from "./SessionBar";
import { Looks } from "./Looks";
import { Palettes } from "./Palettes";
import { Playlists } from "./Playlists";
import { WriteBar } from "./WriteBar";
import { SaveLook } from "./SaveLook";
import { LibraryTransfer } from "./LibraryTransfer";
import { CrossDevice } from "./CrossDevice";

interface Props {
  deviceId: string;
  notify: (msg: string, error?: boolean) => void;
  /** Called with whether the device turned out virtual, once its profile is read. */
  onVirtual?: (virtual: boolean) => void;
  /** The device's name and address as listed, for the message when it doesn't answer. */
  deviceName?: string;
  host?: string;
  /** Bumped when the room shape was saved (in the device settings): read it again. */
  roomVersion?: number;
  /** Open the device settings at the room shape, or at the address. */
  onRoomShape?: () => void;
  onEditAddress?: () => void;
  openLook?: string | null;
  onLookOpened?: () => void;
  /** Stable legacy view, or one of the separated Design/Library task views. */
  viewMode?: "design" | "library" | "legacy";
  /** A shared token: Library mutations notify the Presets view to invalidate its plan. */
  onLibraryChanged?: () => void;
}

/** What the panel shows instead of the live controls while the device doesn't answer: what's wrong,
 * what to check, and Try again. The library next to it stays usable. */
export function DeviceOffline({ name, host, error, trying, onRetry, onEditAddress }: {
  name: string; host?: string; error: string; trying: boolean; onRetry: () => void; onEditAddress?: () => void;
}) {
  const unreachable = /does not answer/.test(error);
  return (
    <section className="offline-card" aria-label="Device not answering">
      <h2>{unreachable ? `${name} does not answer${host ? ` at ${host}` : ""}.` : `Couldn't read ${name}.`}</h2>
      <p>
        {unreachable ? "Check that it is powered and on the network, then try again."
          : error}
      </p>
      <p className="muted small">
        Nothing was sent to it. The library on the right needs no device: you can still organise, rename and
        delete looks; showing, editing and writing wait until {name} answers.
      </p>
      <div className="row">
        <button className="primary" disabled={trying} onClick={onRetry}>{trying ? "Trying…" : "Try again"}</button>
        {onEditAddress && <button onClick={onEditAddress}>Change the address…</button>}
      </div>
    </section>
  );
}

const SEND_DELAY_MS = 120;

export function DevicePanel({ deviceId, notify, onVirtual, deviceName, host, roomVersion = 0, onRoomShape, onEditAddress,
  openLook, onLookOpened, viewMode = "legacy", onLibraryChanged }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<DeviceState | null>(null);
  const [looks, setLooks] = useState<Look[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [palettes, setPalettes] = useState<Palette[]>([]);
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  // while a look is open in the editor: its edited segment's effect, and a pick from the list on the left
  const [editorFx, setEditorFx] = useState(0);
  const [pick, setPick] = useState<{ fx: number; seq: number } | null>(null);
  // after the editor saved: what the device now lacks, until dismissed; and a request to open the write plan
  const [saved, setSaved] = useState<{ name: string; presetId: number | null; changed: boolean } | null>(null);
  const [openPlan, setOpenPlan] = useState(0);
  // the palettes the next write would upload (from the write bar's check); null while unknown
  const [pendingPalettes, setPendingPalettes] = useState<string[] | null>(null);
  const [segId, setSegId] = useState(0);
  const [newSegmentHint, setNewSegmentHint] = useState<number | null>(null);
  const [removedSegment, setRemovedSegment] = useState<Segment | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomRead, setRoomRead] = useState(false);
  // bumped whenever the library is read again after a change: the write bar checks the device again
  const [version, setVersion] = useState(0);
  // the device didn't answer when the panel opened: why, and whether "Try again" is running
  const [offline, setOffline] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [trying, setTrying] = useState(false);
  const [mobileTab, setMobileTab] = useState<"effects" | "strip" | "library">("strip");
  const pending = useRef<Partial<Segment>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reloadState = useCallback(() => api.state(deviceId).then(setState).catch((e) => notify(e.message, true)), [deviceId, notify]);
  const reloadLooks = useCallback(() => Promise.all([
    api.looks(), api.playlists(), api.palettes(),
    api.check(deviceId).catch(() => [] as CheckItem[]), // the device may be unreachable; the lists still load
  ]).then(([l, p, c, k]) => {
    setLooks(l); setPlaylists(p); setPalettes(c); setChecks(k); setVersion((v) => v + 1);
    onLibraryChanged?.();
  }).catch((e) => notify(e.message, true)), [deviceId, notify, onLibraryChanged]);
  const closeEditor = useCallback((didSave: boolean) => {
    setEditing(null);
    setPick(null);
    if (didSave) reloadLooks();
  }, [reloadLooks]);
  const startEditing = useCallback((name: string) => { setSaved(null); setEditing(name); }, []);
  useEffect(() => {
    if (!openLook || !looks.some((look) => look.name === openLook)) return;
    startEditing(openLook);
    onLookOpened?.();
  }, [openLook, looks, startEditing, onLookOpened]);

  useEffect(() => {
    let live = true;
    setTrying(true);
    // the profile and the state together: either both, or the panel says the device doesn't answer
    Promise.all([api.profile(deviceId), api.state(deviceId)]).then(([p, st]) => {
      if (!live) return;
      setProfile(p);
      setState(st);
      setOffline(null);
      onVirtual?.(p.info.arch === "virtual");
    }).catch((e) => {
      if (!live) return;
      if (e instanceof ApiError && e.status === 401) notify(e.message, true);
      setOffline((e as Error).message);
    }).finally(() => { if (live) setTrying(false); });
    reloadLooks();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, notify, reloadLooks, attempt]);

  // the room shape (edited in the device settings): drawn by the live view and the segment map
  useEffect(() => {
    let live = true;
    request<Room | null>("GET", `/api/devices/${encodeURIComponent(deviceId)}/room`)
      .then((r) => { if (live) { setRoom(r); setRoomRead(true); } }).catch(() => {});
    return () => { live = false; };
  }, [deviceId, roomVersion]);

  const segment = state?.seg.find((s) => s.id === segId) ?? state?.seg[0];

  const pendingSeg = useRef<number>(0);

  // send any held-back live change now (before saving or showing a look reads the device)
  async function flush() {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = {};
    if (Object.keys(p).length) {
      try {
        await api.setState(deviceId, { seg: [{ id: pendingSeg.current, ...p }] });
      } catch (e) {
        notify((e as Error).message, true);
      }
    }
  }

  // live editing: show the change at once, send it to the device shortly after (coalesced)
  function change(patch: Partial<Segment>) {
    if (!state || !segment) return;
    setState({ ...state, seg: state.seg.map((s) => (s.id === segment.id ? { ...s, ...patch } : s)) });
    pending.current = { ...pending.current, ...patch };
    pendingSeg.current = segment.id;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const p = pending.current;
      pending.current = {};
      api.setState(deviceId, { seg: [{ id: segment.id, ...p }] }).catch((e) => {
        notify(e.message, true);
        reloadState();
      });
    }, SEND_DELAY_MS);
  }

  // a new segment covers the whole strip, on top; WLED appends it to its list, so the new
  // one is found by comparing the ids before and after
  async function addSegment() {
    if (!state || !profile) return;
    await flush();
    const used = new Set(state.seg.map((s) => s.id));
    let id = 0;
    while (used.has(id)) id++;
    try {
      await api.setState(deviceId, { seg: [{ id, start: 0, stop: profile.leds.count }] });
      const next = await api.state(deviceId);
      setState(next);
      const added = next.seg.find((s) => !used.has(s.id));
      if (added) {
        setSegId(added.id);
        setNewSegmentHint(added.id);
        setRemovedSegment(null);
      }
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  async function removeSegment(id: number) {
    if (!state || state.seg.length < 2) return;
    await flush();
    const removed = state.seg.find((s) => s.id === id);
    try {
      await api.setState(deviceId, { seg: [{ id, stop: 0 }] });
      setSegId(state.seg.find((s) => s.id !== id)?.id ?? 0);
      setRemovedSegment(removed ?? null);
      setNewSegmentHint(null);
      await reloadState();
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  async function undoRemoveSegment() {
    if (!removedSegment) return;
    try {
      await api.setState(deviceId, { seg: [removedSegment] });
      setSegId(removedSegment.id);
      setRemovedSegment(null);
      await reloadState();
      notify(`Restored segment ${removedSegment.id}`);
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  // a segment's place in the stack (WLED draws in id order), or a copy of it on top
  async function restack(f: () => Promise<{ id: number }>) {
    await flush();
    try {
      const r = await f();
      setSegId(r.id);
      await reloadState();
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  // the device's sound input (the AudioReactive usermod), on or off
  function setMic(on: boolean) {
    if (!state) return;
    setState({ ...state, AudioReactive: { on } });
    api.setState(deviceId, { AudioReactive: { enabled: on } }).catch((er) => notify(er.message, true));
  }

  function master(patch: { on?: boolean; bri?: number }) {
    if (!state) return;
    setState({ ...state, ...patch });
    api.setState(deviceId, patch).catch((e) => notify(e.message, true));
  }

  const library = (offlineName?: string) => (
    <aside className="library-column">
      <Looks deviceId={deviceId} looks={looks} onChanged={reloadLooks} onApplied={reloadState} notify={notify}
        beforeAction={flush} checks={checks} onEdit={startEditing} playlists={playlists} offline={offlineName}
        deviceName={profile?.device.name ?? deviceName}
        renderPlaylists={(folder) => (
          <Playlists looks={looks} playlists={playlists} onChanged={reloadLooks} notify={notify} checks={checks}
            deviceId={deviceId} deviceName={offlineName ?? profile?.device.name ?? deviceName} offline={!!offlineName}
            onShown={reloadState} folder={folder} listOnly />
        )} />
      <Playlists looks={looks} playlists={playlists} onChanged={reloadLooks} notify={notify} checks={checks}
        deviceId={deviceId} deviceName={offlineName ?? profile?.device.name ?? deviceName} offline={!!offlineName}
        onShown={reloadState} formOnly />
      <Palettes palettes={palettes} onChanged={reloadLooks} notify={notify} deviceName={profile?.device.name ?? deviceName}
        pending={offlineName ? null : pendingPalettes} onCheckAndWrite={offlineName ? undefined : () => setOpenPlan((n) => n + 1)} />
      <LibraryTransfer onChanged={reloadLooks} notify={notify} />
      <CrossDevice current={deviceId} looks={looks} notify={notify} onChanged={reloadLooks} />
    </aside>
  );
  if (viewMode === "library") {
    if (editing && profile && roomRead) {
      return (
        <div className="library-view editing-look">
          <LookEditor deviceId={deviceId} name={editing} profile={profile} room={room} notify={notify}
            onClose={closeEditor} looks={looks} playlists={playlists} deviceName={profile.device.name}
            pick={null} onSaved={setSaved} />
          <button onClick={() => closeEditor(false)}>Back to Library</button>
        </div>
      );
    }
    return (
      <div className="library-view">
        {offline !== null && <p className="first-run-note warn">{deviceName ?? deviceId} does not answer. The local library remains available; strip actions wait.</p>}
        {library(offline !== null ? (deviceName ?? deviceId) : undefined)}
      </div>
    );
  }
  if (offline !== null && !(profile && state)) {
    const name = deviceName ?? deviceId;
    return (
      <div className="device-panel offline">
        <main>
          <DeviceOffline name={name} host={host} error={offline} trying={trying} onRetry={() => setAttempt((n) => n + 1)}
            onEditAddress={onEditAddress} />
        </main>
        {library(name)}
      </div>
    );
  }
  if (!profile || !state || !segment) return <p className="muted pad">Reading {deviceName ?? "the device"}…</p>;
  const effect = profile.effects.find((e) => e.id === segment.fx) ?? profile.effects[0];
  const hasMatrix = Boolean(profile.leds.matrix && profile.leds.matrix.h > 1);
  const virtual = profile.info.arch === "virtual";
  const mic = profile.usermods.includes("AudioReactive");
  const wallOf = (s: Segment) => areas(room).find((w) => w.start === s.start && w.stop === s.stop)?.label;
  const ids = state.seg.map((s) => s.id);
  const place = ids.indexOf(segment.id);

  return (<>
    <nav className="mobile-column-tabs" aria-label="Looks view columns">
      {(["effects", "strip", ...(viewMode === "legacy" ? ["library"] : [])] as ("effects" | "strip" | "library")[]).map((tab) => (
        <button key={tab} className={mobileTab === tab ? "primary" : ""} aria-pressed={mobileTab === tab}
          onClick={() => setMobileTab(tab)}>{tab === "effects" ? "Effects" : tab === "strip" ? "Strip" : "Library"}</button>
      ))}
    </nav>
    <div className={`device-panel ${viewMode === "design" ? "design-only" : ""}`} data-mobile-tab={mobileTab}>
      <aside className={`effects-column${editing ? " editing" : ""}`}>
        {editing ? (<>
          <p className="small edit-note">Picks the effect of the segment you're editing in “{editing}”. The strip does not change.</p>
          <EffectList effects={profile.effects} selected={editorFx} hasMatrix={hasMatrix}
            onSelect={(fx) => setPick({ fx, seq: Date.now() })} />
        </>) : (
          <EffectList effects={profile.effects} selected={segment.fx} hasMatrix={hasMatrix}
            onSelect={(fx) => change({ fx })} />
        )}
      </aside>
      <main className={`strip-column${editing ? " editing" : ""}`}>
        {editing ? (
          <LookEditor key={editing} deviceId={deviceId} name={editing} profile={profile} room={room} notify={notify}
            onClose={closeEditor} looks={looks} playlists={playlists} deviceName={profile.device.name}
            pick={pick} onEffect={setEditorFx} onSaved={setSaved} />
        ) : (<>
        {saved && (
          <div className="row saved-note small" role="note" aria-label="Saved look">
            <span className="grow">
              Saved “{saved.name}” in the library.{" "}
              {!saved.changed ? "Nothing had changed."
                : saved.presetId ? `Preset ${saved.presetId} on ${profile.device.name} is now out of date until you write presets.`
                  : "It has no preset id, so it stays in the library only."}
            </span>
            {saved.changed && saved.presetId && (
              <button className="small primary" onClick={() => { setOpenPlan((n) => n + 1); setSaved(null); }}>Check and write</button>
            )}
            <button className="small" onClick={() => setSaved(null)}>OK</button>
          </div>
        )}
        <p className="live-banner small" aria-label="Where changes go">
          <strong>Live on {profile.device.name}</strong>
          {virtual && <span className="badge" title="WLED's own code running as software, for testing: it behaves like a controller, but there's no strip">{VIRTUAL}</span>}
          <strong>:</strong> every change here shows {virtual ? "in its live view" : "on the strip"} at once. Nothing is
          stored on the device until you write presets.
        </p>
        <LiveStrip deviceId={deviceId} room={room} />
        <SessionBar deviceId={deviceId} notify={notify} beforeAction={flush} onRestored={reloadState}
          effects={profile.effects} looks={looks} playlists={playlists} />
        <div className="master row">
          <label><input type="checkbox" checked={state.on} onChange={(e) => master({ on: e.target.checked })} /> On</label>
          <label className="slider grow">
            <span>Brightness</span>
            <input type="range" min={1} max={255} value={state.bri} aria-label="Brightness"
              onChange={(e) => master({ bri: Number(e.target.value) })} />
            <output>{state.bri}</output>
          </label>
          {mic && (
            <label title="The device's sound input (WLED's AudioReactive usermod). While it's off, sound effects run on a simulated beat.">
              <input type="checkbox" checked={Boolean(state.AudioReactive?.on)}
                onChange={(e) => setMic(e.target.checked)} /> Microphone on (sound effects react to real sound)
            </label>
          )}
        </div>
        <div className="row segments" aria-label="Segments">
          {state.seg.map((s) => (
            <button key={s.id} className={s.id === segment.id ? "primary" : ""} aria-pressed={s.id === segment.id}
              onClick={() => setSegId(s.id)}>
              {s.n ? String(s.n) : "Unnamed segment"} · seg {s.id} ({wallOf(s) ?? `${s.start}–${s.stop - 1}`})
            </button>
          ))}
          {state.seg.length < (profile.leds.maxseg || 1) && (
            <button onClick={addSegment} title="A new segment over the whole strip, drawn on top">+ Segment</button>
          )}
          {state.seg.length > 1 && (
            <button className="danger" onClick={() => removeSegment(segment.id)}>Remove segment {segment.id}</button>
          )}
        </div>
        <div className="row">
          <button disabled={place >= ids.length - 1} title="Draw it later, over the segment above"
            onClick={() => restack(() => api.moveSegment(deviceId, segment.id, "up"))}>Draw later (on top)</button>
          <button disabled={place <= 0} title="Draw it earlier, under the segment below"
            onClick={() => restack(() => api.moveSegment(deviceId, segment.id, "down"))}>Draw earlier (below)</button>
          {state.seg.length < (profile.leds.maxseg || 1) && (
            <button title="A copy of this segment, on top" onClick={() => restack(() => api.duplicateSegment(deviceId, segment.id))}>
              Duplicate
            </button>
          )}
        </div>
        {newSegmentHint === segment.id && (
          <p className="small segment-hint">
            New segment covers the whole strip. Drag on the map to set its LEDs.
            <button className="small link" onClick={() => setNewSegmentHint(null)}>Got it</button>
          </p>
        )}
        {removedSegment && (
          <div className="row action-result" aria-label="Removed segment">
            <span className="grow">Removed segment {removedSegment.id}{removedSegment.n ? ` “${removedSegment.n}”` : ""} from the live strip.</span>
            <button onClick={undoRemoveSegment}>Undo</button>
            <button className="small" onClick={() => setRemovedSegment(null)}>Dismiss</button>
          </div>
        )}
        <SegmentMap ledCount={profile.leds.count} room={room} segments={state.seg} selected={segment.id}
          onSelect={setSegId} onPick={(start, stop) => change({ start, stop })} />
        <SegmentLayout segment={segment} ledCount={profile.leds.count} room={room} onChange={change} />
        <h2>
          {effect.name}
          {effect.audio.length > 0 && <span className="badge" title="Sound-reactive">♪</span>}
        </h2>
        {effect.audio.length > 0 && !(mic && state.AudioReactive?.on) && (
          <p className="row small sound-sim">
            <span>{mic ? "Mic is off" : "This device has no sound input"}: this effect runs on a simulated beat</span>
            <select aria-label="Sound simulation" value={Number(segment.si ?? 0)}
              onChange={(e) => change({ si: Number(e.target.value) })}>
              {SOUND_SIMULATIONS.map((n, i) => <option key={i} value={i}>{n}</option>)}
            </select>
            {mic && <button className="small" onClick={() => setMic(true)}>Turn mic on</button>}
          </p>
        )}
        <EffectControls effect={effect} segment={segment} palettes={profile.palettes} rgbw={profile.leds.rgbw}
          onChange={change} />
        <SaveLook deviceId={deviceId} looks={looks} playlists={playlists} notify={notify} beforeSave={flush}
          onSaved={() => reloadLooks()} />
        <p className="muted small">
          {String(profile.info.product ?? "")} · WLED {String(profile.info.ver ?? "")} · {profile.leds.count} LEDs
        </p>
        {roomRead && !room && onRoomShape && (
          <p className="small muted row room-link">
            <span>No room shape yet: the live view and the segment map show the strip as one line.</span>
            <button className="small" onClick={onRoomShape}>Set the room shape…</button>
          </p>
        )}
        </>)}
      </main>
      {viewMode === "legacy" && library()}
    </div>
    {viewMode === "legacy" && (
      <WriteBar deviceId={deviceId} deviceName={profile.device.name} notify={notify} version={version} openRequest={openPlan}
        onLibraryChanged={reloadLooks}
        onPlan={(p) => setPendingPalettes(p ? (p.palettes ?? []).map((x) => x.palette) : null)} />
    )}
  </>);
}
