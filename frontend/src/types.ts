// SPDX-License-Identifier: EUPL-1.2
export interface Device {
  id: string;
  name: string;
  host: string;
  has_pin: boolean;
  /** A virtual WLED (no LEDs, can't be flashed), as the device said when the app last read it. */
  virtual?: boolean;
  /** The virtual firmware twin this real device is linked to for offline work. */
  twin_id?: string | null;
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
  /** Library-only grouping; never written to a device. */
  folder?: string;
}

export interface PushReportItem {
  look?: string;
  playlist?: string;
  preset_id?: number;
  status: "ok" | "remapped" | "check" | "review" | "unavailable";
  notes: string[];
  written?: boolean;
  /** Whether writing changes the device's preset at this id. */
  changed?: boolean;
  /** What the device holds at this id now: its name, or null when nothing is stored there. */
  on_device?: string | null;
}

/** A preset id more than one look or playlist wants: it blocks the write. */
export interface DuplicateId { preset_id: number; looks: string[]; playlists: string[] }

/** An editing session on a device: its state when editing started is put back at the end. */
export interface EditingSession {
  active: boolean;
  started: number | null;
  /** What the strip showed when the session started: the preset or playlist it played, its effects. */
  showed?: { preset: number | null; playlist: number | null; fx: number[] } | null;
}

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
  duplicates?: DuplicateId[] | null;
  /** When the app last wrote this device's presets (ISO 8601), if it has. */
  last_write?: string | null;
  drift_items?: { preset_id: string; action: "added" | "changed" | "removed"; name: string; previous_name?: string }[];
}

export interface PlaylistEntry { look: string; duration: number; transition: number }

export interface Playlist {
  name: string;
  preset_id?: number;
  entries: PlaylistEntry[];
  repeat: number;
  shuffle: boolean;
  end?: string;
  folder?: string;
}

export type PaletteStop = [number, string]; // [position 0-255, "rrggbb"]

export interface Palette { name: string; stops: PaletteStop[] }

export interface DevicePalette {
  index: number;
  id: number;
  stops: PaletteStop[];
  owned: boolean;
  owned_name: string | null;
  in_library: boolean;
  library_name: string | null;
}
