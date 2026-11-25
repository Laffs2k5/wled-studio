// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PushResult } from "../types";
import { when, WriteBar, writeResult } from "./WriteBar";

afterEach(() => vi.unstubAllGlobals());

const base: PushResult = { done: false, drift: false, changed_ids: [], backup: null, reason: "dry run", report: [], palettes: [] };
const differ: PushResult = { ...base, changed_ids: ["3", "4"], report: [
  { look: "Evening", preset_id: 3, status: "ok", notes: [], written: true, changed: true, on_device: null },
  { look: "Party", preset_id: 4, status: "ok", notes: [], written: true, changed: true, on_device: "Old" },
] };

/** The device's answers to dry runs, in turn (the last one repeats); writes answer `written`. */
function stub(dry: (PushResult | Error)[], written?: PushResult) {
  const bodies: { dry_run: boolean }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const answer = body.dry_run ? dry[Math.min(bodies.filter((b) => b.dry_run).length - 1, dry.length - 1)] : written;
    if (answer instanceof Error) return new Response(JSON.stringify({ detail: answer.message }), { status: 502 });
    return new Response(JSON.stringify(answer), { status: 200 });
  }));
  return bodies;
}
const LATER = { timeout: 2000 };

test("checks when the view opens (a dry run), says how many presets differ, and opens the plan", async () => {
  const bodies = stub([differ, { ...base, last_write: new Date().toISOString() }],
    { ...base, done: true, changed_ids: ["3", "4"], backup: "/data/backups/desk/20261124T223000Z-presets.json" });
  render(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  expect(screen.getByText("Checking Desk against the library…")).toBeInTheDocument();
  expect(await screen.findByText("Desk: 2 presets differ from the library", undefined, LATER)).toBeInTheDocument();
  expect(bodies).toEqual([{ dry_run: true }]);                        // nothing written by checking
  fireEvent.click(screen.getByRole("button", { name: "Review and write" }));
  fireEvent.click(screen.getByRole("button", { name: "Write 2 presets to Desk" }));
  // after the write: checked again, and up to date, with the time of the write
  expect(await screen.findByText(/^Desk is up to date \(written \d\d?:\d\d( [AP]M)?\)$/, undefined, LATER)).toBeInTheDocument();
  expect(bodies.map((b) => b.dry_run)).toEqual([true, false, true]);
  expect(screen.queryByLabelText("Write plan")).toBeNull();
  // the write's result stays in the bar, with its backup, until dismissed
  expect(screen.getByLabelText("Last write")).toHaveTextContent(
    /^Written to Desk and verified at \d\d?:\d\d( [AP]M)?: 2 presets\. Backup of the previous presets: 20261124T223000Z-presets\.json\.OK$/);
  await new Promise((r) => setTimeout(r, 800));
  expect(screen.getByLabelText("Last write")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByLabelText("Last write")).toBeNull();
});

test("a write that fails, or that the device refuses, says so in the bar", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.dry_run) return new Response(JSON.stringify(differ), { status: 200 });
    return new Response(JSON.stringify({ detail: "http://wled.lan: ConnectError" }), { status: 502 });
  }));
  render(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review and write" }, LATER));
  fireEvent.click(screen.getByRole("button", { name: "Write 2 presets to Desk" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Writing to Desk failed: The device at wled.lan does not answer.");
  expect(writeResult({ ...base, done: false, reason: "drift" }, "Desk")).toEqual({ ok: false, text: "Not written to Desk: drift." });
  expect(writeResult({ ...base, done: true, palettes: [{ palette: "Ice", file: "p", id: 200 }] }, "Desk").text)
    .toMatch(/verified at .*: 1 palette\.$/);
});

test("library changes are checked once, shortly after the last one", async () => {
  const bodies = stub([base]);
  const { rerender } = render(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  expect(await screen.findByText("Desk is up to date", undefined, LATER)).toBeInTheDocument();
  rerender(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={1} />);
  rerender(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={2} />);
  rerender(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={3} />);
  await waitFor(() => expect(bodies.length).toBe(2), LATER);
  await new Promise((r) => setTimeout(r, 700));
  expect(bodies.length).toBe(2);
});

test("two looks on one preset id: the bar says nothing can be written", async () => {
  stub([{ ...differ, duplicates: [{ preset_id: 102, looks: ["A", "B"], playlists: [] }] }]);
  render(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  expect(await screen.findByText("Desk: two looks want preset 102; nothing can be written until each has its own", undefined, LATER))
    .toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(screen.getByText("Preset 102: “A” and “B”")).toBeInTheDocument();
});

test("a device that doesn't answer: said so, with Check again", async () => {
  const bodies = stub([new Error("http://wled.lan: ConnectError"), { ...base, palettes: [{ palette: "Ice", file: "palette0.json", id: 200 }] }]);
  render(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  expect(await screen.findByText("Desk does not answer, so it can't be compared with the library. Check that it is powered and on the network.", undefined, LATER)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByText("Desk: presets match, 1 palette to upload")).toBeInTheDocument();
  expect(bodies.length).toBe(2);
});

test("looks waiting for a decision, and drift, are mentioned", async () => {
  stub([{ ...base, drift: true, report: [{ look: "Storm", preset_id: 4, status: "review", notes: [], written: false, changed: false }] }]);
  render(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  expect(await screen.findByText(
    "Desk is up to date, except 1 look whose effect changed. Its presets were changed outside this app since the last write.",
    undefined, LATER)).toBeInTheDocument();
});

test("a time from another day carries its date", () => {
  expect(when("2020-01-02T03:04:05+00:00")).toMatch(/2020|20/);
  expect(when("not a time")).toBe("not a time");
});

test("the plan opens on request from elsewhere (the look editor's Check and write)", async () => {
  stub([differ]);
  const { rerender } = render(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  await screen.findByText("Desk: 2 presets differ from the library", undefined, LATER);
  expect(screen.queryByRole("button", { name: "Write 2 presets to Desk" })).toBeNull();
  rerender(<WriteBar deviceId="desk" deviceName="Desk" notify={() => {}} version={0} openRequest={1} />);
  expect(await screen.findByRole("button", { name: "Write 2 presets to Desk" })).toBeInTheDocument();
});
