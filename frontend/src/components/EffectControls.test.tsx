// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen } from "@testing-library/react";
import { comet, profile, solid, state } from "../test/fixtures";
import { EffectControls } from "./EffectControls";

const seg = state.seg[0];

test("shows only the effect's controls, with its labels", () => {
  render(<EffectControls effect={comet} segment={seg} palettes={profile.palettes} rgbw onChange={() => {}} />);
  expect(screen.getByLabelText("Speed")).toHaveValue("100");
  expect(screen.getByLabelText("Tail")).toHaveValue("50");
  expect(screen.getByLabelText("Reverse")).not.toBeChecked();
  expect(screen.queryByLabelText("Custom 1")).toBeNull();
  expect(screen.getByLabelText("Colour Fx")).toHaveValue("#ff0000");
  expect(screen.getByLabelText("Colour Bg")).toBeInTheDocument();
  expect(screen.getByLabelText("Palette")).toBeInTheDocument();
});

test("changes are reported as segment patches", () => {
  const onChange = vi.fn();
  render(<EffectControls effect={comet} segment={seg} palettes={profile.palettes} rgbw onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Tail"), { target: { value: "200" } });
  expect(onChange).toHaveBeenLastCalledWith({ ix: 200 });
  fireEvent.click(screen.getByLabelText("Reverse"));
  expect(onChange).toHaveBeenLastCalledWith({ o1: true });
  fireEvent.change(screen.getByLabelText("Palette"), { target: { value: "3" } });
  expect(onChange).toHaveBeenLastCalledWith({ pal: 3 });
});

test("a colour change keeps the white channel; white has its own slider", () => {
  const onChange = vi.fn();
  render(<EffectControls effect={comet} segment={seg} palettes={profile.palettes} rgbw onChange={onChange} />);
  fireEvent.input(screen.getByLabelText("Colour Fx"), { target: { value: "#00ff00" } });
  expect(onChange).toHaveBeenLastCalledWith({ col: [[0, 255, 0, 10], [0, 0, 0, 0]] });
  fireEvent.change(screen.getByLabelText("White Fx"), { target: { value: "99" } });
  expect(onChange).toHaveBeenLastCalledWith({ col: [[255, 0, 0, 99], [0, 0, 0, 0]] });
});

test("no white slider on RGB strips", () => {
  render(<EffectControls effect={comet} segment={seg} palettes={profile.palettes} rgbw={false} onChange={() => {}} />);
  expect(screen.queryByLabelText("White Fx")).toBeNull();
});

test("an effect without settings says so", () => {
  render(<EffectControls effect={solid} segment={seg} palettes={profile.palettes} rgbw onChange={() => {}} />);
  expect(screen.getByText("This effect has no settings.")).toBeInTheDocument();
});
