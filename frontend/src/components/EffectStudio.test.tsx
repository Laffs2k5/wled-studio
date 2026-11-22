// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen } from "@testing-library/react";
import { Preview } from "../preview";
import { EffectStudio } from "./EffectStudio";

/** A fake preview module with the same C API as the WebAssembly build. */
function fakeModule() {
  const names = ["Solid", "RSVD", "Studio Comet", "Glow"];
  const metas = ["", "", "Speed,Tail;!;!;1;sx=100,ix=200", "!,!;!;!;1"];
  const strings: string[] = [];
  const str = (s: string) => { strings.push(s); return strings.length - 1; };
  const sets: [number, number][] = [];
  const heap = new Uint32Array(64);
  const m = {
    sets,
    _preview_setup: () => {},
    _preview_effect_count: () => names.length,
    _preview_effect_name: (id: number) => str(names[id] ?? ""),
    _preview_effect_metadata: (id: number) => str(metas[id] ?? ""),
    _preview_select: (id: number) => id,
    _preview_set: (k: number, v: number) => { sets.push([k, v]); },
    _preview_length: () => 4,
    _preview_frame: () => 0,
    UTF8ToString: (p: number) => strings[p],
    HEAPU32: heap,
  };
  return m;
}

test("lists the build's own effects with their controls, and sends changes to the preview", async () => {
  const m = fakeModule();
  render(<EffectStudio notify={() => {}} load={async () => new Preview(m as never)} />);
  const select = await screen.findByLabelText("Preview effect");
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Studio Comet (id 2)", "Glow (id 3)"]);
  expect(screen.getByLabelText("Tail")).toHaveValue("200");    // the effect's default
  m.sets.length = 0;
  fireEvent.change(screen.getByLabelText("Tail"), { target: { value: "50" } });
  expect(m.sets).toContainEqual([1, 50]);
  fireEvent.input(screen.getByLabelText("Colour Fx"), { target: { value: "#00ff00" } });
  expect(m.sets).toContainEqual([9, 0x0000ff00]);
  fireEvent.change(select, { target: { value: "3" } });
  expect(screen.getByLabelText("Intensity")).toBeInTheDocument();
});

test("explains a build without a preview", async () => {
  render(<EffectStudio notify={() => {}} load={async () => { throw new Error("404"); }} />);
  expect(await screen.findByText(/has no effect preview/)).toBeInTheDocument();
});
