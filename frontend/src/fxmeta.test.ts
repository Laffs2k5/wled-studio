// SPDX-License-Identifier: EUPL-1.2
import { parseDefaults, parseMeta } from "./fxmeta";

const keys = (meta: string, id = 1) => parseMeta(id, "x", meta).controls.map((c) => c.key);

test("same rules as the backend parser", () => {
  const e = parseMeta(254, "Comet", "Studio Comet@Speed,Tail;!;!;1;sx=128,ix=200");
  expect(e.controls.map((c) => [c.key, c.label, c.default])).toEqual([["sx", "Speed", 128], ["ix", "Tail", 200]]);
  expect(e.colours).toEqual(["Fx"]);
  expect(e.palette).toBe(true);
  expect(e.dimensions).toEqual([1]);
  expect(keys("Speed,Width,,,,Reverse;!;!;1")).toEqual(["sx", "ix", "o1"]);
  expect(keys("a,b,c,d,e,f,g,h")).toEqual(["sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3"]);
  expect(parseMeta(1, "x", "a,b,c,d,e").controls[4].max).toBe(31);
  expect(parseMeta(1, "x", "!;,!,;!").colours).toEqual(["Bg"]);
  expect(parseMeta(1, "x", "!;!;5").palette).toBe(false);
  expect(parseMeta(1, "x", "!;!;!;1vf").audio).toEqual(["volume", "frequency"]);
  expect(parseMeta(1, "x", "!;!;!;12").dimensions).toEqual([1, 2]);
});

test("empty metadata means legacy defaults", () => {
  expect(keys("", 5)).toEqual(["sx", "ix"]);
  expect(keys("", 150)).toEqual(["sx", "ix", "c1", "c2", "c3"]);
  expect(parseMeta(5, "x", "").defined).toBe(false);
});

test("defaults", () => {
  expect(parseDefaults("sx=1, ix=2,pal=35,bad,=3,x=abc")).toEqual({ sx: 1, ix: 2, pal: 35, x: "abc" });
});
