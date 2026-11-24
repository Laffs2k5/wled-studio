// SPDX-License-Identifier: EUPL-1.2
import { folders, groupByFolder, moveWithin, sortWithin } from "./organise";

const items = [{ name: "A" }, { name: "F1", folder: "Fire" }, { name: "B" }, { name: "R1", folder: "Rain" }, { name: "F2", folder: "Fire" }];

test("groups: no folder first, then folders in order of first appearance", () => {
  expect(groupByFolder(items).map((g) => [g.folder, g.items.map((i) => i.name)])).toEqual([
    [null, ["A", "B"]], ["Fire", ["F1", "F2"]], ["Rain", ["R1"]]]);
  expect(groupByFolder([{ name: "X", folder: "Z" }]).map((g) => g.folder)).toEqual(["Z"]);   // no empty "no folder" group
  expect(folders(items)).toEqual(["Fire", "Rain"]);
});

test("moving within a folder swaps with its neighbour in that folder, wherever it is in the library", () => {
  const order = items.map((i) => i.name);
  expect(moveWithin(order, ["F1", "F2"], "F2", -1)).toEqual(["A", "F2", "B", "R1", "F1"]);
  expect(moveWithin(order, ["F1", "F2"], "F1", -1)).toBe(order);           // already first
  expect(moveWithin(order, ["A", "B"], "A", 1)).toEqual(["B", "F1", "A", "R1", "F2"]);
});

test("sorting a folder keeps the places its items take", () => {
  expect(sortWithin(["z", "x", "Q", "y10", "y9"], ["z", "y10", "y9"])).toEqual(["y9", "x", "Q", "y10", "z"]);
});
