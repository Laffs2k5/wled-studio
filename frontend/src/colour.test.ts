// SPDX-License-Identifier: EUPL-1.2
import { fromHex, toHex } from "./colour";

test("hex round trip", () => {
  expect(toHex([255, 16, 0])).toBe("#ff1000");
  expect(toHex(undefined)).toBe("#000000");
  expect(toHex([300, -5, 1.7])).toBe("#ff0001");
  expect(fromHex("#ff1000")).toEqual([255, 16, 0]);
  expect(fromHex("00ff00", 7)).toEqual([0, 255, 0, 7]);
  expect(() => fromHex("red")).toThrow();
});
