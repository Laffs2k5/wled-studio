// SPDX-License-Identifier: EUPL-1.2
import { nextFreePresetId, parsePresetId, presetUsers, takenWarning } from "./presets";

const looks = [{ name: "A", preset_id: 1, segments: [] }, { name: "B", preset_id: 3, segments: [] }, { name: "C", segments: [] }];
const playlists = [{ name: "Mix", preset_id: 2, entries: [], repeat: 0, shuffle: false }];

test("parses a preset id field", () => {
  expect(parsePresetId(" 7 ")).toBe(7);
  expect(parsePresetId("")).toBeNull();
  for (const bad of ["0", "251", "1.5", "x"]) expect(parsePresetId(bad)).toBe("bad");
});

test("who has an id, and the next free one", () => {
  expect(presetUsers(1, looks, playlists)).toEqual(["“A”"]);
  expect(presetUsers(1, looks, playlists, "A")).toEqual([]);
  expect(presetUsers(2, looks, playlists)).toEqual(["playlist “Mix”"]);
  expect(nextFreePresetId(looks, playlists)).toBe(4);
  expect(nextFreePresetId([], [])).toBe(1);
  const full = Array.from({ length: 250 }, (_, i) => ({ name: `L${i}`, preset_id: i + 1, segments: [] }));
  expect(nextFreePresetId(full, [])).toBeNull();
  expect(takenWarning(3, ["“B”"])).toMatch(/^Preset 3 is used by “B”: saving gives two looks the same id/);
});
