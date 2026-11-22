// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { DeviceState, Look, Playlist, Profile, Segment } from "../types";
import { EffectControls } from "./EffectControls";
import { EffectList } from "./EffectList";
import { Looks } from "./Looks";
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
  const [segId, setSegId] = useState(0);
  const pending = useRef<Partial<Segment>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reloadState = useCallback(() => api.state(deviceId).then(setState).catch((e) => notify(e.message, true)), [deviceId, notify]);
  const reloadLooks = useCallback(() => Promise.all([api.looks(), api.playlists()])
    .then(([l, p]) => { setLooks(l); setPlaylists(p); }).catch((e) => notify(e.message, true)), [notify]);

  useEffect(() => {
    setProfile(null);
    setState(null);
    api.profile(deviceId).then(setProfile).catch((e) => notify(e.message, true));
    reloadState();
    reloadLooks();
  }, [deviceId, notify, reloadState, reloadLooks]);

  const segment = state?.seg.find((s) => s.id === segId) ?? state?.seg[0];

  // live editing: show the change at once, send it to the device shortly after (coalesced)
  function change(patch: Partial<Segment>) {
    if (!state || !segment) return;
    setState({ ...state, seg: state.seg.map((s) => (s.id === segment.id ? { ...s, ...patch } : s)) });
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = pending.current;
      pending.current = {};
      api.setState(deviceId, { seg: [{ id: segment.id, ...p }] }).catch((e) => {
        notify(e.message, true);
        reloadState();
      });
    }, SEND_DELAY_MS);
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

  return (
    <div className="device-panel">
      <aside>
        <EffectList effects={profile.effects} selected={segment.fx} hasMatrix={hasMatrix}
          onSelect={(fx) => change({ fx })} />
      </aside>
      <main>
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
        {state.seg.length > 1 && (
          <div className="row">
            {state.seg.map((s) => (
              <button key={s.id} className={s.id === segment.id ? "primary" : ""} onClick={() => setSegId(s.id)}>
                Segment {s.id} ({s.start}–{s.stop})
              </button>
            ))}
          </div>
        )}
        <h2>
          {effect.name}
          {effect.audio.length > 0 && <span className="badge" title="Sound-reactive">♪</span>}
        </h2>
        <EffectControls effect={effect} segment={segment} palettes={profile.palettes} rgbw={profile.leds.rgbw}
          onChange={change} />
        <p className="muted small">
          {String(profile.info.product ?? "")} · WLED {String(profile.info.ver ?? "")} · {profile.leds.count} LEDs
        </p>
      </main>
      <aside>
        <Looks deviceId={deviceId} looks={looks} onChanged={reloadLooks} onApplied={reloadState} notify={notify} />
        <Playlists looks={looks} playlists={playlists} onChanged={reloadLooks} notify={notify} />
      </aside>
    </div>
  );
}
