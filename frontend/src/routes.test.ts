// SPDX-License-Identifier: EUPL-1.2
import { parseRoute, routeHash } from "./routes";

test("routes name the view, device, firmware job and source file", () => {
  expect(parseRoute("#/library?device=desk")).toEqual({ view: "looks", device: "desk" });
  expect(parseRoute("#/firmware/job/job%201?device=desk")).toEqual({ view: "firmware", device: "desk", job: "job 1" });
  expect(parseRoute("#/code/my_fx/my_fx.cpp?device=desk")).toEqual({
    view: "studio", device: "desk", folder: "my_fx", file: "my_fx.cpp",
  });
  expect(routeHash({ view: "studio", folder: "my fx", file: "a b.cpp", device: "desk" }))
    .toBe("#/code/my%20fx/a%20b.cpp?device=desk");
});
