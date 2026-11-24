// SPDX-License-Identifier: EUPL-1.2
import { gateLines } from "./gate";

test("a passed gate: each check's outcome and what it means, no raw keys", () => {
  const lines = gateLines({ passed: true, app_slot_bytes: 1000, custom: { firmware_size: 630 }, virtual: { effects_run: 12 },
    checks: { stock_matches_verified: true, only_usermod_objects_changed: true, fits_app_slot: true, virtual_twin: true } });
  expect(lines.map((l) => l.text)).toEqual([
    "The rebuilt vendor image matches the verified one",
    "Only your effect code was added",
    "Fits the firmware slot (63 % used)",
    "All 12 effects ran in the virtual twin without crashing",
  ]);
  expect(lines.every((l) => l.ok && l.meaning)).toBe(true);
  expect(JSON.stringify(lines)).not.toMatch(/_/);
});

test("a failed check carries the builder's reason on its line", () => {
  const [stock, objects, size, twin] = gateLines({ passed: false, app_slot_bytes: 1000, custom: { firmware_size: 990 },
    stock: { toolchain_host: "linux-aarch64", check: ["no verified result for toolchain host 'linux-aarch64' yet"] },
    objects: { added: [], unexpected: ["a.o", "b.o", "c.o", "d.o"] }, virtual: { crashed: ["Sky: abort"] },
    checks: { stock_matches_verified: false, only_usermod_objects_changed: false, fits_app_slot: false, virtual_twin: false } });
  expect(stock.text).toBe("The rebuilt vendor image doesn't match the verified one: no verified result for this build machine (linux-aarch64) yet");
  expect(stock.meaning).toMatch(/can't be flashed. Nothing is wrong with your effect code/);
  expect(objects.text).toBe("Something besides your effect code changed: 4 other files differ (a.o, b.o, c.o, and 1 more)");
  expect(size.text).toBe("Too big for the firmware slot (99 % of it, past the safety margin)");
  expect(twin.text).toBe("An effect failed in the virtual twin: Sky: abort crashed");
  expect([stock, objects, size, twin].every((l) => !l.ok && l.meaning.startsWith("This image can't be flashed."))).toBe(true);
});

test("without details, a failed line still reads; an unknown check isn't shown by its key", () => {
  const lines = gateLines({ passed: false, objects: { added: [], unexpected: [] }, virtual: { error: "emsdk missing" },
    checks: { stock_matches_verified: false, only_usermod_objects_changed: false, fits_app_slot: true, virtual_twin: false, new_thing: false } });
  expect(lines.map((l) => l.text)).toEqual([
    "The rebuilt vendor image doesn't match the verified one",
    "Something besides your effect code changed: your effects added no code",
    "Fits the firmware slot",
    "An effect failed in the virtual twin: emsdk missing",
    "A further check by the builder failed",
  ]);
  expect(gateLines(undefined)).toEqual([]);
  expect(gateLines({ passed: true, checks: { new_thing: true } })[0].text).toBe("A further check by the builder passed");
});
