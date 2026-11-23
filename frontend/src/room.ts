// SPDX-License-Identifier: EUPL-1.2
// The room model: the strip's shape as edges in LED index order (direction + pixel count).

export type Direction = "up" | "right" | "down" | "left";
export interface RoomEdge { direction: Direction; pixels: number; label?: string }
export interface Room { edges: RoomEdge[] }

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

export function totalPixels(room: Room): number {
  return room.edges.reduce((n, e) => n + e.pixels, 0);
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
  const { points, min, max } = layout(room);
  const pad = 8, sx = (w - 2 * pad) / Math.max(1, max[0] - min[0]), sy = (h - 2 * pad) / Math.max(1, max[1] - min[1]);
  const s = Math.min(sx, sy), size = Math.max(2, s * 0.8);
  points.forEach(([px, py], i) => {
    if (i >= n) return;
    ctx.fillStyle = colour(i);
    ctx.fillRect(pad + (px - min[0]) * s - size / 2, pad + (py - min[1]) * s - size / 2, size, size);
  });
}
