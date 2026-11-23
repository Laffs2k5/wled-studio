// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentMap } from "./SegmentMap";

// jsdom has no PointerEvent: a stand-in, so the map's logic (which LED is under the pointer) runs
// with real coordinates.
beforeAll(() => {
  if (!("PointerEvent" in window)) {
    // @ts-expect-error a minimal stand-in: a MouseEvent carries clientX/clientY
    window.PointerEvent = class extends MouseEvent {};
  }
});
const segments = [{ id: 0, start: 0, stop: 60 }, { id: 1, start: 20, stop: 30 }];

function setup() {
  const onSelect = vi.fn();
  const onPick = vi.fn();
  render(<SegmentMap ledCount={60} room={null} segments={segments} selected={0} onSelect={onSelect} onPick={onPick} />);
  const canvas = screen.getByLabelText(/Segment map/);
  // a 960 x 28 strip: LED i spans x = 16 i .. 16 (i + 1)
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 28, right: 960, bottom: 28, x: 0, y: 0, toJSON() {} });
  return { canvas, onSelect, onPick };
}

test("a click selects the topmost segment under the pointer", () => {
  const { canvas, onSelect, onPick } = setup();
  fireEvent.pointerDown(canvas, { clientX: 25 * 16 + 8, clientY: 14 });
  fireEvent.pointerUp(canvas);
  expect(onSelect).toHaveBeenCalledWith(1);
  expect(onPick).not.toHaveBeenCalled();
});

test("a drag sets the selected segment's LEDs, in either direction", () => {
  const { canvas, onPick } = setup();
  fireEvent.pointerDown(canvas, { clientX: 40 * 16 + 8, clientY: 14 });
  fireEvent.pointerMove(canvas, { clientX: 35 * 16 + 8, clientY: 14 });
  expect(screen.getByText("LEDs 35–40")).toBeInTheDocument();
  fireEvent.pointerUp(canvas);
  expect(onPick).toHaveBeenCalledWith(35, 41);
  expect(screen.getByText("Segment 0: LEDs 0–59")).toBeInTheDocument();
});
