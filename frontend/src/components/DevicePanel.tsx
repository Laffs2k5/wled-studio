// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { CheckItem, DeviceState, Look, Palette, Playlist, Profile, Segment } from "../types";
import { EffectControls } from "./EffectControls";
import { EffectList } from "./EffectList";
import { walls, type Room } from "../room";
import { LiveStrip } from "./LiveStrip";
import { RoomEditor } from "./RoomEditor";
import { SegmentLayout } from "./SegmentLayout";
import { Looks } from "./Looks";
import { Palettes } from "./Palettes";
import { Playlists } from "./Playlists";

interface Props {
  deviceId: string;
  notify: (msg: string, error?: boolean) => void;
}

const SEND_DELAY_MS = 120;

export function DevicePanel({ deviceId, notify }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<DeviceState | null>(null);
  const [looks, setLooks] = useState<Look[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [palettes, setPalettes] = useState<Palette[]>([]);
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [segId, setSegId] = useState(0);
  const [room, setRoom] = useState<Room | null>(null);
  const pending = useRef<Partial<Segment>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reloadState = useCallback(() => api.state(deviceId).then(setState).catch((e) => notify(e.message, true)), [deviceId, notify]);
  const reloadLooks = useCallback(() => Promise.all([
    api.looks(), api.playlists(), api.palettes(),
    api.check(deviceId).catch(() => [] as CheckItem[]), // the device may be unreachable; the lists still load
  ]).then(([l, p, c, k]) => { setLooks(l); setPlaylists(p); setPalettes(c); setChecks(k); })
    .catch((e) => notify(e.message, true)), [deviceId, notify]);

  useEffect(() => {
    setProfile(null);
    setState(null);
    api.profile(deviceId).then(setProfile).catch((e) => notify(e.message, true));
    reloadState();
    reloadLooks();
  }, [deviceId, notify, reloadState, reloadLooks]);

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
      if (added) setSegId(added.id);
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  async function removeSegment(id: number) {
    if (!state || state.seg.length < 2) return;
    await flush();
    try {
      await api.setState(deviceId, { seg: [{ id, stop: 0 }] });
      setSegId(state.seg.find((s) => s.id !== id)?.id ?? 0);
      await reloadState();
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  function master(patch: { on?: boolean; bri?: number }) {
    if (!state) return;
    setState({ ...state, ...patch });
    api.setState(deviceId, patch).catch((e) => notify(e.message, true));
  }

  if (!profile || !state || !segment) return <p className="muted">Loading…</p>;
  const effect = profile.effects.find((e) => e.id === segment.fx) ?? profile.effects[0];
  const hasMatrix = Boolean(profile.leds.matrix && profile.leds.matrix.h > 1);
  const mic = profile.usermods.includes("AudioReactive");
  const wallOf = (s: Segment) => (room ? walls(room).find((w) => w.start === s.start && w.stop === s.stop)?.label : undefined);

  return (
    <div className="device-panel">
      <aside>
        <EffectList effects={profile.effects} selected={segment.fx} hasMatrix={hasMatrix}
          onSelect={(fx) => change({ fx })} />
      </aside>
      <main>
        <LiveStrip deviceId={deviceId} room={room} />
        <div className="master row">
          <label><input type="checkbox" checked={state.on} onChange={(e) => master({ on: e.target.checked })} /> On</label>
          <label className="slider grow">
            <span>Brightness</span>
            <input type="range" min={1} max={255} value={state.bri} aria-label="Brightness"
              onChange={(e) => master({ bri: Number(e.target.value) })} />
          </label>
          {mic && (
            <label title="AudioReactive usermod">
              <input type="checkbox" checked={Boolean(state.AudioReactive?.on)}
                onChange={(e) => {
                  setState({ ...state, AudioReactive: { on: e.target.checked } });
                  api.setState(deviceId, { AudioReactive: { enabled: e.target.checked } }).catch((er) => notify(er.message, true));
                }} /> Mic
            </label>
          )}
        </div>
        <div className="row segments" aria-label="Segments">
          {state.seg.map((s) => (
            <button key={s.id} className={s.id === segment.id ? "primary" : ""} aria-pressed={s.id === segment.id}
              onClick={() => setSegId(s.id)}>
              Segment {s.id} ({wallOf(s) ?? `${s.start}–${s.stop - 1}`})
            </button>
          ))}
          {state.seg.length < (profile.leds.maxseg || 1) && (
            <button onClick={addSegment} title="A new segment over the whole strip, drawn on top">+ Segment</button>
          )}
          {state.seg.length > 1 && (
            <button className="danger" onClick={() => removeSegment(segment.id)}>Remove segment {segment.id}</button>
          )}
        </div>
        <SegmentLayout segment={segment} ledCount={profile.leds.count} room={room} onChange={change} />
        <h2>
          {effect.name}
          {effect.audio.length > 0 && <span className="badge" title="Sound-reactive">♪</span>}
        </h2>
        <EffectControls effect={effect} segment={segment} palettes={profile.palettes} rgbw={profile.leds.rgbw}
          onChange={change} />
        <p className="muted small">
          {String(profile.info.product ?? "")} · WLED {String(profile.info.ver ?? "")} · {profile.leds.count} LEDs
        </p>
        <RoomEditor deviceId={deviceId} ledCount={profile.leds.count} onSaved={setRoom} notify={notify} />
      </main>
      <aside>
        <Looks deviceId={deviceId} looks={looks} onChanged={reloadLooks} onApplied={reloadState} notify={notify}
          beforeAction={flush} checks={checks} />
        <Playlists looks={looks} playlists={playlists} onChanged={reloadLooks} notify={notify} checks={checks} />
        <Palettes palettes={palettes} onChanged={reloadLooks} notify={notify} />
      </aside>
    </div>
  );
}
