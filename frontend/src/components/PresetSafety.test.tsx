// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { compareBackup, PresetSafety } from "./PresetSafety";

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

test("delete and restore require the device name and retain inline results", async () => {
  sessionStorage.setItem("wledstudio.token", "secret");
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/presets-on-device")) return reply({
      name: "Desk", sha256: "a".repeat(64),
      presets: [{ id: 20, name: "From WLED", library: false, on_device_set: false }],
    });
    if (url.endsWith("/backups/backup-presets.json")) return reply({
      name: "backup-presets.json", bytes: 32, sha256: "b".repeat(64), presets: [{ id: 3, name: "Calm" }],
    });
    if (url.endsWith("/backups")) return reply(["backup-presets.json"]);
    if (url.endsWith("/presets/delete")) return reply({ deleted: [20], backup: "now-presets.json" });
    if (url.endsWith("/presets/restore")) return reply({ restored: "backup-presets.json", backup: "before-presets.json" });
    return reply({});
  }));
  const changed = vi.fn();
  render(<PresetSafety deviceId="desk" deviceName="Desk" notify={() => {}} version={0} onChanged={changed} />);
  expect(await screen.findByText("Preset 20: From WLED")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("Delete 1 preset from Desk"));
  const deletion = screen.getByRole("group", { name: "Confirm preset deletion" });
  expect(within(deletion).getByRole("button", { name: "Delete selected presets" })).toBeDisabled();
  fireEvent.change(within(deletion).getByLabelText(/Type the device name/), { target: { value: "Desk" } });
  fireEvent.click(within(deletion).getByRole("button", { name: "Delete selected presets" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(screen.getByRole("status")).toHaveTextContent("Safety backup: now-presets.json");

  fireEvent.click(screen.getByText("Backups (1)"));
  fireEvent.click(screen.getByText("backup-presets.json"));
  const restore = await screen.findByLabelText("Restore backup");
  expect(restore).toHaveTextContent("Preset 3: Calm");
  fireEvent.change(within(restore).getByLabelText(/Type the device name/), { target: { value: "Desk" } });
  fireEvent.click(within(restore).getByRole("button", { name: "Restore this backup" }));
  await waitFor(() => expect(calls.some((call) => call.startsWith("POST /api/devices/desk/presets/restore"))).toBe(true));
  expect(screen.getByText(/Restored backup-presets.json/)).toBeInTheDocument();
});

test("a protected preset needs a tick before it is deleted, and the tick is sent", async () => {
  sessionStorage.setItem("wledstudio.token", "secret");
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") bodies.push(String(init.body));
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/presets-on-device")) return reply({
      name: "Desk", sha256: "a".repeat(64),
      presets: [{ id: 41, name: "Bank look", library: false, on_device_set: false, protected_by: ["slot grid Remote"],
        boot: true, in_playlists: [7] }],
    });
    if (url.endsWith("/backups")) return reply([]);
    if (url.endsWith("/presets/delete")) return reply({ deleted: [41], backup: "now-presets.json" });
    return reply([]);
  }));
  render(<PresetSafety deviceId="desk" deviceName="Desk" notify={() => {}} version={0} onChanged={() => {}} />);
  expect(await screen.findByText(/shown at power-on/)).toBeInTheDocument();
  expect(screen.getByText(/played by playlist 7/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("Delete 1 preset from Desk"));
  const deletion = screen.getByRole("group", { name: "Confirm preset deletion" });
  fireEvent.change(within(deletion).getByLabelText(/Type the device name/), { target: { value: "Desk" } });
  const button = within(deletion).getByRole("button", { name: "Delete selected presets" });
  expect(button).toBeDisabled();
  fireEvent.click(within(deletion).getByLabelText(/Delete it anyway/));
  fireEvent.click(button);
  await waitFor(() => expect(bodies.length).toBe(1));
  expect(JSON.parse(bodies[0]).override_protected).toEqual([41]);
});

test("compareBackup says what a restore removes, brings back and changes", () => {
  const current = { name: "Desk", sha256: "x", presets: [
    { id: 1, name: "Calm", library: true, on_device_set: true, sha: "aa" },
    { id: 2, name: "New", library: false, on_device_set: false, sha: "bb", protected_by: ["Remote"] },
    { id: 3, name: "Fire", library: true, on_device_set: true, sha: "cc" },
  ] };
  const backup = { name: "b-presets.json", bytes: 1, sha256: "y", presets: [
    { id: 1, name: "Calm", sha: "aa" }, { id: 3, name: "Fire", sha: "dd" }, { id: 9, name: "Old", sha: "ee" },
  ] };
  const out = compareBackup(current, backup, [{ id: 9, label: "Automation" }]);
  expect(out.summary).toEqual(["Removes 1, added since: 2 New", "Brings back 1: 9 Old", "Changes 1: 3 Fire"]);
  expect(out.protectedIds).toEqual([2, 9]);
  expect(compareBackup(current, { ...backup, presets: current.presets }, []).summary).toEqual([]);
});
