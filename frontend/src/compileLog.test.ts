// SPDX-License-Identifier: EUPL-1.2
import { compileDiagnostics, compileMessages } from "./compileLog";

const LOG = [
  "WARNING: arm64-linux binaries are not available for all releases.",
  "wled colours: {'color_blend': 1}",
  "/builder/jobs/x/effects/my_wave/my_wave.cpp:29:26: error: use of undeclared identifier 'sin8_tx'; did you mean 'sin8_t'?",
  "   29 |     const uint8_t wave = sin8_tx(uint8_t(pos - phase));",
  "/builder/preview/shim/wled.h:132:9: note: 'sin8_t' declared here",
  "1 error generated.",
  "em++: error: '/builder/emsdk/clang++ -target wasm32 " + "x".repeat(400) + "' failed",
].join("\n");

test("keeps the compiler's messages, from the first error to the count, and shortens your paths", () => {
  const { lines, more } = compileMessages(LOG, ["my_wave"]);
  expect(more).toBe(false);
  expect(lines.map((l) => l.text)).toEqual([
    "my_wave/my_wave.cpp:29:26: error: use of undeclared identifier 'sin8_tx'; did you mean 'sin8_t'?",
    "   29 |     const uint8_t wave = sin8_tx(uint8_t(pos - phase));",
    "/builder/preview/shim/wled.h:132:9: note: 'sin8_t' declared here",   // not one of your folders
    "1 error generated.",
  ]);
  expect(lines[0].at).toEqual({ folder: "my_wave", file: "my_wave.cpp", line: 29, column: 26 });
  expect(lines[2].at).toBeUndefined();
});

test("without a compiler error: the log's last lines, long ones cut", () => {
  const log = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n" + "y".repeat(500);
  const { lines } = compileMessages(log, [], 5);
  expect(lines.map((l) => l.text.slice(0, 7))).toEqual(["line 26", "line 27", "line 28", "line 29", "yyyyyyy"]);
  expect(lines[4].text.endsWith("…")).toBe(true);
});

test("many errors: the first ones, and a mark that there are more", () => {
  const log = Array.from({ length: 30 }, (_, i) => `fx/a.cpp:${i + 1}:1: error: e${i}`).join("\n");
  const { lines, more } = compileMessages(log, ["fx"], 10);
  expect(lines).toHaveLength(10);
  expect(lines[0].at).toEqual({ folder: "fx", file: "a.cpp", line: 1, column: 1 });
  expect(more).toBe(true);
});

test("parses uncapped diagnostics for the editor", () => {
  expect(compileDiagnostics(LOG, ["my_wave"])).toEqual([{
    folder: "my_wave", file: "my_wave.cpp", line: 29, column: 26, severity: "error",
    message: "use of undeclared identifier 'sin8_tx'; did you mean 'sin8_t'?",
  }]);
});
