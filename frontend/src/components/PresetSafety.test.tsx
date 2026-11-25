// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PresetSafety } from "./PresetSafety";

afterEach(() => vi.unstubAllGlobals());

test("delete and restore require the device name and retain inline results", async () => {
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
