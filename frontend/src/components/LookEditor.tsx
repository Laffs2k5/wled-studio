// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Room } from "../room";
import type { CheckItem, Look, Playlist, Profile, Segment } from "../types";
import { parsePresetId, presetUsers, takenWarning } from "../presets";
import { EffectControls } from "./EffectControls";
import { SegmentLayout, SOUND_SIMULATIONS } from "./SegmentLayout";
import { SegmentMap } from "./SegmentMap";
import { StatusBadge } from "./StatusBadge";

/** The segment fields the API takes (WLED's preset fields). */
const SEGMENT_KEYS = ["id", "start", "stop", "startY", "stopY", "on", "bri", "fx", "sx", "ix", "c1", "c2", "c3", "o1", "o2",
  "o3", "pal", "col", "rev", "mi", "rY", "mY", "tp", "n", "frz", "si", "grp", "spc", "of", "bm", "cct", "set", "sel", "m12", "lc"];

export interface EditedLook {
  name: string;
  preset_id: number | null;
  status: CheckItem["status"];
  notes: string[];
  owns_layout: boolean;
  ids: boolean;
  bounds: boolean;
  state: { on?: boolean; bri?: number; transition?: number; seg: Partial<Segment>[] };
}

interface Props {
  deviceId: string;
  name: string;
  profile: Profile;
  room: Room | null;
  notify: (msg: string, error?: boolean) => void;
  onClose: (saved: boolean) => void;
  /** The library, to warn when the preset id is another item's. */
  looks?: Look[];
  playlists?: Playlist[];
  /** The device's name, for the banner. */
  deviceName?: string;
  /** An effect picked in the effect list on the left: set on the edited segment (seq tells repeats apart). */
  pick?: { fx: number; seq: number } | null;
  /** The edited segment's effect, for the effect list on the left to mark. */
  onEffect?: (fx: number) => void;
  /** Called after a save, before onClose: what was saved, and whether anything had changed. */
  onSaved?: (saved: { name: string; presetId: number | null; changed: boolean }) => void;
}

/** What the editor compares to tell whether there is anything to lose on Cancel. */
const snapshot = (segs: Segment[], bri: number, pidText: string) =>
  JSON.stringify([segs.map(({ _set, ...rest }) => rest), bri, pidText.trim()]);

/** A segment with display defaults filled in. `_set` lists the fields it really has: the ones it
 * came with, plus the ones edited here. Only those are saved, so editing one slider of a look
 * that carries few fields (no bounds, say) doesn't add the defaults shown for display. */
const filled = (s: Partial<Segment>, ledCount: number, all = false): Segment => ({
  start: 0, stop: ledCount, on: true, bri: 255, fx: 0, pal: 0, col: [], sx: 128, ix: 128, c1: 128, c2: 128, c3: 16,
  o1: false, o2: false, o3: false, ...s, id: Number(s.id ?? 0),
  _set: all ? [...SEGMENT_KEYS] : Object.keys(s),
} as Segment);
const fieldsOf = (s: Segment) => new Set((s._set as string[] | undefined) ?? SEGMENT_KEYS);

/** A saved look, edited in the library: nothing is sent to the strip. */
export function LookEditor({ deviceId, name, profile, room, notify, onClose, looks = [], playlists = [], deviceName,
  pick, onEffect, onSaved }: Props) {
  const [look, setLook] = useState<EditedLook | null>(null);
  const [segs, setSegs] = useState<Segment[]>([]);
  const [bri, setBri] = useState(128);
  const [segId, setSegId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pidText, setPidText] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const initial = useRef<string | null>(null);
  const count = profile.leds.count;

  useEffect(() => {
    api.editLook(deviceId, name).then((l) => {
      const s = l.state.seg.map((x) => filled(x, count));
      const p = l.preset_id ? String(l.preset_id) : "";
      setLook(l);
      setSegs(s);
      setBri(l.state.bri ?? 128);
      setSegId(Number(l.state.seg[0]?.id ?? 0));
      setPidText(p);
      initial.current = snapshot(s, l.state.bri ?? 128, p);
    }).catch((e) => { notify((e as Error).message, true); onClose(false); });
  }, [deviceId, name, count, notify, onClose]);

  const segment = segs.find((s) => s.id === segId) ?? segs[0];
  const fx = segment?.fx;
  // the effect list on the left marks the edited segment's effect, and picking there sets it
  useEffect(() => { if (fx !== undefined) onEffect?.(fx); }, [fx, onEffect]);
  const seenPick = useRef(pick?.seq);
  useEffect(() => {
    if (!pick || pick.seq === seenPick.current) return;
    seenPick.current = pick.seq;
    setSegs((list) => list.map((s) => (s.id === (segment?.id ?? 0)
      ? { ...s, fx: pick.fx, _set: [...fieldsOf(s), "fx"] } : s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);

  if (!look || !segment) return <p className="muted pad">Loading “{name}”…</p>;
  const changed = initial.current !== null && snapshot(segs, bri, pidText) !== initial.current;
  const pid = parsePresetId(pidText);
  const pidUsers = typeof pid === "number" ? presetUsers(pid, looks, playlists, name) : [];
  const place = segs.indexOf(segment);
  const effect = profile.effects.find((e) => e.id === segment.fx) ?? profile.effects[0];
  const change = (patch: Partial<Segment>) => setSegs(segs.map((s) => (s.id === segment.id
    ? { ...s, ...patch, _set: [...fieldsOf(s), ...Object.keys(patch)] } : s)));
  const nextId = () => Math.max(...segs.map((s) => s.id)) + 1;
  // the stack is the order of the list; ids follow the order, as on the device
  const reorder = (list: Segment[], selectedAt: number) => {
    const out = list.map((s, i) => ({ ...s, id: i }));
    setSegs(out);
    setSegId(out[selectedAt].id);
  };

  async function save() {
    setBusy(true);
    try {
      const seg = segs.map((s) => {
        const keep = fieldsOf(s);
        return Object.fromEntries(Object.entries(s).filter(([k]) => SEGMENT_KEYS.includes(k) && (k === "id" || keep.has(k))));
      });
      await api.saveEditedLook(deviceId, name, {
        seg, bri, ...(look!.state.on !== undefined ? { on: look!.state.on } : {}),
        ...(look!.state.transition !== undefined ? { transition: look!.state.transition } : {}),
        owns_layout: look!.owns_layout, ids: look!.ids,
        // the preset id as the field has it: a number, or none (cleared)
        ...(typeof pid === "number" ? { preset_id: pid } : { keep_slot: false }),
      });
      notify(`Saved “${name}” in the library`);
      onSaved?.({ name, presetId: typeof pid === "number" ? pid : null, changed });
      onClose(true);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="look-editor" aria-label={`Editing ${name}`}>
      <p className="edit-banner" aria-label="Where changes go">
        <strong>Editing the saved look “{name}”. The strip does not change.</strong>{" "}
        <span className="small">Save keeps it in the library; {deviceName ?? "the device"} gets it when you write presets.</span>
      </p>
      <h2>
        Editing “{name}” <StatusBadge item={{ look: name, status: look.status, notes: look.notes }} where={deviceName} />
      </h2>
      <label className="field preset-field">
        <span>Preset id (empty: none; the look then stays in the library only)</span>
        <input value={pidText} inputMode="numeric" className="slot" placeholder="none" aria-label="Preset id"
          onChange={(e) => setPidText(e.target.value)} />
      </label>
      {pid === "bad" && <p className="warn small">A preset id is a whole number from 1 to 250.</p>}
      {typeof pid === "number" && pidUsers.length > 0 && <p className="warn small">{takenWarning(pid, pidUsers)}</p>}
      <label className="slider">
        <span>Brightness</span>
        <input type="range" min={1} max={255} value={bri} aria-label="Look brightness" onChange={(e) => setBri(Number(e.target.value))} />
        <output>{bri}</output>
      </label>
      <div className="row segments" aria-label="Look segments">
        {segs.map((s) => (
          <button key={s.id} className={s.id === segment.id ? "primary" : ""} aria-pressed={s.id === segment.id}
            onClick={() => setSegId(s.id)}>
            Segment {s.id}{s.n ? ` · ${String(s.n)}` : ""}{look.bounds ? ` (${s.start}–${s.stop - 1})` : ""}
          </button>
        ))}
        {look.bounds && segs.length < (profile.leds.maxseg || 1) && (
          <button onClick={() => { const id = nextId(); setSegs([...segs, filled({ id, fx: 0 }, count, true)]); setSegId(id); }}>+ Segment</button>
        )}
        {segs.length > 1 && (
          <button className="danger" onClick={() => reorder(segs.filter((s) => s.id !== segment.id), 0)}>
            Remove segment {segment.id}
          </button>
        )}
      </div>
      {look.bounds && (
        <div className="row">
          <button disabled={place >= segs.length - 1} onClick={() => {
            const l = [...segs]; [l[place], l[place + 1]] = [l[place + 1], l[place]]; reorder(l, place + 1);
          }}>Raise</button>
          <button disabled={place <= 0} onClick={() => {
            const l = [...segs]; [l[place], l[place - 1]] = [l[place - 1], l[place]]; reorder(l, place - 1);
          }}>Lower</button>
          {segs.length < (profile.leds.maxseg || 1) && (
            <button onClick={() => { const id = nextId(); setSegs([...segs, { ...segment, id }]); setSegId(id); }}>Duplicate</button>
          )}
        </div>
      )}
      {look.bounds && (
        <>
          <SegmentMap ledCount={count} room={room} segments={segs} selected={segment.id} onSelect={setSegId}
            onPick={(start, stop) => change({ start, stop })} />
          <SegmentLayout segment={segment} ledCount={count} room={room} onChange={change} />
        </>
      )}
      <label className="palette">
        <span>Effect</span>
        <select aria-label="Effect" value={segment.fx} onChange={(e) => change({ fx: Number(e.target.value) })}>
          {profile.effects.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      {effect.audio.length > 0 && (
        <label className="palette" title="A stand-in beat for this sound effect while the device's mic is off">
          <span>Simulated beat (mic off)</span>
          <select aria-label="Sound simulation" value={Number(segment.si ?? 0)} onChange={(e) => change({ si: Number(e.target.value) })}>
            {SOUND_SIMULATIONS.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </label>
      )}
      <EffectControls effect={effect} segment={segment} palettes={profile.palettes} rgbw={profile.leds.rgbw} onChange={change} />
      {discarding ? (
        <div className="row confirm" role="group" aria-label="Discard changes?">
          <span className="warn">Discard your changes to “{name}”? The saved look stays as it was.</span>
          <button className="danger" onClick={() => onClose(false)}>Discard changes</button>
          <button onClick={() => setDiscarding(false)}>Keep editing</button>
        </div>
      ) : (
        <div className="row">
          <button className="primary" disabled={busy || pid === "bad"} onClick={save}>Save “{name}”</button>
          <button disabled={busy} onClick={() => (changed ? setDiscarding(true) : onClose(false))}>Cancel</button>
          <span className="muted small">{changed ? "Unsaved changes" : "No changes yet"}</span>
        </div>
      )}
      {!look.bounds && <p className="muted small">This look leaves the layout alone: it sets effects and colours on the segments the strip has.</p>}
    </section>
  );
}
