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

test("a closed rectangle", () => {
  const room = { edges: [{ direction: "right" as const, pixels: 30 }, { direction: "down" as const, pixels: 60 },
    { direction: "left" as const, pixels: 30 }, { direction: "up" as const, pixels: 60 }] };
  const { points } = layout(room);
  expect(points).toHaveLength(180);
  expect(points[29]).toEqual([29.5, 0]);   // the last LED on the first wall, at the corner
  expect(points[30]).toEqual([30, 0.5]);   // the first on the second
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

test("LED positions, the LED under a point, the topmost segment there, walls and zones", async () => {
  const { areas, ledAt, ledPositions, segmentAt } = await import("./room");
  const strip = ledPositions(4, 40, 10, null);
  expect(strip.map((p) => p.x)).toEqual([5, 15, 25, 35]);
  expect(ledAt(strip, 27, 3)).toBe(2);
  expect(ledAt([], 1, 1)).toBe(-1);
  const room = { edges: [{ direction: "right" as const, pixels: 3, label: "A" }, { direction: "down" as const, pixels: 2 }],
    zones: [{ label: "Door", start: 3, stop: 5 }] };
  expect(ledPositions(5, 100, 100, room)).toHaveLength(5);
  expect(segmentAt([{ id: 0, start: 0, stop: 5 }, { id: 2, start: 1, stop: 2 }], 1)?.id).toBe(2);
  expect(segmentAt([{ id: 0, start: 0, stop: 5 }], 9)).toBeUndefined();
  expect(areas(room)).toEqual([{ kind: "wall", label: "A", start: 0, stop: 3 }, { kind: "zone", label: "Door", start: 3, stop: 5 }]);
  expect(areas(null)).toEqual([]);
});

test("the map colours the selected segment, others and a drag", async () => {
  const { drawMap } = await import("./room");
  const { ctx, rects } = fakeCtx();
  const pos = [0, 1, 2, 3].map((i) => ({ x: i * 10 + 5, y: 5, size: 9 }));
  drawMap(ctx, 40, 10, pos, [{ id: 0, start: 0, stop: 2 }, { id: 1, start: 2, stop: 3 }], 1, null, true);
  expect(rects.slice(1).map((r) => r.fill)).toEqual(["#4a505a", "#4a505a", "#6ea8ff", "#22262e"]);
  const again = fakeCtx();
  drawMap(again.ctx, 40, 10, pos, [], null, [3, 2], false);
  expect(again.rects.slice(1).map((r) => r.fill)).toEqual(["#22262e", "#22262e", "#ffb347", "#ffb347"]);
});

test("a room narrower than the canvas is drawn in the middle", async () => {
  const { ledPositions } = await import("./room");
  const tall = { edges: [{ direction: "down" as const, pixels: 10 }, { direction: "right" as const, pixels: 2 }] };
  const xs = ledPositions(12, 400, 100, tall).map((p) => p.x);
  expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(200, 0);
});

test("the gap: where the walls end, against where they start", async () => {
  const { gap, gapText } = await import("./room");
  const closed = { edges: [{ direction: "right", pixels: 5 }, { direction: "down", pixels: 3 }, { direction: "left", pixels: 5 }, { direction: "up", pixels: 3 }] } as const;
  expect(gap(closed as never)).toEqual([0, 0]);
  expect(gapText(closed as never)).toBe("");
  const open = { edges: [{ direction: "right", pixels: 2 }, { direction: "down", pixels: 7 }, { direction: "left", pixels: 7 }, { direction: "up", pixels: 2 }] } as const;
  expect(gapText(open as never)).toBe("The walls end 5 to the left and 5 down of where they start (in LEDs)");
});
