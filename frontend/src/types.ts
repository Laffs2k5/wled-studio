// SPDX-License-Identifier: EUPL-1.2
export interface Device {
  id: string;
  name: string;
  host: string;
  has_pin: boolean;
}

export interface Control {
  key: string; // sx ix c1 c2 c3 o1 o2 o3
  label: string;
  kind: "slider" | "checkbox";
  min: number;
  max: number;
  default: number | null;
}

export interface Effect {
  id: number;
  name: string;
  controls: Control[];
  colours: string[];
  palette: boolean;
  dimensions: number[];
  audio: string[];
  defaults: Record<string, number | string>;
  defined: boolean;
}

export interface Profile {
  device: { id: string; name: string };
  info: Record<string, string | number | null>;
  leds: { count: number; rgbw: boolean; maxseg: number; matrix?: { w: number; h: number } | null };
  usermods: string[];
  effects: Effect[];
  palettes: { id: number; name: string }[];
  fingerprint: string;
}

export type Colour = number[]; // [r, g, b] or [r, g, b, w]

export interface Segment {
  id: number;
  start: number;
  stop: number;
  on: boolean;
  bri: number;
  fx: number;
  pal: number;
  col: Colour[];
  sx: number;
  ix: number;
  c1: number;
  c2: number;
  c3: number;
  o1: boolean;
  o2: boolean;
  o3: boolean;
  [k: string]: unknown;
}

export interface DeviceState {
  on: boolean;
  bri: number;
  transition?: number;
  seg: Segment[];
  AudioReactive?: { on: boolean };
}

export interface LookSegment {
  start: number;
  stop: number;
  effect?: string;
  palette?: string;
  /** The room model's wall this segment covers: its LEDs follow the wall if the model changes. */
  wall?: string;
  [k: string]: unknown;
}

export interface Look {
  name: string;
  preset_id?: number;
  bri?: number;
  on?: boolean;
  mic?: boolean;
  segments: LookSegment[];
  snapshot?: Record<string, string>;
}

export interface PushReportItem {
  look?: string;
  playlist?: string;
  preset_id?: number;
  status: "ok" | "remapped" | "check" | "review" | "unavailable";
  notes: string[];
  written?: boolean;
}

/** An editing session on a device: its state when editing started is put back at the end. */
export interface EditingSession { active: boolean; started: number | null }

/** A look's or playlist's change-check status on one device (GET /api/devices/<id>/check). */
export interface CheckItem {
  look?: string;
  playlist?: string;
  status: PushReportItem["status"];
  notes: string[];
}

export interface PushResult {
  palettes?: { palette: string; file: string; id: number }[];
  done: boolean;
  drift: boolean;
  report: PushReportItem[];
  changed_ids: string[];
  backup: string | null;
  reason: string | null;
}

export interface PlaylistEntry { look: string; duration: number; transition: number }

export interface Playlist {
  name: string;
  preset_id?: number;
  entries: PlaylistEntry[];
  repeat: number;
  shuffle: boolean;
  end?: string;
}

export type PaletteStop = [number, string]; // [position 0-255, "rrggbb"]

export interface Palette { name: string; stops: PaletteStop[] }
