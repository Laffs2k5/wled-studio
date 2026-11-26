// SPDX-License-Identifier: EUPL-1.2
import type { DeviceState } from "./types";

export interface LiveSnapshot {
  id: string;
  at: string;
  label: string;
  state: DeviceState;
}

const key = (deviceId: string) => `wledstudio.live-snapshots.${deviceId}`;

export function liveSnapshots(deviceId: string): LiveSnapshot[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(deviceId)) ?? "[]");
    return Array.isArray(value) ? value.slice(0, 8) as LiveSnapshot[] : [];
  } catch {
    return [];
  }
}

export function saveLiveSnapshot(deviceId: string, state: DeviceState, label: string): LiveSnapshot[] {
  const current = JSON.stringify(state);
  const rows = liveSnapshots(deviceId);
  if (rows[0] && JSON.stringify(rows[0].state) === current) return rows;
  const next = [
    { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: new Date().toISOString(), label, state },
    ...rows,
  ].slice(0, 8);
  try { sessionStorage.setItem(key(deviceId), JSON.stringify(next)); } catch { /* storage off */ }
  return next;
}

export function clearLiveSnapshots(deviceId: string): void {
  try { sessionStorage.removeItem(key(deviceId)); } catch { /* storage off */ }
}

export async function stateHash(state: DeviceState): Promise<string> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
      : value;
  const ascii = JSON.stringify(canonical(state)).replace(/[\u007f-\uffff]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const data = new TextEncoder().encode(ascii);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
