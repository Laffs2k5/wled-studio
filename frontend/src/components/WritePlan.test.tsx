// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PushResult } from "../types";
import { WritePlan } from "./WritePlan";

afterEach(() => vi.unstubAllGlobals());

function stubPush(reply: object, status = 200) {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reply), { status });
  }));
  return bodies;
}

const base: PushResult = { done: false, drift: false, changed_ids: [], backup: null, reason: "dry run", report: [], palettes: [] };
const plan = (p: Partial<PushResult>): PushResult => ({ ...base, ...p });

test("groups the plan by what will happen, with what the device holds now", () => {
  render(<WritePlan deviceId="desk" deviceName="Desk" notify={() => {}} onWritten={() => {}} plan={plan({
    changed_ids: ["3", "4"],
    report: [
      { look: "Evening", preset_id: 3, status: "ok", notes: [], written: true, changed: true, on_device: "Old evening" },
      { look: "Party", preset_id: 4, status: "remapped", notes: ["'Comet': id 8 -> 9"], written: true, changed: true, on_device: null },
      { look: "Calm", preset_id: 5, status: "ok", notes: [], written: true, changed: false, on_device: "Calm" },
      { look: "Glow", preset_id: 6, status: "unavailable", notes: ["effect 'Glow' isn't on this device"], written: false, changed: false, on_device: null },
      { playlist: "Mix", preset_id: 9, status: "ok", notes: ["unchanged"], written: false, changed: false, on_device: "Mix" },
    ] })} />);
  const written = within(screen.getByRole("region", { name: "Will be written" }));
  expect(written.getByRole("heading")).toHaveTextContent("Will be written (2)");
  expect(written.getByRole("row", { name: /Evening 3 Old evening/ })).toBeInTheDocument();
  expect(written.getByRole("row", { name: /Party 4 empty/ })).toBeInTheDocument();
  expect(screen.getByText("Already the same (2)")).toBeInTheDocument();
  expect(screen.getByText("Skipped: not on this device (1)")).toBeInTheDocument();
  expect(screen.getByText("Uses effect “Glow”, which Desk does not have.")).toBeInTheDocument();
  expect(screen.getByText("Writes 2 presets to Desk. Other presets on the device are kept. A backup of presets.json is taken first."))
    .toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Write 2 presets to Desk" })).toBeEnabled();
});

test("two looks on one preset id block the write", () => {
  render(<WritePlan deviceId="desk" deviceName="Desk" notify={() => {}} onWritten={() => {}} plan={plan({
    changed_ids: ["102"],
    duplicates: [{ preset_id: 102, looks: ["R1·2 Sparkle", "Extra"], playlists: [] }],
    report: [
      { look: "R1·2 Sparkle", preset_id: 102, status: "ok", notes: [], written: true, changed: true, on_device: null },
      { look: "Extra", preset_id: 102, status: "ok", notes: [], written: true, changed: true, on_device: null },
    ] })} />);
  expect(screen.getByRole("heading", { name: "Two looks want the same preset id (1)" })).toBeInTheDocument();
  expect(screen.getByText("Preset 102: “R1·2 Sparkle” and “Extra”")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Will be written" })).toBeNull();
  expect(screen.getByText(/Nothing is written to Desk while two items want the same preset id/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Write .* to Desk$/ })).toBeDisabled();
});

test("an effect that changed waits for a tick and is sent with the write", async () => {
  const bodies = stubPush({ ...base, done: true, backup: "b.json", reason: null });
  const onWritten = vi.fn();
  const notify = vi.fn();
  render(<WritePlan deviceId="desk" deviceName="Desk" notify={notify} onWritten={onWritten} plan={plan({
    changed_ids: ["3"],
    report: [
      { look: "Evening", preset_id: 3, status: "ok", notes: [], written: true, changed: true, on_device: null },
      { look: "Storm", preset_id: 4, status: "review", notes: ["'Comet' changed: Tail (ix) is gone"], written: false, changed: false, on_device: "Storm" },
    ] })} />);
  expect(screen.getByRole("heading", { name: "Needs your decision: effect changed (1)" })).toBeInTheDocument();
  const write = screen.getByRole("button", { name: "Write 1 preset to Desk" });
  expect(write).toBeEnabled();
  fireEvent.click(screen.getByLabelText("Write Storm anyway"));
  expect(screen.getByRole("button", { name: "Write 2 presets to Desk" })).toBe(write);
  fireEvent.click(write);
  await waitFor(() => expect(onWritten).toHaveBeenCalled());
  expect(bodies[0]).toEqual({ dry_run: false, accept_review: ["Storm"] });
  expect(onWritten.mock.calls[0][0]).toMatchObject({ done: true, backup: "b.json" });
  expect(notify).not.toHaveBeenCalled();   // the write bar shows the result where the write was
});

test("drift lists outside changes and can be acknowledged with nothing to write", async () => {
  const bodies = stubPush({ ...base, done: true, reason: "outside changes kept" });
  const onWritten = vi.fn();
  render(<WritePlan deviceId="desk" deviceName="Desk" notify={() => {}} onWritten={onWritten} plan={plan({
    drift: true,
    drift_items: [
      { preset_id: "4", action: "added", name: "New outside" },
      { preset_id: "7", action: "changed", name: "Renamed", previous_name: "Old" },
      { preset_id: "9", action: "removed", name: "Gone" },
    ],
  })} />);
  const outside = screen.getByRole("region", { name: "Outside changes" });
  expect(outside).toHaveTextContent("Preset 4: added “New outside”");
  expect(outside).toHaveTextContent("Preset 7: changed from “Old” to “Renamed”");
  expect(outside).toHaveTextContent("Preset 9: removed “Gone”");
  fireEvent.click(screen.getByRole("button", { name: "Keep them on the device and continue" }));
  await waitFor(() => expect(onWritten).toHaveBeenCalled());
  expect(bodies).toEqual([{ dry_run: false, adopt_drift_only: true }]);
});

test("nothing to write", () => {
  render(<WritePlan deviceId="desk" deviceName="Desk" notify={() => {}} onWritten={() => {}} plan={plan({
    report: [{ look: "Calm", preset_id: 5, status: "ok", notes: [], written: true, changed: false, on_device: "Calm" }] })} />);
  expect(screen.getByText("Nothing to write: Desk already has what the library puts on it.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Write 0 presets to Desk" })).toBeDisabled();
});

test("a refused write is reported", async () => {
  stubPush({ detail: "Not written: more than one look wants the same preset id" }, 409);
  const onFailed = vi.fn();
  render(<WritePlan deviceId="desk" deviceName="Desk" notify={() => {}} onWritten={() => {}} onFailed={onFailed} plan={plan({
    changed_ids: ["3"], palettes: [{ palette: "Ice", file: "palette0.json", id: 200 }],
    report: [{ look: "Evening", preset_id: 3, status: "ok", notes: [], written: true, changed: true, on_device: null }] })} />);
  expect(screen.getByText(/and uploads 1 palette\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Write 1 preset to Desk" }));
  await waitFor(() => expect(onFailed).toHaveBeenCalledWith("Not written: more than one look wants the same preset id"));
});
