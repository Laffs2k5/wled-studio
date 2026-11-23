// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen } from "@testing-library/react";
import type { Room } from "../room";
import { walls } from "../room";
import { state } from "../test/fixtures";
import { BLEND_MODES, SegmentLayout } from "./SegmentLayout";

const seg = { ...state.seg[0], start: 10, stop: 40 };
const room: Room = { edges: [{ direction: "right", pixels: 20, label: "A" }, { direction: "down", pixels: 10 },
  { direction: "left", pixels: 30, label: "L2" }] };

function setup(over = {}, r: Room | null = room) {
  const onChange = vi.fn();
  render(<SegmentLayout segment={{ ...seg, ...over }} ledCount={60} room={r} onChange={onChange} />);
  return onChange;
}

test("walls are the labelled edges as LED ranges", () => {
  expect(walls(room)).toEqual([{ label: "A", start: 0, stop: 20 }, { label: "L2", start: 30, stop: 60 }]);
});

test("bounds are sent when the field is left, clamped so the segment never becomes empty", () => {
  const onChange = setup();
  const start = screen.getByLabelText("Start");
  fireEvent.change(start, { target: { value: "4" } });
  expect(onChange).not.toHaveBeenCalled(); // not per keystroke
  fireEvent.blur(start);
  expect(onChange).toHaveBeenLastCalledWith({ start: 4 });
  fireEvent.change(start, { target: { value: "99" } });
  fireEvent.keyDown(start, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith({ start: 39 }); // at most stop - 1
  const stop = screen.getByLabelText("Stop");
  fireEvent.change(stop, { target: { value: "500" } });
  fireEvent.blur(stop);
  expect(onChange).toHaveBeenLastCalledWith({ stop: 60 }); // at most the LED count
});

test("an unusable number is put back, and an unchanged one isn't sent", () => {
  const onChange = setup();
  const grp = screen.getByLabelText("Grouping");
  fireEvent.change(grp, { target: { value: "1.5" } });
  fireEvent.blur(grp);
  expect(grp).toHaveValue(1);
  fireEvent.change(grp, { target: { value: "1" } });
  fireEvent.blur(grp);
  expect(onChange).not.toHaveBeenCalled();
});

test("picking a wall sets both bounds at once; a matching segment shows its wall", () => {
  const onChange = setup();
  expect(screen.getByLabelText("Wall or zone")).toHaveValue("-1");
  fireEvent.change(screen.getByLabelText("Wall or zone"), { target: { value: "1" } });
  expect(onChange).toHaveBeenLastCalledWith({ start: 30, stop: 60 });
});

test("a segment on a wall says so", () => {
  setup({ start: 30, stop: 60 });
  expect(screen.getByLabelText("Wall or zone")).toHaveValue("1");
  expect(screen.getByText("L2")).toBeInTheDocument();
});

test("no wall picker without a room model", () => {
  setup({}, null);
  expect(screen.queryByLabelText("Wall or zone")).toBeNull();
});

test("flags, grouping, opacity and blend mode are segment patches", () => {
  const onChange = setup();
  fireEvent.click(screen.getByLabelText("Reverse segment"));
  expect(onChange).toHaveBeenLastCalledWith({ rev: true });
  fireEvent.click(screen.getByLabelText("Mirror segment"));
  expect(onChange).toHaveBeenLastCalledWith({ mi: true });
  fireEvent.click(screen.getByLabelText("Segment on"));
  expect(onChange).toHaveBeenLastCalledWith({ on: false });
  const spc = screen.getByLabelText("Spacing");
  fireEvent.change(spc, { target: { value: "2" } });
  fireEvent.blur(spc);
  expect(onChange).toHaveBeenLastCalledWith({ spc: 2 });
  const of = screen.getByLabelText("Offset");
  fireEvent.change(of, { target: { value: "70" } });
  fireEvent.blur(of);
  expect(onChange).toHaveBeenLastCalledWith({ of: 29 }); // within the segment
  fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "90" } });
  expect(onChange).toHaveBeenLastCalledWith({ bri: 90 });
  fireEvent.change(screen.getByLabelText("Blend mode"), { target: { value: "10" } });
  expect(onChange).toHaveBeenLastCalledWith({ bm: 10 });
});

test("WLED 16's 17 blend modes, and a newer firmware's unknown mode is kept", () => {
  expect(BLEND_MODES).toHaveLength(17);
  expect(BLEND_MODES[16]).toBe("Stencil");
  setup({ bm: 20 });
  expect(screen.getByLabelText("Blend mode")).toHaveValue("20");
  expect(screen.getByText(/mode 20/)).toBeInTheDocument();
});

test("zones are offered after the walls", () => {
  const onChange = vi.fn();
  render(<SegmentLayout segment={seg} ledCount={60} onChange={onChange}
    room={{ ...room, zones: [{ label: "Door", start: 32, stop: 40 }] }} />);
  const pick = screen.getByLabelText("Wall or zone");
  expect(screen.getByRole("group", { name: "Zones" })).toBeInTheDocument();
  fireEvent.change(pick, { target: { value: "2" } });
  expect(onChange).toHaveBeenLastCalledWith({ start: 32, stop: 40 });
});

test("name, freeze and, for sound effects, the sound simulation", () => {
  const onChange = setup();
  const name = screen.getByLabelText("Name");
  fireEvent.change(name, { target: { value: "Over the door" } });
  fireEvent.blur(name);
  expect(onChange).toHaveBeenLastCalledWith({ n: "Over the door" });
  fireEvent.click(screen.getByLabelText("Freeze segment"));
  expect(onChange).toHaveBeenLastCalledWith({ frz: true });
  expect(screen.queryByLabelText("Sound simulation")).toBeNull();
});

test("the sound simulation shows for a sound effect", () => {
  const onChange = vi.fn();
  render(<SegmentLayout segment={{ ...seg, si: 1 }} ledCount={60} room={null} audio onChange={onChange} />);
  const si = screen.getByLabelText("Sound simulation");
  expect(si).toHaveValue("1");
  fireEvent.change(si, { target: { value: "3" } });
  expect(onChange).toHaveBeenLastCalledWith({ si: 3 });
});
