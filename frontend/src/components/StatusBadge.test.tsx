// SPDX-License-Identifier: EUPL-1.2
import { render, screen } from "@testing-library/react";
import { explain, StatusBadge } from "./StatusBadge";

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

test("nothing for an ok look; other statuses as they are", () => {
  const { container } = render(<StatusBadge item={{ look: "x", status: "ok", notes: [] }} />);
  expect(container).toBeEmptyDOMElement();
  render(<StatusBadge item={{ look: "x", status: "review", notes: ["'Comet' changed"] }} />);
  expect(screen.getByText("review")).toHaveAttribute("title", "'Comet' changed");
});
