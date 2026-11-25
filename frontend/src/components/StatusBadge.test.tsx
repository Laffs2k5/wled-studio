// SPDX-License-Identifier: EUPL-1.2
import { render, screen } from "@testing-library/react";
import { changedEffects, explain, Notes, StatusBadge, summariseChanges } from "./StatusBadge";

test("the reasons a look can't be shown, in plain words", () => {
  const item = { look: "x", status: "unavailable" as const, notes: [
    "palette \"Rock'n'roll\" isn't on this device", "wall 'Door' isn't in this device's room model", "'Calm' is unavailable",
    "something else"] };
  expect(explain(item, "Desk").split("\n")).toEqual([
    "Uses palette “Rock'n'roll”, which Desk does not have.",
    "Uses wall “Door”, which isn't in the room shape of Desk.",
    "Plays “Calm”, which Desk can't show.",
    "something else",
  ]);
  expect(explain(undefined)).toBe("");
});

test("with a built image, the badge speaks of the image", () => {
  render(<StatusBadge item={{ look: "x", status: "unavailable", notes: ["effect 'Glow' isn't on this device"] }} image />);
  expect(screen.getByText("not in this firmware")).toHaveAttribute("title", "Uses effect “Glow”, which this firmware does not have.");
});

test("nothing for an ok look; the change check's statuses in words", () => {
  const { container } = render(<StatusBadge item={{ look: "x", status: "ok", notes: [] }} />);
  expect(container).toBeEmptyDOMElement();
  render(<StatusBadge item={{ look: "x", status: "review", notes: ["something new"] }} />);
  expect(screen.getByText("effect changed")).toHaveAttribute("title", "something new");
  render(<StatusBadge item={{ look: "x", status: "check", notes: [] }} />);
  expect(screen.getByText("effect updated")).toBeInTheDocument();
  render(<StatusBadge item={{ look: "x", status: "remapped", notes: ["'Glow': id 3 -> 9"] }} where="Desk" />);
  expect(screen.getByText("effect renumbered")).toHaveAttribute("title",
    "The effect “Glow” has another number on Desk than when this look was saved. The app finds it by name, so the look is the same.");
});

test("an effect's changes, counted in words", () => {
  expect(summariseChanges(["Smear (o2) is gone", "Blur (ix) is gone, not set by this look", "ix relabelled: Blur -> Width",
    "c1 relabelled: A -> B", "new control Size (c2)", "new control Mirror (o3)", "dimensions changed: 2D -> 1D",
    "now sound-reactive", "no longer sound-reactive", "sound input changed: volume -> fft", "colour slots: 3 -> 2",
    "no longer uses a palette", "metadata text changed (defaults or labels)", "odd"])).toEqual([
    "1 slider removed", "1 option removed", "2 sliders renamed", "1 slider added", "1 option added",
    "it is now 1D instead of 2D", "it now reacts to sound", "it no longer reacts to sound", "it reacts to other sound input",
    "fewer colours (2 instead of 3)", "it no longer uses a palette", "default values changed", "odd"]);
  const small = { look: "x", status: "check" as const, notes: ["'Drift' changed: ix relabelled: Blur -> Width",
    "segment 1 follows wall 'L2' to LEDs 10-29"] };
  expect(explain(small, "this firmware").split("\n")).toEqual([
    "The effect “Drift” in this firmware changed a little since this look was saved (1 slider renamed). The look should look the same.",
    "Segment 1 follows wall “L2” (LEDs 10–29).",
  ]);
  expect(changedEffects(small)).toEqual(["Drift"]);
});

test("notes: plain words, the backend's own wording behind Details", () => {
  render(<Notes item={{ look: "x", status: "review", notes: ["'Comet' changed: Tail (ix) is gone"] }} where="Desk" />);
  expect(screen.getByText(/^The effect “Comet” on Desk has different controls/)).toBeInTheDocument();
  expect(screen.getByText("Details")).toBeInTheDocument();
  expect(screen.getByText("'Comet' changed: Tail (ix) is gone")).toBeInTheDocument();
});
