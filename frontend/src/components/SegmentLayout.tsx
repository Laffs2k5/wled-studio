// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { areas, type Room } from "../room";
import type { Segment } from "../types";

/** WLED 16's segment blend modes ("bm"), in its order (wled00/FX_fcn.cpp, BLENDMODES = 17). */
export const BLEND_MODES = [
  "Top", "Bottom", "Add", "Subtract", "Difference", "Average", "Multiply", "Divide", "Lighten",
  "Darken", "Screen", "Overlay", "Hard light", "Soft light", "Dodge", "Burn", "Stencil",
];

interface FieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  title?: string;
  onCommit: (v: number) => void;
}

/** A whole number, sent when you leave the field or press Enter (not per keystroke), clamped. */
function NumberField({ label, value, min, max, title, onCommit }: FieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  function commit() {
    const n = Number(text);
    if (text.trim() === "" || !Number.isInteger(n)) {
      setText(String(value));
      return;
    }
    const v = Math.min(max, Math.max(min, n));
    setText(String(v));
    if (v !== value) onCommit(v);
  }
  return (
    <label className="num" title={title}>
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} value={text} aria-label={label}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
    </label>
  );
}

/** WLED's sound simulations ("si"): a stand-in beat for sound effects while the mic is off. */
export const SOUND_SIMULATIONS = ["BeatSin", "WeWillRockYou", "10/13", "14/3"];

/** Text sent when you leave the field or press Enter. */
function TextField({ label, value, maxLength, onCommit }: {
  label: string; value: string; maxLength: number; onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  return (
    <label className="num">
      <span>{label}</span>
      <input value={text} maxLength={maxLength} aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
    </label>
  );
}

interface Props {
  segment: Segment;
  ledCount: number;
  room: Room | null;
  /** The segment's effect reacts to sound: show the sound simulation. */
  audio?: boolean;
  onChange: (patch: Partial<Segment>) => void;
}

/** A segment's place on the strip and how it layers over the segments below it. */
export function SegmentLayout({ segment, ledCount, room, audio = false, onChange }: Props) {
  const ws = areas(room).filter((w) => w.stop <= ledCount);
  const wall = ws.findIndex((w) => w.start === segment.start && w.stop === segment.stop);
  const name = String(segment.n ?? "");
  const len = Math.max(1, segment.stop - segment.start);
  const bm = Number(segment.bm ?? 0);
  return (
    <details className="segment-layout">
      <summary>
        Layout and layer <span className="muted small">
          {name ? `${name} · ` : ""}{wall >= 0 ? ws[wall].label : `LEDs ${segment.start}–${segment.stop - 1}`}
          {bm !== 0 ? ` · ${BLEND_MODES[bm] ?? `mode ${bm}`}` : ""}
        </span>
      </summary>
      <div className="row">
        <NumberField label="Start" value={segment.start} min={0} max={segment.stop - 1}
          title="The segment's first LED" onCommit={(start) => onChange({ start })} />
        <NumberField label="Stop" value={segment.stop} min={segment.start + 1} max={ledCount}
          title="The LED after the segment's last one" onCommit={(stop) => onChange({ stop })} />
        {ws.length > 0 && (
          <label>
            <span>Wall or zone</span>
            <select aria-label="Wall or zone" value={wall} onChange={(e) => {
              const w = ws[Number(e.target.value)];
              if (w) onChange({ start: w.start, stop: w.stop });
            }}>
              <option value={-1}>By LED</option>
              {(["wall", "zone"] as const).map((kind) => ws.some((w) => w.kind === kind) && (
                <optgroup key={kind} label={kind === "wall" ? "Walls" : "Zones"}>
                  {ws.map((w, i) => w.kind === kind &&
                    <option key={i} value={i}>{w.label} ({w.start}–{w.stop - 1})</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        <TextField label="Name" value={name} maxLength={32} onCommit={(n) => onChange({ n })} />
      </div>
      <div className="checks">
        <label><input type="checkbox" checked={Boolean(segment.on)} aria-label="Segment on"
          onChange={(e) => onChange({ on: e.target.checked })} /> On</label>
        <label><input type="checkbox" checked={Boolean(segment.rev)} aria-label="Reverse segment"
          onChange={(e) => onChange({ rev: e.target.checked })} /> Reverse</label>
        <label><input type="checkbox" checked={Boolean(segment.mi)} aria-label="Mirror segment"
          onChange={(e) => onChange({ mi: e.target.checked })} /> Mirror</label>
        <label title="Stops the animation where it is"><input type="checkbox" checked={Boolean(segment.frz)}
          aria-label="Freeze segment" onChange={(e) => onChange({ frz: e.target.checked })} /> Freeze</label>
      </div>
      {audio && (
        <label title="Used while the mic is off">
          <span>Sound simulation</span>
          <select aria-label="Sound simulation" value={Number(segment.si ?? 0)}
            onChange={(e) => onChange({ si: Number(e.target.value) })}>
            {SOUND_SIMULATIONS.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </label>
      )}
      <div className="row">
        <NumberField label="Grouping" value={Number(segment.grp ?? 1)} min={1} max={255}
          title="LEDs that show the same pixel" onCommit={(grp) => onChange({ grp })} />
        <NumberField label="Spacing" value={Number(segment.spc ?? 0)} min={0} max={255}
          title="LEDs left dark after each group" onCommit={(spc) => onChange({ spc })} />
        <NumberField label="Offset" value={Number(segment.of ?? 0)} min={0} max={len - 1}
          title="Shifts the effect along the segment" onCommit={(of) => onChange({ of })} />
      </div>
      <label className="slider">
        <span>Opacity</span>
        <input type="range" min={1} max={255} value={segment.bri} aria-label="Opacity"
          onChange={(e) => onChange({ bri: Number(e.target.value) })} />
        <output>{segment.bri}</output>
      </label>
      <label>
        <span>Blend mode</span>
        <select aria-label="Blend mode" value={bm} onChange={(e) => onChange({ bm: Number(e.target.value) })}>
          {BLEND_MODES.map((name, i) => <option key={i} value={i}>{name}</option>)}
          {bm >= BLEND_MODES.length && <option value={bm}>Mode {bm}</option>}
        </select>
      </label>
      <p className="muted small">
        Segments are drawn in order, each over the ones before it; the blend mode says how this one
        mixes with what is below.
      </p>
    </details>
  );
}
