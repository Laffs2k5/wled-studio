// SPDX-License-Identifier: EUPL-1.2
import { layout, totalPixels } from "./room";

test("lays pixels out along the edges, in index order", () => {
  const room = { edges: [{ direction: "right" as const, pixels: 3 }, { direction: "down" as const, pixels: 2 }] };
  const { points, min, max } = layout(room);
  expect(points).toEqual([[0.5, 0], [1.5, 0], [2.5, 0], [3, 0.5], [3, 1.5]]);
  expect(min).toEqual([0, 0]);
  expect(max).toEqual([3, 1.5]);
  expect(totalPixels(room)).toBe(5);
});

test("a closed rectangle (the gaming room: A, L2, B, L1)", () => {
  const room = { edges: [{ direction: "right" as const, pixels: 40 }, { direction: "down" as const, pixels: 84 },
    { direction: "left" as const, pixels: 41 }, { direction: "up" as const, pixels: 85 }] };
  const { points } = layout(room);
  expect(points).toHaveLength(250);
  expect(points[39]).toEqual([39.5, 0]);   // the last LED on wall A, at corner C1
  expect(points[40]).toEqual([40, 0.5]);   // the first on L2
});

function fakeCtx() {
  const rects: { fill: string; x: number; y: number; w: number; h: number }[] = [];
  const ctx = { fillStyle: "", fillRect(x: number, y: number, w: number, h: number) { rects.push({ fill: String(this.fillStyle), x, y, w, h }); } };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

test("draws a straight strip without a room", async () => {
  const { drawPixels } = await import("./room");
  const { ctx, rects } = fakeCtx();
  drawPixels(ctx, 100, 20, [255, 0, 0, 0, 255, 0], null);
  expect(rects.slice(1).map((r) => r.fill)).toEqual(["rgb(255,0,0)", "rgb(0,255,0)"]);
  expect(rects[2].x).toBe(50);
});

test("draws along the room's shape", async () => {
  const { drawPixels } = await import("./room");
  const { ctx, rects } = fakeCtx();
  const room = { edges: [{ direction: "right" as const, pixels: 2 }, { direction: "down" as const, pixels: 2 }] };
  drawPixels(ctx, 200, 200, [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4], room);
  const px = rects.slice(1);
  expect(px.map((r) => r.fill)).toEqual(["rgb(1,1,1)", "rgb(2,2,2)", "rgb(3,3,3)", "rgb(4,4,4)"]);
  expect(px[0].y).toBeCloseTo(px[1].y);          // along the top
  expect(px[3].y).toBeGreaterThan(px[2].y);      // then down the side
  expect(px[2].x).toBeCloseTo(px[3].x);
});
