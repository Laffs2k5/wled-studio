// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FlashPanel } from "./FlashPanel";

const JOB = "j".repeat(32);
afterEach(() => vi.unstubAllGlobals());

const NOTICE = { version: "v1", title: "Flashing firmware: no warranty", text: "No support.", accepted: null };

function stub(plan: object, runs: object[], remembered = false) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url === "/api/notices/flash" && (init?.method ?? "GET") === "GET") return reply({ ...NOTICE, remembered });
    if (url === "/api/notices/flash") return reply({ version: "v1", remembered: JSON.parse(String(init?.body ?? "{}")).remember ?? false });
    if (url.includes("/flash-plan")) return reply(plan);
    if (url.endsWith("/pin")) return reply(null);
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
  // the notice comes first, and must be accepted
  const acceptButton = await screen.findByText("Accept and flash");
  expect(screen.getByRole("dialog")).toHaveTextContent("No support.");
  expect(acceptButton).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I have read this notice and accept it/));
  fireEvent.click(acceptButton);
  expect(await screen.findByLabelText("Flash progress")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/Flash: done/)).toBeInTheDocument(), { timeout: 3000 });
  const post = calls.find((c) => c.startsWith("POST") && c.includes("/jobs/") && c.includes("/flash"))!;
  expect(post).toContain('"confirm":"Desk"');
  expect(post).toContain('"notice":"v1"');
  expect(calls.some((c) => c.startsWith("POST /api/notices/flash") && c.includes('"remember":false'))).toBe(true);
});

test("a blocking check means no flash button", async () => {
  stub({ ...okPlan, can_flash: false, checks: [{ id: "enabled", level: "block", text: "Flashing is off in this app." }] }, []);
  render(<FlashPanel job={JOB} device="d" deviceName="Desk" notify={() => {}} />);
  fireEvent.click(screen.getByText("Plan the flash"));
  expect(await screen.findByText(/Flashing is off/)).toBeInTheDocument();
  expect(screen.queryByText("Flash Desk")).not.toBeInTheDocument();
  expect(screen.getByText("Cannot flash: 1 problem")).toHaveClass("bad");
  expect(screen.getByText(/Fix the problems above, then check again/)).toBeInTheDocument();
});

test("the plan leads with its verdict, then problems, things to look at with what to do, and passed checks folded", async () => {
  const calls = stub({ ...okPlan, name: "Desk", running: { ver: "16.0.1", release: "" },
    image: { ...okPlan.image, target: "board", release: "acme-16.0.1", usermods: ["my_fx"], new_effects: ["Sky", "Wave", "A", "B", "C", "D", "E"] },
    checks: [
      { id: "enabled", level: "ok", text: "Flashing is enabled here." },
      { id: "gate", level: "ok", text: "The build passed its four safety checks (the gate)." },
      { id: "library", level: "warn", text: "3 of your looks and playlists work differently with this firmware." },
      { id: "pin", level: "warn", text: "No settings PIN is stored for this device." },
    ] }, []);
  const onShowLooks = vi.fn();
  render(<FlashPanel job={JOB} device="d" deviceName="Desk" notify={() => {}} onShowLooks={onShowLooks} />);
  fireEvent.click(screen.getByText("Plan the flash"));
  expect(await screen.findByText("Ready to flash, with 2 things to look at")).toHaveClass("warn");
  expect(screen.getByLabelText("To look at")).toHaveTextContent("3 of your looks");
  expect(screen.getByText("2 checks passed").closest("details")).not.toHaveAttribute("open");
  // the before/after line: no empty brackets for a device without a release name (known bug 17)
  expect(screen.getByText(/^Now on Desk:/).closest("p")).toHaveTextContent(
    "Now on Desk: WLED 16.0.1. After: board · acme-16.0.1 with my_fx, which adds Sky, Wave, A, B, C and 2 more.");
  expect(screen.getByText(/What happens: the device's presets and settings are backed up first/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("See which looks"));
  expect(onShowLooks).toHaveBeenCalled();
  // the PIN: stored from here, then the plan is checked again
  fireEvent.click(screen.getByText("Store the PIN"));
  fireEvent.change(screen.getByLabelText("Desk's settings PIN"), { target: { value: "1234" } });
  fireEvent.click(screen.getByText("Save PIN"));
  await waitFor(() => expect(calls.some((c) => c.startsWith("PUT /api/devices/d/pin") && c.includes('"pin":"1234"'))).toBe(true));
  await waitFor(() => expect(calls.filter((c) => c.includes("/flash-plan")).length).toBe(2));
  expect(screen.getByText("Check again")).toBeInTheDocument();
});

test("with the notice accepted for good, flashing doesn't ask again", async () => {
  const calls = stub(okPlan, [{ id: "r", kind: "flash", device: "d", state: "done", steps: [] }], true);
  render(<FlashPanel job={JOB} device="d" deviceName="Desk" notify={() => {}} />);
  expect(await screen.findByText(/chose not to see it again/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Plan the flash"));
  await screen.findByText(/The gate passed/);
  fireEvent.change(screen.getByLabelText("Type the device's name to flash"), { target: { value: "Desk" } });
  fireEvent.click(screen.getByText("Flash Desk"));
  await waitFor(() => expect(calls.some((c) => c.includes("/jobs/") && c.includes('"notice":"v1"'))).toBe(true));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Show it before every flash again"));
  await waitFor(() => expect(calls.some((c) => c.startsWith("DELETE /api/notices/flash"))).toBe(true));
});

test("revert needs the name typed too, and the notice", async () => {
  const calls = stub(okPlan, [{ id: "v", kind: "revert", device: "d", state: "done", steps: [] }]);
  render(<FlashPanel job={JOB} device="d" deviceName="Desk" notify={() => {}} />);
  const button = screen.getByText("Revert Desk");
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Type the device's name to revert"), { target: { value: "Desk" } });
  fireEvent.click(button);
  fireEvent.click(await screen.findByLabelText(/I have read this notice and accept it/));
  fireEvent.click(screen.getByLabelText(/Don't show this again/));
  fireEvent.click(screen.getByText("Accept and revert"));
  await waitFor(() => expect(calls.some((c) => c.startsWith("POST /api/devices/d/revert") && c.includes('"notice":"v1"'))).toBe(true));
  expect(calls.some((c) => c.startsWith("POST /api/notices/flash") && c.includes('"remember":true'))).toBe(true);
});

test("a plan that finds a virtual device hides the way back", async () => {
  stub({ ...okPlan, running: { ver: "16.0.1", arch: "virtual" }, can_flash: false,
    checks: [{ id: "arch", level: "block", text: "This is a virtual device." }] }, []);
  render(<FlashPanel job={JOB} device="d" deviceName="Desk" notify={() => {}} />);
  expect(screen.getByText(/The way back/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Plan the flash"));
  expect(await screen.findByText(/This is a virtual device/)).toBeInTheDocument();
  expect(screen.queryByText(/The way back/)).toBeNull();
});
