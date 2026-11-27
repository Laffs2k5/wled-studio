// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PresetsView } from "./PresetsView";

afterEach(() => vi.unstubAllGlobals());

test("one Presets view owns the device set, grid and a fresh write plan per data version", async () => {
  const pushes: object[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (key === "GET /api/looks") return reply([{ name: "Calm", preset_id: 3, segments: [] }]);
    if (key === "GET /api/playlists") return reply([]);
    if (key === "GET /api/devices/desk/set") return reply({
      all: false, looks: ["Calm"], playlists: [], brought: [],
      on_device: { looks: ["Calm"], playlists: [] },
    });
    if (key === "GET /api/slots/grids") return reply({ current: "grid-1", grids: [{
      id: "grid-1", name: "Remote A", grid: { rows: 1, cols: 1, first: 3, row_step: 1, col_step: 1,
        name: "R{row}·{col} {name}" }, cells: [],
    }] });
    if (key === "GET /api/devices") return reply([{ id: "desk", name: "Desk" }]);
    if (key === "GET /api/devices/desk/check") return reply([]);
    if (key === "GET /api/devices/desk/presets-on-device") return reply({ name: "Desk", sha256: "a".repeat(64), presets: [] });
    if (key === "GET /api/devices/desk/backups") return reply([]);
    if (key === "GET /api/devices/desk/cfg/backups") return reply([]);
    if (key === "GET /api/devices/desk/bank-trial") return reply({ active: false, current_sha256: null });
    if (key === "POST /api/devices/desk/push") {
      const body = JSON.parse(String(init?.body));
      pushes.push(body);
      return reply({ done: false, drift: false, changed_ids: ["3"], backup: null, reason: "dry run", report: [
        { look: "Calm", preset_id: 3, status: "ok", notes: [], written: true, changed: true, on_device: null },
      ] });
    }
    return new Response(JSON.stringify({ detail: `no route ${key}` }), { status: 404 });
  }));
  const { rerender } = render(<PresetsView deviceId="desk" deviceName="Desk" notify={() => {}}
    libraryVersion={0} onLibraryChanged={() => {}} onOpenLook={() => {}} />);
  expect(await screen.findByRole("region", { name: "What goes on this device" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Review and write" }, { timeout: 2000 })).toBeInTheDocument();
  expect(screen.getAllByLabelText("Write to device")).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Remote grid" }));
  expect(await screen.findByLabelText("Slot grid")).toBeInTheDocument();
  expect(screen.getAllByLabelText("Write to device")).toHaveLength(1);

  rerender(<PresetsView deviceId="desk" deviceName="Desk" notify={() => {}}
    libraryVersion={1} onLibraryChanged={() => {}} onOpenLook={() => {}} />);
  expect(screen.queryByRole("button", { name: "Review and write" })).toBeNull();
  expect(screen.getByText("Checking Desk against the library…")).toBeInTheDocument();
  await waitFor(() => expect(pushes).toHaveLength(2), { timeout: 2000 });
  expect(pushes).toEqual([{ dry_run: true }, { dry_run: true }]);
});
