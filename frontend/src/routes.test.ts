// SPDX-License-Identifier: EUPL-1.2
import { parseRoute, routeHash } from "./routes";

test("routes name the five views, compatibility view, device, firmware job and source file", () => {
  expect(parseRoute("")).toEqual({ view: "legacy", device: null });
  expect(parseRoute("#/?device=desk")).toEqual({ view: "legacy", device: "desk" });
  expect(parseRoute("#/design?device=desk")).toEqual({ view: "design", device: "desk" });
  expect(parseRoute("#/saved?device=desk")).toEqual({ view: "library", device: "desk" });
  expect(parseRoute("#/presets?device=desk")).toEqual({ view: "presets", device: "desk" });
  expect(parseRoute("#/library?device=desk")).toEqual({ view: "legacy", device: "desk" });
  expect(parseRoute("#/slots?device=desk")).toEqual({ view: "presets", device: "desk" });
  expect(parseRoute("#/firmware/job/job%201?device=desk")).toEqual({ view: "firmware", device: "desk", job: "job 1" });
  expect(parseRoute("#/code/my_fx/my_fx.cpp?device=desk")).toEqual({
    view: "studio", device: "desk", folder: "my_fx", file: "my_fx.cpp",
  });
  expect(routeHash({ view: "studio", folder: "my fx", file: "a b.cpp", device: "desk" }))
    .toBe("#/code/my%20fx/a%20b.cpp?device=desk");
  expect(routeHash({ view: "legacy", device: "desk" })).toBe("#/library?device=desk");
  expect(routeHash({ view: "design", device: "desk" })).toBe("#/design?device=desk");
  expect(routeHash({ view: "library", device: "desk" })).toBe("#/saved?device=desk");
  expect(routeHash({ view: "presets", device: "desk" })).toBe("#/presets?device=desk");
});
