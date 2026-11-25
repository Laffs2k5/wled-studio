// SPDX-License-Identifier: EUPL-1.2
// The room model: the strip's shape as edges in LED index order (direction + pixel count).

export type Direction = "up" | "right" | "down" | "left";
export interface RoomEdge { direction: Direction; pixels: number; label?: string }
/** A named LED range (stop exclusive): a door, a desk. Looks follow it like a wall. */
export interface RoomZone { label: string; start: number; stop: number }
export interface Room { edges: RoomEdge[]; zones?: RoomZone[] }

const STEP: Record<Direction, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

/** Pixel positions (grid units, one per LED), and the bounding box. */
export function layout(room: Room): { points: [number, number][]; min: [number, number]; max: [number, number] } {
  const points: [number, number][] = [];
  let x = 0, y = 0;
  for (const e of room.edges) {
    const [dx, dy] = STEP[e.direction];
    for (let i = 0; i < e.pixels; i++) {
      x += dx; y += dy;
      points.push([x - dx / 2, y - dy / 2]); // the middle of each LED's step
    }
  }
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { points, min: [Math.min(0, ...xs), Math.min(0, ...ys)], max: [Math.max(0, ...xs), Math.max(0, ...ys)] };
}

/** Where the walls end, relative to where they start, in LEDs: [0, 0] when they close round. */
export function gap(room: Room): [number, number] {
  let x = 0, y = 0;
  for (const e of room.edges) {
    const [dx, dy] = STEP[e.direction];
    x += dx * e.pixels; y += dy * e.pixels;
  }
  return [x, y];
}

/** In words, how far the walls end from their start; "" when they close round. */
export function gapText(room: Room): string {
  const [x, y] = gap(room);
  const parts = [x > 0 ? `${x} to the right` : x < 0 ? `${-x} to the left` : "", y > 0 ? `${y} down` : y < 0 ? `${-y} up` : ""]
    .filter(Boolean);
  return parts.length ? `The walls end ${parts.join(" and ")} of where they start (in LEDs)` : "";
}

export function totalPixels(room: Room): number {
  return room.edges.reduce((n, e) => n + e.pixels, 0);
}

export interface Wall { label: string; start: number; stop: number }

/** The labelled edges as LED ranges (stop exclusive, as WLED's segment bounds). */
export function walls(room: Room): Wall[] {
  const out: Wall[] = [];
  let at = 0;
  for (const e of room.edges) {
    if (e.label) out.push({ label: e.label, start: at, stop: at + e.pixels });
    at += e.pixels;
  }
  return out;
}

/** Draw colours (r, g, b per LED) along the room's shape, or as a straight strip without one. */
export function drawPixels(ctx: CanvasRenderingContext2D, w: number, h: number, rgb: ArrayLike<number>, room: Room | null) {
  const n = Math.floor(rgb.length / 3);
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, w, h);
  const colour = (i: number) => `rgb(${rgb[i * 3]},${rgb[i * 3 + 1]},${rgb[i * 3 + 2]})`;
  if (!room || totalPixels(room) === 0) {
    const pw = w / n;
    for (let i = 0; i < n; i++) { ctx.fillStyle = colour(i); ctx.fillRect(i * pw, 4, Math.max(1, pw - 1), h - 8); }
    return;
  }
  ledPositions(n, w, h, room).forEach((p, i) => {
    ctx.fillStyle = colour(i);
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  });
}

/** Where each LED sits on a w × h canvas: along the room's shape, or a straight strip without one. */
export function ledPositions(n: number, w: number, h: number, room: Room | null): { x: number; y: number; size: number }[] {
  if (!room || totalPixels(room) === 0) {
    const pw = w / Math.max(1, n);
    return Array.from({ length: n }, (_, i) => ({ x: i * pw + pw / 2, y: h / 2, size: Math.max(1, pw - 1) }));
  }
  const { points, min, max } = layout(room);
  const spanX = Math.max(1, max[0] - min[0]), spanY = Math.max(1, max[1] - min[1]);
  const pad = 8, s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY), size = Math.max(6, s * 0.8);
  const ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2; // centred, whichever way the room is narrow
  return points.slice(0, n).map(([px, py]) => ({ x: ox + (px - min[0]) * s, y: oy + (py - min[1]) * s, size }));
}

/** The LED nearest to a point on the canvas (-1 if there are none). */
export function ledAt(pos: { x: number; y: number }[], x: number, y: number): number {
  let best = -1, dist = Infinity;
  pos.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < dist) { dist = d; best = i; }
  });
  return best;
}

export interface MapSegment { id: number; start: number; stop: number }

/** The topmost segment (drawn last) that holds an LED. */
export function segmentAt(segments: MapSegment[], led: number): MapSegment | undefined {
  return [...segments].sort((a, b) => b.id - a.id).find((s) => s.start <= led && led < s.stop);
}

/** The segment map: every LED dim, LEDs in some segment lighter, the selected segment's in the
 * accent colour, and a range being dragged in the warning colour. */
export function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, pos: { x: number; y: number; size: number }[],
  segments: MapSegment[], selected: number | null, drag: [number, number] | null, strip: boolean) {
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, w, h);
  const sel = segments.find((s) => s.id === selected);
  const [d0, d1] = drag ? [Math.min(...drag), Math.max(...drag)] : [-1, -2];
  pos.forEach((p, i) => {
    ctx.fillStyle = d0 <= i && i <= d1 ? "#ffb347"
      : sel && sel.start <= i && i < sel.stop ? "#6ea8ff"
        : segments.some((s) => s.start <= i && i < s.stop) ? "#4a505a" : "#22262e";
    if (strip) ctx.fillRect(p.x - p.size / 2, 4, p.size, h - 8);
    else ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  });
}

/** Walls and zones, each as an LED range (stop exclusive), for pickers. */
export function areas(room: Room | null): { kind: "wall" | "zone"; label: string; start: number; stop: number }[] {
  if (!room) return [];
  return [...walls(room).map((w) => ({ kind: "wall" as const, ...w })),
    ...(room.zones ?? []).map((z) => ({ kind: "zone" as const, ...z }))];
}
