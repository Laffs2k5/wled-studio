// SPDX-License-Identifier: EUPL-1.2
import type { EditedLook } from "./components/LookEditor";
import type { CheckItem, Device, DevicePalette, EditingSession, DeviceState, Look, Palette, Playlist, Profile, PushResult } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function detail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    // a validation error: the reasons, without pydantic's "Value error, " in front
    if (Array.isArray(d)) return d.map((x) => (x && typeof x === "object" && "msg" in x ? String(x.msg) : String(x)))
      .map((m) => m.replace(/^Value error, /, "")).join("; ");
    // a look the device can't show: {status, notes}; the notes are the reason, not the JSON
    if (d && typeof d === "object" && "notes" in d && Array.isArray(d.notes) && d.notes.length) return d.notes.map(String).join("; ");
    return JSON.stringify(d);
  }
  return fallback;
}

// the backend's word for a device that failed: "<url>: <exception class>" or "<url>: HTTP <code>"
const DEVICE_FAILURE = /^(?:https?:\/\/(?<host>[^/\s]+)\S*|presets\.json): (?:HTTP (?<code>\d+)|(?<exc>\w+))$/;

/** A device failure in plain words, without the exception's class name; other messages unchanged. */
export function plainDeviceError(message: string): string {
  const m = message.match(DEVICE_FAILURE);
  if (!m?.groups) return message;
  const at = m.groups.host ? `the device at ${m.groups.host}` : "the device";
  if (m.groups.code) return `The ${at.slice(4)} answered with an error (HTTP ${m.groups.code}).`;
  if (/^Connect|Timeout$/.test(m.groups.exc ?? "")) return `The ${at.slice(4)} does not answer. Check that it is powered and on the network.`;
  return `The connection to ${at} broke off. Try again.`;
}

const TOKEN_KEY = "wledstudio.token";

/** The optional access token (WLEDSTUDIO_TOKEN), kept for this browser session only. */
export const token = {
  get: (): string | null => {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t: string | null) => {
    try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage off */ }
  },
};

/** Every write carries X-WLED-Studio: 1 (the backend's cross-site request guard). */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const t = token.get();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  if (method !== "GET") headers["X-WLED-Studio"] = "1";
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const msg = detail(data, `${r.status} ${r.statusText}`);
    throw new ApiError(r.status, r.status === 502 ? plainDeviceError(msg) : msg);
  }

  return data as T;
}

async function transferLibrary(file?: File, mode: "keep" | "replace" = "keep", preview = false): Promise<Blob | object> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = token.get();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  if (file) headers["X-WLED-Studio"] = "1";
  const path = file ? `/api/library/archive/import?mode=${mode}&preview=${preview}` : "/api/library/archive";
  const response = await fetch(path, { method: file ? "POST" : "GET", headers, body: file ?? undefined });
  if (!file) {
    if (!response.ok) throw new ApiError(response.status, await response.text());
    return response.blob();
  }
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, detail(data, `${response.status} ${response.statusText}`));
  return data;
}

const enc = encodeURIComponent;

export interface FirmwareTarget { pins: string; release: string; target: string; verified: string[] }
export interface FirmwareJob {
  id: string;
  kind?: "gate" | "preview";
  state: "queued" | "running" | "passed" | "failed";
  pins: string;
  target: string;
  usermods: string[];
  created: number;
  started?: number;
  finished?: number;
  /** In the job list, for a failed gate job: its report's checks and error (the list has no report). */
  checks?: Record<string, boolean>;
  error?: string | null;
  /** The builder's gate report, passed through as it is (wled-studio-builder: studio/gate.py). */
  report?: { passed: boolean; checks?: Record<string, boolean>; error?: string | null;
    app_slot_bytes?: number | null;
    stock?: { toolchain_host?: string; check?: string[] | null };
    custom?: { firmware_size: number }; objects?: { added: string[]; unexpected: string[]; added_from_usermods?: string[] };
    virtual?: { effects_run?: number; crashed?: string[]; error?: string | null } | null };
}

export interface EffectReplacement {
  old: string;
  choices: { name: string; score: number }[];
}

export const firmware = {
  status: () => request<{ enabled: boolean }>("GET", "/api/firmware/status"),
  targets: () => request<FirmwareTarget[]>("GET", "/api/firmware/targets"),
  usermods: () => request<string[]>("GET", "/api/firmware/usermods"),
  jobs: () => request<FirmwareJob[]>("GET", "/api/firmware/jobs"),
  job: (id: string) => request<FirmwareJob>("GET", `/api/firmware/jobs/${encodeURIComponent(id)}`),
  log: async (id: string) => {
    const t = token.get();
    const r = await fetch(`/api/firmware/jobs/${encodeURIComponent(id)}/log`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    if (!r.ok) throw new ApiError(r.status, `log: ${r.status}`);
    return r.text();
  },
  submit: (pins: string, target: string, usermods: string[]) =>
    request<FirmwareJob>("POST", "/api/firmware/jobs", { pins, target, usermods }),
  preview: (usermods: string[]) => request<FirmwareJob>("POST", "/api/firmware/previews", { usermods }),
  previewUrl: (id: string) => `/api/firmware/jobs/${encodeURIComponent(id)}/preview/preview.mjs`,
  preflight: (id: string, device: string) => request<Preflight>("GET",
    `/api/firmware/jobs/${encodeURIComponent(id)}/preflight?device=${encodeURIComponent(device)}`),
  flashPlan: (id: string, device: string) => request<FlashPlan>("GET",
    `/api/firmware/jobs/${encodeURIComponent(id)}/flash-plan?device=${encodeURIComponent(device)}`),
  flash: (id: string, device: string, confirm: string, notice: string) =>
    request<FlashRun>("POST", `/api/firmware/jobs/${encodeURIComponent(id)}/flash`, { device, confirm, notice }),
  revert: (device: string, confirm: string, notice: string) =>
    request<FlashRun>("POST", `/api/devices/${encodeURIComponent(device)}/revert`, { confirm, notice }),
  notice: () => request<FlashNotice>("GET", "/api/notices/flash"),
  acceptNotice: (version: string, remember: boolean) =>
    request<{ version: string; remembered: boolean }>("POST", "/api/notices/flash", { version, remember }),
  forgetNotice: () => request<{ remembered: boolean }>("DELETE", "/api/notices/flash"),
  run: (id: string) => request<FlashRun>("GET", `/api/flashes/${encodeURIComponent(id)}`),
  previous: (device: string) => request<PreviousFirmware>("GET", `/api/devices/${encodeURIComponent(device)}/previous-firmware`),
  backups: (device: string) => request<string[]>("GET", `/api/devices/${encodeURIComponent(device)}/backups`),
  backup: (device: string, name: string) =>
    request<PresetBackup>("GET", `/api/devices/${encodeURIComponent(device)}/backups/${encodeURIComponent(name)}`),
  presetsOnDevice: (device: string) =>
    request<PresetsOnDevice>("GET", `/api/devices/${encodeURIComponent(device)}/presets-on-device`),
  deletePresets: (device: string, body: { confirm: string; inspected_sha256: string; preset_ids: number[]; override_protected?: number[] }) =>
    request<{ deleted: number[]; backup: string }>("POST", `/api/devices/${encodeURIComponent(device)}/presets/delete`, body),
  restorePresets: (device: string, body: { confirm: string; inspected_sha256: string; backup: string; override_protected?: number[] }) =>
    request<{ restored: string; backup: string }>("POST", `/api/devices/${encodeURIComponent(device)}/presets/restore`, body),
};

/** What a device's other firmware slot holds, as far as the app knows (from its own flashes and reverts). */
export type PreviousFirmware = { known: false } |
  { known: true; ver: string; release: string | null; kind: "flash" | "revert"; when: number | null };

/** What flashing an image to a device would do, and whether it may. */
export interface FlashPlan {
  job: string;
  device: string;
  name: string;
  image: { size?: number; sha256?: string; slot?: number; target?: string; usermods?: string[];
    /** The pins' release ("quinled-16.0.1"), and the effects the image adds to what the device has now. */
    release?: string | null; new_effects?: string[] };
  running: { ver?: string; release?: string; arch?: string; freeheap?: number };
  checks: { id: string; level: "ok" | "warn" | "block"; text: string }[];
  can_flash: boolean;
  busy: boolean;
}

/** Which looks and playlists go on a device: everything (`all`), or a chosen set. */
export interface DeviceSet {
  all: boolean;
  looks: string[];
  playlists: string[];
  brought: string[];
  on_device: { looks: string[]; playlists: string[] };
}

/** The slot grid: preset ids as rows and columns (e.g. a remote's banks), filled from the library. */
export interface SlotGridShape { rows: number; cols: number; first: number; row_step: number; col_step: number; name: string }
export interface SlotCell { row: number; col: number; preset_id: number; kind: "look" | "playlist" | null; name: string | null; base: string | null; notes: string[] }
export interface Slots { grid: SlotGridShape | null; cells: SlotCell[]; id?: string | null; name?: string | null;
  filled?: string; freed?: string[]; protected_by?: string[]; pattern_warning?: string }
export interface NamedGrids { current: string | null; grids: Slots[] }

export const slots = {
  get: () => request<Slots>("GET", "/api/slots"),
  list: () => request<NamedGrids>("GET", "/api/slots/grids"),
  setGrid: (g: SlotGridShape) => request<Slots>("PUT", "/api/slots/grid", g),
  create: (name: string, grid: SlotGridShape) => request<Slots>("POST", "/api/slots/grids", { name, grid }),
  select: (id: string) => request<Slots>("POST", `/api/slots/grids/${encodeURIComponent(id)}/select`),
  rename: (id: string, body: { name?: string; grid?: SlotGridShape }) =>
    request<Slots>("PATCH", `/api/slots/grids/${encodeURIComponent(id)}`, body),
  remove: (id: string) => request<{ current: string | null; grids: string[] }>(
    "DELETE", `/api/slots/grids/${encodeURIComponent(id)}`),
  removeGrid: () => request<Slots>("DELETE", "/api/slots/grid"),
  fill: (pid: number, item: { look: string; mode?: "move" | "also" } | { playlist: string; mode?: "move" | "also" }, grid?: string) =>
    request<Slots>("PUT", `/api/slots/${pid}${grid ? `?grid=${encodeURIComponent(grid)}` : ""}`, item),
  clear: (pid: number, grid?: string) =>
    request<Slots>("DELETE", `/api/slots/${pid}${grid ? `?grid=${encodeURIComponent(grid)}` : ""}`),
};

/** The notice accepted before flashing or reverting (no warranty, no liability, no support). */
export interface FlashNotice { version: string; title: string; text: string; remembered: boolean; accepted: string | null }

/** What a studio file import does (or did): counts, names kept as they are, and the device
 *  sections applied by device name (rooms, sets) or not matched here. Version 1 files carry only
 *  the library, so the rest stays empty. */
export interface ArchiveImport {
  looks: number; playlists: number; palettes: number; kept: string[];
  slot_grids?: number; kept_grids?: string[]; protected_presets?: number;
  rooms?: string[]; sets?: string[]; unmatched_devices?: string[];
}
/** One earlier version of the library: what it held before a save. */
export interface LibraryVersion { name: string; saved: string; looks: number; playlists: number; palettes: number }

export interface DeletedItem {
  id: string;
  kind: "room" | "grid";
  label: string;
  when: string;
  device_id?: string;
  grid_id?: string;
}

export interface RestoredItem {
  kind: "room" | "grid";
  label: string;
  device_id?: string;
  id?: string;
}

export const deleted = {
  list: () => request<DeletedItem[]>("GET", "/api/deleted"),
  restore: (id: string, replace = false) =>
    request<RestoredItem>("POST", `/api/deleted/${encodeURIComponent(id)}/restore`, { replace }),
};

export interface PresetsOnDevice {
  name: string;
  sha256: string;
  /** sha: a short content hash, to compare with a backup; boot: shown at power-on;
   *  in_playlists: the device's playlists that play it; protected_by: remotes, automations, grids. */
  presets: { id: number; name: string; library: boolean; on_device_set: boolean; protected_by?: string[];
    sha?: string; boot?: boolean; in_playlists?: number[] }[];
}
export interface PresetBackup {
  name: string;
  bytes: number;
  sha256: string;
  presets: { id: number; name: string; sha?: string }[];
}

export interface ConfigBackup {
  name: string;
  bytes: number;
  sha256: string;
  source: string;
}
export interface ConfigChange {
  section: string;
  path: string;
  action: "add" | "remove" | "change";
}
export interface ConfigRestorePlan {
  backup: string;
  inspected_sha256: string;
  backup_sha256: string;
  changes: ConfigChange[];
  network_sections: string[];
  identity_match: boolean | null;
  identity_differences: string[];
}

/** A flash or revert as it runs. */
export interface FlashRun {
  id: string;
  kind: "flash" | "revert";
  device: string;
  state: "running" | "done" | "warnings" | "failed";
  steps: { name: string; state: "running" | "ok" | "warn" | "failed"; detail: string }[];
  /** What the device runs afterwards (flash.py's Run.result); empty until the device is back. */
  result?: { ver?: string; effects?: number; image_running?: boolean; presets_changed?: boolean; cfg_changed?: boolean;
    heap_low?: { now: number; before: number } };
}

/** The library checked against a built image, for one device (before it is flashed). */
export interface Preflight {
  job: string;
  device: string;
  effects: number;
  counts: Record<string, number>;
  rows: (CheckItem & { today: CheckItem["status"]; changes: boolean })[];
}

/** An effect folder, with the effect ids its code fixes (`constexpr uint8_t kId = 251;`). */
export interface EffectFolder { folder: string; files: string[]; effect_ids?: number[] }

/** A folder's room_map.h: whether it's there, and which device's room shape it was written from. */
export interface RoomMapStatus {
  exists: boolean;
  device: string | null;
  device_name?: string | null;
  leds?: number;
  written?: string;
  /** That device's room shape changed (or went) since. */
  stale?: boolean;
}

/** An effect folder's git state (effects_git.py); repo false: not a clone. */
export interface GitState {
  repo: boolean;
  branch?: string | null;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  changes?: { status: string; path: string }[];
  last?: { sha: string; subject: string; when: string } | null;
  remote?: string | null;
  can_commit?: boolean;
  can_push?: boolean;
}

export const effects = {
  list: () => request<EffectFolder[]>("GET", "/api/effects"),
  read: (folder: string, name: string) =>
    request<{ content: string }>("GET", `/api/effects/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`),
  save: (folder: string, name: string, content: string) =>
    request<{ bytes: number }>("PUT", `/api/effects/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`, { content }),
  create: (folder: string, title: string, effect_id: number, template: "wave" | "room" = "wave") =>
    request<EffectFolder>("POST", "/api/effects", { folder, title, effect_id, template }),
  roomMap: (folder: string, device: string) =>
    request<{ leds: number }>("POST", `/api/effects/${encodeURIComponent(folder)}/room-map`, { device }),
  roomMapStatus: (folder: string) => request<RoomMapStatus>("GET", `/api/effects/${encodeURIComponent(folder)}/room-map`),
  git: (folder: string) => request<GitState>("GET", `/api/effects/${encodeURIComponent(folder)}/git`),
  gitDiff: (folder: string) =>
    request<{ diff: string; truncated: boolean; new_files: string[] }>("GET", `/api/effects/${encodeURIComponent(folder)}/git/diff`),
  commit: (folder: string, message: string) =>
    request<GitState>("POST", `/api/effects/${encodeURIComponent(folder)}/git/commit`, { message }),
  push: (folder: string) => request<GitState>("POST", `/api/effects/${encodeURIComponent(folder)}/git/push`),
  pull: (folder: string) => request<GitState>("POST", `/api/effects/${encodeURIComponent(folder)}/git/pull`),
};

export const api = {
  protectedPresets: () => request<{ id: number; label: string }[]>("GET", "/api/protected-presets"),
  saveProtectedPresets: (rows: { id: number; label: string }[]) =>
    request<{ id: number; label: string }[]>("PUT", "/api/protected-presets", rows),
  exportLibrary: () => transferLibrary() as Promise<Blob>,
  importLibrary: (file: File, mode: "keep" | "replace", preview = false) =>
    transferLibrary(file, mode, preview) as Promise<ArchiveImport>,
  libraryVersions: () => request<LibraryVersion[]>("GET", "/api/library/versions"),
  restoreLibraryVersion: (name: string) =>
    request<{ looks: number; playlists: number; palettes: number }>("POST", `/api/library/versions/${encodeURIComponent(name)}/restore`, { confirm: "restore" }),
  devices: () => request<Device[]>("GET", "/api/devices"),
  addDevice: (name: string, host: string, pin?: string) =>
    request<Device>("POST", "/api/devices", pin ? { name, host, pin } : { name, host }),
  editDevice: (id: string, body: { name?: string; host?: string; twin_id?: string | null }) =>
    request<Device>("PATCH", `/api/devices/${enc(id)}`, body),
  removeDevice: (id: string) => request<null>("DELETE", `/api/devices/${enc(id)}`),
  setPin: (id: string, pin: string | null) => request<null>("PUT", `/api/devices/${enc(id)}/pin`, { pin }),
  configBackups: (id: string) =>
    request<ConfigBackup[]>("GET", `/api/devices/${enc(id)}/cfg/backups`),
  backupConfig: (id: string) =>
    request<ConfigBackup>("POST", `/api/devices/${enc(id)}/cfg/backups`),
  planConfigRestore: (id: string, backup: string) =>
    request<ConfigRestorePlan>("POST", `/api/devices/${enc(id)}/cfg/restore-plan`, { backup }),
  restoreConfig: (id: string, body: { confirm: string; backup: string; inspected_sha256: string;
    override_device?: boolean; allow_network_changes?: boolean }) =>
    request<{ restored: string; backup: string; differences: ConfigChange[] }>(
      "POST", `/api/devices/${enc(id)}/cfg/restore`, body),
  profile: (id: string) => request<Profile>("GET", `/api/devices/${enc(id)}/profile`),
  state: (id: string) => request<DeviceState>("GET", `/api/devices/${enc(id)}/state`),
  setState: (id: string, patch: object) => request<DeviceState>("POST", `/api/devices/${enc(id)}/state`, patch),
  restoreSnapshot: (id: string, snapshot: DeviceState, currentSha256: string) =>
    request<{ restored: boolean; state: DeviceState }>("POST", `/api/devices/${enc(id)}/snapshots/restore`,
      { snapshot, current_sha256: currentSha256 }),
  importPresets: (id: string) =>
    request<{ imported: string[]; kept_existing: string[]; imported_playlists: string[]; skipped_presets: string[] }>(
      "POST", `/api/devices/${enc(id)}/import`),
  looks: () => request<Look[]>("GET", "/api/looks"),
  setFolder: (kind: "looks" | "playlists", names: string[], folder: string | null) =>
    request<{ moved: string[] }>("POST", `/api/library/${kind}/folder`, { names, folder }),
  setOrder: (kind: "looks" | "playlists", names: string[]) => request<{ order: string[] }>("POST", `/api/library/${kind}/order`, { names }),
  renameFolder: (from: string, to: string | null) => request<{ moved: number }>("POST", "/api/library/folders/rename", { from, to }),
  getSet: (id: string) => request<DeviceSet>("GET", `/api/devices/${enc(id)}/set`),
  putSet: (id: string, looks: string[] | null, playlists: string[] = []) =>
    request<DeviceSet>("PUT", `/api/devices/${enc(id)}/set`, { looks, playlists }),
  addToSet: (id: string, looks: string[], playlists: string[] = []) =>
    request<DeviceSet>("POST", `/api/devices/${enc(id)}/set/add`, { looks, playlists }),
  removeFromSet: (id: string, looks: string[], playlists: string[] = []) =>
    request<DeviceSet>("POST", `/api/devices/${enc(id)}/set/remove`, { looks, playlists }),
  deleteLook: (name: string) => request<null>("DELETE", `/api/looks/${enc(name)}`),
  setPresetId: (name: string, presetId: number | null) =>
    request<{ look: Look; shared_with: string[] }>("PUT", `/api/looks/${enc(name)}/preset-id`, { preset_id: presetId }),
  renameLook: (name: string, to: string) => request<Look>("POST", `/api/looks/${enc(name)}/rename`, { to }),
  palettes: () => request<Palette[]>("GET", "/api/palettes"),
  devicePalettes: (id: string) =>
    request<DevicePalette[]>("GET", `/api/devices/${enc(id)}/palettes`),
  importDevicePalettes: (id: string, palettes: { index: number; name: string }[], replace = false) =>
    request<{ imported: string[]; replaced: string[] }>(
      "POST", `/api/devices/${enc(id)}/palettes/import`, { palettes, replace }),
  putPalette: (p: Palette) => request<Palette>("PUT", `/api/palettes/${enc(p.name)}`, p),
  deletePalette: (name: string) => request<null>("DELETE", `/api/palettes/${enc(name)}`),
  playlists: () => request<Playlist[]>("GET", "/api/playlists"),
  putPlaylist: (p: Playlist) => request<Playlist>("PUT", `/api/playlists/${enc(p.name)}`, p),
  deletePlaylist: (name: string) => request<null>("DELETE", `/api/playlists/${enc(name)}`),
  capture: (id: string, name: string, presetId?: number, keepLayout = false) => {
    const q = [presetId ? `preset_id=${presetId}` : "", keepLayout ? "layout=false" : ""].filter(Boolean).join("&");
    return request<Look>("POST", `/api/devices/${enc(id)}/capture/${enc(name)}` + (q ? `?${q}` : ""));
  },
  editLook: (id: string, name: string) => request<EditedLook>("GET", `/api/devices/${enc(id)}/looks/${enc(name)}/edit`),
  saveEditedLook: (id: string, name: string, body: object) =>
    request<Look>("POST", `/api/devices/${enc(id)}/looks/${enc(name)}`, body),
  effectReplacements: (id: string, name: string) =>
    request<{ replacements: EffectReplacement[] }>("GET",
      `/api/devices/${enc(id)}/looks/${enc(name)}/effect-replacements`),
  replaceEffect: (id: string, name: string, old: string, replacement: string) =>
    request<{ changed: number }>("POST", `/api/devices/${enc(id)}/looks/${enc(name)}/effect-replacements`,
      { old, new: replacement }),
  moveSegment: (id: string, seg: number, direction: "up" | "down") =>
    request<{ id: number }>("POST", `/api/devices/${enc(id)}/segments/${seg}/move?direction=${direction}`),
  duplicateSegment: (id: string, seg: number) =>
    request<{ id: number }>("POST", `/api/devices/${enc(id)}/segments/${seg}/duplicate`),
  apply: (id: string, name: string) =>
    request<{ status: string; notes: string[] }>("POST", `/api/devices/${enc(id)}/apply/${enc(name)}`),
  play: (id: string, playlist: string) =>
    request<{ status: string; notes: string[] }>("POST", `/api/devices/${enc(id)}/play/${enc(playlist)}`),
  check: (id: string) => request<CheckItem[]>("GET", `/api/devices/${enc(id)}/check`),
  session: (id: string) => request<EditingSession>("GET", `/api/devices/${enc(id)}/session`),
  startSession: (id: string) => request<EditingSession>("POST", `/api/devices/${enc(id)}/session`),
  endSession: (id: string, restore: boolean) =>
    request<{ restored: boolean }>("DELETE", `/api/devices/${enc(id)}/session?restore=${restore}`),
  startBankTrial: (id: string) => request<{ active: boolean; current_sha256: string }>(
    "POST", `/api/devices/${enc(id)}/bank-trial`),
  bankTrial: (id: string) => request<{ active: boolean; current_sha256: string | null }>(
    "GET", `/api/devices/${enc(id)}/bank-trial`),
  keepBankTrial: (id: string) => request<void>("DELETE", `/api/devices/${enc(id)}/bank-trial`),
  restoreBankTrial: (id: string, confirm: string, current_sha256: string) =>
    request<{ restored: boolean }>("POST", `/api/devices/${enc(id)}/bank-trial/restore`, { confirm, current_sha256 }),
  firmwareHistory: (id: string) => request<FirmwareHistoryItem[]>(
    "GET", `/api/devices/${enc(id)}/firmware-history`),
  lastPresetWrite: (id: string) => request<{ last_write: string | null }>(
    "GET", `/api/devices/${enc(id)}/last-preset-write`),
  accept: (id: string, name: string) =>
    request<{ look: Look; status: string; notes: string[]; accepted: string[] }>(
      "POST", `/api/devices/${enc(id)}/accept/${enc(name)}`),
  push: (id: string, opts: { dry_run: boolean; adopt_drift?: boolean; adopt_drift_only?: boolean;
    accept_review?: boolean | string[] }) =>
    request<PushResult>("POST", `/api/devices/${enc(id)}/push`, opts),
};

export interface FirmwareHistoryItem {
  id: string | null;
  job: string | null;
  kind: "flash" | "revert";
  state: string;
  when: number | null;
  ver?: string;
  effects?: number;
}
