// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen } from "@testing-library/react";
import { profile } from "../test/fixtures";
import { EffectList } from "./EffectList";

const names = () => screen.getAllByRole("option").map((o) => o.textContent?.replace("♪", ""));

test("hides 2D-only effects on a strip, shows them on a matrix", () => {
  const { rerender } = render(<EffectList effects={profile.effects} selected={8} hasMatrix={false} onSelect={() => {}} />);
  expect(names()).toEqual(["Solid", "Pulse Meter", "Comet"]);
  rerender(<EffectList effects={profile.effects} selected={8} hasMatrix onSelect={() => {}} />);
  expect(names()).toContain("Panel Waves");
});

test("search and the sound-reactive filter", () => {
  render(<EffectList effects={profile.effects} selected={8} hasMatrix={false} onSelect={() => {}} />);
  fireEvent.change(screen.getByLabelText("Search effects"), { target: { value: "com" } });
  expect(names()).toEqual(["Comet"]);
  fireEvent.change(screen.getByLabelText("Search effects"), { target: { value: "" } });
  fireEvent.click(screen.getByLabelText("Sound-reactive only"));
  expect(names()).toEqual(["Pulse Meter"]);
});

test("selecting reports the effect id; the current one is marked", () => {
  const onSelect = vi.fn();
  render(<EffectList effects={profile.effects} selected={8} hasMatrix={false} onSelect={onSelect} />);
  expect(screen.getByRole("option", { name: "Comet" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("option", { name: /Pulse Meter/ }));
  expect(onSelect).toHaveBeenCalledWith(5);
});
