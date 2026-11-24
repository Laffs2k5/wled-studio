// SPDX-License-Identifier: EUPL-1.2
import type { Look, Playlist } from "./types";

export const MAX_PRESET_ID = 250;

/** A preset id field's text: a number 1-250, null when empty, or "bad". */
export function parsePresetId(text: string): number | null | "bad" {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return "bad";
  const n = Number(t);
  return n >= 1 && n <= MAX_PRESET_ID ? n : "bad";
}

/** Who else wants this preset id: looks by name, playlists marked as such. */
export function presetUsers(pid: number, looks: Look[], playlists: Playlist[], but?: string): string[] {
  return [
    ...looks.filter((l) => l.preset_id === pid && l.name !== but).map((l) => `“${l.name}”`),
    ...playlists.filter((p) => p.preset_id === pid).map((p) => `playlist “${p.name}”`),
  ];
}

/** The lowest preset id no look or playlist in the library has, if any is left. */
export function nextFreePresetId(looks: Look[], playlists: Playlist[]): number | null {
  const used = new Set([...looks, ...playlists].map((x) => x.preset_id).filter((x): x is number => typeof x === "number"));
  for (let i = 1; i <= MAX_PRESET_ID; i++) if (!used.has(i)) return i;
  return null;
}

/** The warning when an id is taken: what saving does, and what it blocks. */
export function takenWarning(pid: number, users: string[]): string {
  return `Preset ${pid} is used by ${users.join(" and ")}: saving gives two looks the same id, and nothing can be `
    + "written to the device until one of them changes.";
}
