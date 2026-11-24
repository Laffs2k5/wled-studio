// SPDX-License-Identifier: EUPL-1.2
import { boardName, matchingTarget, targetFit, targetName } from "./targets";

const T = (release: string, target: string) => ({ pins: `${release}.json`, release, target, verified: ["windows"] });
const targets = [T("acme-16.0.0", "board-one"), T("acme-16.0.0", "dig-next-2"), T("acme-16.0.1", "dig-next-2"), T("acme-16.0.1", "dig-Octa_32-8L")];

test("a target matches the device's release name and version, ignoring case and punctuation", () => {
  const info = { release: "Dig-Next-2", product: "Dig-Next-2", brand: "Acme", ver: "16.0.1" };
  expect(targets.map((t) => targetFit(t, info))).toEqual(["other-board", "other-release", "match", "other-board"]);
  expect(matchingTarget(targets, info)).toBe(targets[2]);
  expect(targetFit(targets[3], { release: "Dig_Octa_32_8L", ver: "16.0.1" })).toBe("match");
  expect(targetFit(targets[2], { product: "dig next 2", ver: "16.0.1" })).toBe("match");   // the product is enough
});

test("no board in the device's info: no fit either way", () => {
  expect(targetFit(targets[0], { release: "", product: null, ver: "16.0.1" })).toBeNull();
  expect(targetFit(targets[0], null)).toBeNull();
  expect(matchingTarget(targets, { release: "Something", ver: "16.0.1" })).toBeUndefined();
});

test("names for people", () => {
  expect(targetName(targets[2])).toBe("dig-next-2 · acme-16.0.1");
  expect(boardName({ release: "Dig-Next-2", ver: "16.0.1" })).toBe("Dig-Next-2, WLED 16.0.1");
  expect(boardName({ product: "Thing" })).toBe("Thing");
});
