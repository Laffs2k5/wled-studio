// SPDX-License-Identifier: EUPL-1.2
// Folders and order for library items (looks, playlists): library-only, never written to a device.

export interface Foldered { name: string; folder?: string }

/** Items grouped by folder, in library order: those in no folder first, then each folder in the
 * order its first item appears. */
export function groupByFolder<T extends Foldered>(items: T[]): { folder: string | null; items: T[] }[] {
  const groups = new Map<string | null, T[]>([[null, []]]);
  for (const it of items) {
    const f = it.folder || null;
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f)!.push(it);
  }
  return [...groups].filter(([f, xs]) => f !== null || xs.length > 0).map(([folder, xs]) => ({ folder, items: xs }));
}

export const folders = (items: Foldered[]) => [...new Set(items.map((i) => i.folder).filter((f): f is string => !!f))];

/** The library order with `name` moved one step up or down among `group` (the names in its folder). */
export function moveWithin(order: string[], group: string[], name: string, dir: -1 | 1): string[] {
  const i = group.indexOf(name), j = i + dir;
  if (i < 0 || j < 0 || j >= group.length) return order;
  const a = order.indexOf(group[i]), b = order.indexOf(group[j]);
  const next = [...order];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** The library order with `group`'s names sorted A–Z in the places they already take. */
export function sortWithin(order: string[], group: string[]): string[] {
  const places = order.map((n, i) => (group.includes(n) ? i : -1)).filter((i) => i >= 0);
  const sorted = [...group].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }));
  const next = [...order];
  places.forEach((p, k) => { next[p] = sorted[k]; });
  return next;
}
