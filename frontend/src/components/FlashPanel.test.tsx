// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FlashPanel } from "./FlashPanel";

const JOB = "j".repeat(32);
afterEach(() => vi.unstubAllGlobals());

function stub(plan: object, runs: object[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url.includes("/flash-plan")) return reply(plan);
    if (url.endsWith("/flash") || url.endsWith("/revert")) return reply(runs[0], 202);
    if (url.startsWith("/api/flashes/")) return reply(runs.length > 1 ? runs.splice(0, 1)[0] && runs[0] : runs[0]);
    return reply({ detail: "no" }, 404);
  }));
  return calls;
}

const okPlan = {
  job: JOB, device: "d", name: "Desk", image: { size: 1000, sha256: "ab".repeat(32) }, running: { ver: "16.0.1" }, busy: false,
  can_flash: true, checks: [{ id: "gate", level: "ok", text: "The gate passed." }, { id: "library", level: "warn", text: "2 looks change." }],
};

test("plans, asks for the device's name, flashes and follows the run", async () => {
  const calls = stub(okPlan, [
    { id: "r", kind: "flash", device: "d", state: "running", steps: [{ name: "backup", state: "running", detail: "" }] },
    { id: "r", kind: "flash", device: "d", state: "done", steps: [{ name: "upload", state: "ok", detail: "Update successful!" }] },
  ]);
  render(<FlashPanel job={JOB} device="d" deviceName="Desk" notify={() => {}} />);
  fireEvent.click(screen.getByText("Plan the flash"));
  expect(await screen.findByText(/The gate passed/)).toBeInTheDocument();
  const go = screen.getByText("Flash Desk");
  expect(go).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Type the device's name to flash"), { target: { value: "desk" } });
  expect(go).toBeDisabled();                                       // exactly the name
  fireEvent.change(screen.getByLabelText("Type the device's name to flash"), { target: { value: "Desk" } });
  fireEvent.click(go);
  expect(await screen.findByLabelText("Flash progress")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/Flash: done/)).toBeInTheDocument(), { timeout: 3000 });
  expect(calls.find((c) => c.startsWith("POST") && c.includes("/flash"))).toContain('"confirm":"Desk"');
});

test("a blocking check means no flash button", async () => {
  stub({ ...okPlan, can_flash: false, checks: [{ id: "enabled", level: "block", text: "Flashing is off in this app." }] }, []);
  render(<FlashPanel job={JOB} device="d" deviceName="Desk" notify={() => {}} />);
  fireEvent.click(screen.getByText("Plan the flash"));
  expect(await screen.findByText(/Flashing is off/)).toBeInTheDocument();
  expect(screen.queryByText("Flash Desk")).not.toBeInTheDocument();
  expect(screen.getByText(/Not flashable/)).toBeInTheDocument();
});

test("revert needs the name typed too", async () => {
  const calls = stub(okPlan, [{ id: "v", kind: "revert", device: "d", state: "done", steps: [] }]);
  render(<FlashPanel job={JOB} device="d" deviceName="Desk" notify={() => {}} />);
  const button = screen.getByText("Revert Desk");
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Type the device's name to revert"), { target: { value: "Desk" } });
  fireEvent.click(button);
  await waitFor(() => expect(calls.some((c) => c.startsWith("POST /api/devices/d/revert"))).toBe(true));
});
