// SPDX-License-Identifier: EUPL-1.2
import { render, screen } from "@testing-library/react";
import { BuildChecks } from "./BuildChecks";
import { gatePhase } from "../gate";

const base = { id: "x", pins: "q.json", target: "board", usermods: ["fx"], created: Date.now() / 1000 - 30 };
const STOCK = "+ /py studio/build.py /pins/q.json --target board --out /jobs/x/stock --check\nCompiling…";
const CUSTOM = `${STOCK}\n+ /py studio/build.py /pins/q.json --target board --out /jobs/x/custom --usermod /fx\nLinking…`;
const TWIN = `${CUSTOM}\n+ /py studio/virtual_check.py --wled /w\nran 3 effects`;

test("the log says how far a gate build has got", () => {
  expect(gatePhase("")).toBe(0);
  expect(gatePhase(STOCK)).toBe(0);
  expect(gatePhase(CUSTOM)).toBe(1);
  expect(gatePhase(TWIN)).toBe(3);
});

const states = () => [...screen.getByLabelText("Gate checks").querySelectorAll("li")].map((li) => li.className);

test("a running build: the four checks pending, the current one running, and the time so far", () => {
  render(<BuildChecks job={{ ...base, state: "running", started: Date.now() / 1000 - 25 }} log={CUSTOM} />);
  expect(states()).toEqual(["step-past", "step-running", "step-running", "step-pending"]);
  expect(screen.getByText(/^Running, 0:2\d \(usually 2–5 min\)\.$/)).toBeInTheDocument();
  expect(screen.getByText(/Every effect runs in the virtual twin without crashing/)).toBeInTheDocument();
  expect(screen.getByText("Show build log").closest("details")).not.toHaveAttribute("open");
});

test("a queued build waits, with every check pending", () => {
  render(<BuildChecks job={{ ...base, state: "queued" }} log="" />);
  expect(states()).toEqual(["step-pending", "step-pending", "step-pending", "step-pending"]);
  expect(screen.getByText(/^Waiting for the builder to start it, 0:\d\d/)).toBeInTheDocument();
});

test("a build that failed before its report: where it stopped, and the log open", () => {
  render(<BuildChecks job={{ ...base, state: "failed", started: 100, finished: 165 }} log={STOCK} />);
  expect(states()).toEqual(["step-stopped", "step-skipped", "step-skipped", "step-skipped"]);
  expect(screen.getByText(/stopped before its checks had a result/)).toBeInTheDocument();
  expect(screen.getByText("Took 1:05.")).toBeInTheDocument();
  expect(screen.getByText("Show build log").closest("details")).toHaveAttribute("open");
});

test("a finished build: the report's checks, ticked or crossed", () => {
  render(<BuildChecks job={{ ...base, state: "failed", report: { passed: false, error: "boom",
    checks: { stock_matches_verified: true, fits_app_slot: false } } }} log={TWIN} />);
  expect(screen.getByText("✓ The rebuilt vendor image matches the verified one", { exact: false })).toBeInTheDocument();
  expect(screen.getByText(/✗ Too big for the firmware slot/)).toBeInTheDocument();
  expect(screen.getByText("boom")).toBeInTheDocument();
  expect(screen.queryByText(/stopped before its checks/)).toBeNull();
});
