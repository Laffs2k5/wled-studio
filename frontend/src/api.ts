// SPDX-License-Identifier: EUPL-1.2
import type { Device, DeviceState, Look, Profile, PushResult } from "./types";

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

/** Every write carries X-WLED-Studio: 1 (the backend's cross-site request guard). */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-WLED-Studio"] = "1";
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(r.status, detail(data, `${r.status} ${r.statusText}`));
  return data as T;
}

const enc = encodeURIComponent;

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
    request<{ imported: string[]; kept_existing: string[]; skipped_presets: string[] }>(
      "POST", `/api/devices/${enc(id)}/import`),
  looks: () => request<Look[]>("GET", "/api/looks"),
  deleteLook: (name: string) => request<null>("DELETE", `/api/looks/${enc(name)}`),
  capture: (id: string, name: string, presetId?: number) =>
    request<Look>("POST", `/api/devices/${enc(id)}/capture/${enc(name)}` + (presetId ? `?preset_id=${presetId}` : "")),
  apply: (id: string, name: string) =>
    request<{ status: string; notes: string[] }>("POST", `/api/devices/${enc(id)}/apply/${enc(name)}`),
  push: (id: string, opts: { dry_run: boolean; adopt_drift?: boolean; accept_review?: boolean }) =>
    request<PushResult>("POST", `/api/devices/${enc(id)}/push`, opts),
};
