// SPDX-License-Identifier: EUPL-1.2
// WLED effect metadata -> the controls an effect uses. Mirrors backend/src/wledstudio/fxmeta.py
// (the backend parses device effects; this parses effects in the browser preview).
import type { Control, Effect } from "./types";

const SLIDERS = ["sx", "ix", "c1", "c2", "c3"] as const;
const CHECKS = ["o1", "o2", "o3"] as const;
const SLIDER_LABELS: Record<string, string> = { sx: "Speed", ix: "Intensity", c1: "Custom 1", c2: "Custom 2", c3: "Custom 3" };
const CHECK_LABELS: Record<string, string> = { o1: "Option 1", o2: "Option 2", o3: "Option 3" };
const COLOUR_LABELS = ["Fx", "Bg", "Cs"];

const split = (s: string, sep: string) => (s === "" ? [] : s.split(sep));

export function parseDefaults(s: string): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const item of split(s, ",")) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const key = item.slice(0, eq).trim();
    const value = item.slice(eq + 1).trim();
    if (!key) continue;
    out[key] = /^-?\d+$/.test(value) ? Number(value) : value;
  }
  return out;
}

/** Parse metadata (the part after "Name@", or a full "Name@..." string). */
export function parseMeta(id: number, name: string, meta: string): Effect {
  if (meta.includes("@")) meta = meta.slice(meta.indexOf("@") + 1);
  if (meta === "") {
    const keys = id >= 128 ? SLIDERS : SLIDERS.slice(0, 2);
    return {
      id, name, colours: [...COLOUR_LABELS], palette: true, dimensions: [], audio: [], defaults: {}, defined: false,
      controls: keys.map((k) => ({ key: k, label: SLIDER_LABELS[k], kind: "slider", min: 0, max: k === "c3" ? 31 : 255, default: null })),
    };
  }
  const parts = meta.split(";");
  while (parts.length < 5) parts.push("");
  const [ctrl, col, pal, flags, defs] = parts;
  const defaults = parseDefaults(defs);
  const labels = split(ctrl, ",");
  const controls: Control[] = [];
  [...SLIDERS, ...CHECKS].forEach((key, i) => {
    if (i >= labels.length || labels[i] === "") return;
    const slider = (SLIDERS as readonly string[]).includes(key);
    const label = labels[i] === "!" ? (slider ? SLIDER_LABELS : CHECK_LABELS)[key] : labels[i];
    const d = defaults[key];
    controls.push({ key, label, kind: slider ? "slider" : "checkbox", min: 0, max: slider ? (key === "c3" ? 31 : 255) : 1,
      default: typeof d === "number" ? d : null });
  });
  const colours: string[] = [];
  split(col, ",").slice(0, 3).forEach((lab, i) => {
    if (lab !== "") colours.push(lab === "!" ? COLOUR_LABELS[i] : lab);
  });
  const p = pal.trim();
  const dimensions = [...new Set([...flags].filter((c) => c === "1" || c === "2").map(Number))].sort();
  const audio = [["v", "volume"], ["f", "frequency"]].filter(([c]) => flags.includes(c)).map(([, a]) => a);
  return { id, name, controls, colours, palette: p !== "" && !/^-?\d+$/.test(p), dimensions, audio, defaults, defined: true };
}
