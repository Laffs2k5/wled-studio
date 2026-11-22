// SPDX-License-Identifier: EUPL-1.2
import { fromHex, toHex } from "../colour";
import type { Effect, Profile, Segment } from "../types";

interface Props {
  effect: Effect;
  segment: Segment;
  palettes: Profile["palettes"];
  rgbw: boolean;
  onChange: (patch: Partial<Segment>) => void;
}

/** The controls an effect uses, labelled as the effect labels them (WLED's effect metadata). */
export function EffectControls({ effect, segment, palettes, rgbw, onChange }: Props) {
  const sliders = effect.controls.filter((c) => c.kind === "slider");
  const checks = effect.controls.filter((c) => c.kind === "checkbox");
  return (
    <div className="controls">
      {sliders.map((c) => (
        <label key={c.key} className="slider">
          <span>{c.label}</span>
          <input
            type="range"
            min={c.min}
            max={c.max}
            value={Number(segment[c.key] ?? c.default ?? 0)}
            aria-label={c.label}
            onChange={(e) => onChange({ [c.key]: Number(e.target.value) })}
          />
          <output>{Number(segment[c.key] ?? 0)}</output>
        </label>
      ))}
      {checks.length > 0 && (
        <div className="checks">
          {checks.map((c) => (
            <label key={c.key}>
              <input
                type="checkbox"
                checked={Boolean(segment[c.key])}
                aria-label={c.label}
                onChange={(e) => onChange({ [c.key]: e.target.checked })}
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
      {effect.colours.length > 0 && (
        <div className="colours">
          {effect.colours.map((label, i) => {
            const col = segment.col?.[i] ?? [0, 0, 0, 0];
            return (
              <label key={i} className="colour">
                <span>{label}</span>
                <input
                  type="color"
                  value={toHex(col)}
                  aria-label={`Colour ${label}`}
                  onChange={(e) => {
                    const cols = [...(segment.col ?? [])];
                    cols[i] = fromHex(e.target.value, rgbw ? (col[3] ?? 0) : undefined);
                    onChange({ col: cols });
                  }}
                />
                {rgbw && (
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={col[3] ?? 0}
                    aria-label={`White ${label}`}
                    title="White channel"
                    onChange={(e) => {
                      const cols = [...(segment.col ?? [])];
                      const base = cols[i] ?? [0, 0, 0, 0];
                      cols[i] = [base[0], base[1], base[2], Number(e.target.value)];
                      onChange({ col: cols });
                    }}
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
      {effect.palette && (
        <label className="palette">
          <span>Palette</span>
          <select value={segment.pal} aria-label="Palette" onChange={(e) => onChange({ pal: Number(e.target.value) })}>
            {palettes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {effect.controls.length === 0 && effect.colours.length === 0 && !effect.palette && (
        <p className="muted">This effect has no settings.</p>
      )}
    </div>
  );
}
