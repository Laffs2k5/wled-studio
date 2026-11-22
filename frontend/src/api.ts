// SPDX-License-Identifier: EUPL-1.2
import type { Device, DeviceState, Look, Palette, Playlist, Profile, PushResult } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function detail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => (x && typeof x === "object" && "msg" in x ? String(x.msg) : String(x))).join("; ");
    return JSON.stringify(d);
  }
  return fallback;
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
  if (!r.ok) throw new ApiError(r.status, detail(data, `${r.status} ${r.statusText}`));
  return data as T;
}

const enc = encodeURIComponent;

export interface FirmwareTarget { pins: string; release: string; target: string; verified: string[] }
export interface FirmwareJob {
  id: string;
  state: "queued" | "running" | "passed" | "failed";
  pins: string;
  target: string;
  usermods: string[];
  created: number;
  report?: { passed: boolean; checks?: Record<string, boolean>; error?: string;
    custom?: { firmware_size: number }; objects?: { added: string[]; unexpected: string[] } };
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
};

export const api = {
  devices: () => request<Device[]>("GET", "/api/devices"),
  addDevice: (name: string, host: string, pin?: string) =>
    request<Device>("POST", "/api/devices", pin ? { name, host, pin } : { name, host }),
  removeDevice: (id: string) => request<null>("DELETE", `/api/devices/${enc(id)}`),
  setPin: (id: string, pin: string | null) => request<null>("PUT", `/api/devices/${enc(id)}/pin`, { pin }),
  profile: (id: string) => request<Profile>("GET", `/api/devices/${enc(id)}/profile`),
  state: (id: string) => request<DeviceState>("GET", `/api/devices/${enc(id)}/state`),
  setState: (id: string, patch: object) => request<DeviceState>("POST", `/api/devices/${enc(id)}/state`, patch),
  importPresets: (id: string) =>
    request<{ imported: string[]; kept_existing: string[]; imported_playlists: string[]; skipped_presets: string[] }>(
      "POST", `/api/devices/${enc(id)}/import`),
  looks: () => request<Look[]>("GET", "/api/looks"),
  deleteLook: (name: string) => request<null>("DELETE", `/api/looks/${enc(name)}`),
  palettes: () => request<Palette[]>("GET", "/api/palettes"),
  putPalette: (p: Palette) => request<Palette>("PUT", `/api/palettes/${enc(p.name)}`, p),
  deletePalette: (name: string) => request<null>("DELETE", `/api/palettes/${enc(name)}`),
  playlists: () => request<Playlist[]>("GET", "/api/playlists"),
  putPlaylist: (p: Playlist) => request<Playlist>("PUT", `/api/playlists/${enc(p.name)}`, p),
  deletePlaylist: (name: string) => request<null>("DELETE", `/api/playlists/${enc(name)}`),
  capture: (id: string, name: string, presetId?: number) =>
    request<Look>("POST", `/api/devices/${enc(id)}/capture/${enc(name)}` + (presetId ? `?preset_id=${presetId}` : "")),
  apply: (id: string, name: string) =>
    request<{ status: string; notes: string[] }>("POST", `/api/devices/${enc(id)}/apply/${enc(name)}`),
  push: (id: string, opts: { dry_run: boolean; adopt_drift?: boolean; accept_review?: boolean }) =>
    request<PushResult>("POST", `/api/devices/${enc(id)}/push`, opts),
};
