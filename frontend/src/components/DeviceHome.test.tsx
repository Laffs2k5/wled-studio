// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen } from "@testing-library/react";
import { profile } from "../test/fixtures";
import { DeviceHome } from "./DeviceHome";

afterEach(() => vi.unstubAllGlobals());

test("shows current device facts and persisted firmware history", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const value = url.endsWith("/last-preset-write") ? { last_write: "2026-01-02T03:04:05+00:00" }
      : url.endsWith("/firmware-history") ? [
        { id: "a", job: "1234567890", kind: "flash", state: "done", when: 1700000000, ver: "16.0.1", effects: 200 },
      ] : url.endsWith("/set") ? { all: false, looks: ["Calm"], playlists: [], on_device: { looks: ["Calm"], playlists: [] } }
        : url.endsWith("/session") ? { active: false, started: null }
          : url.endsWith("/bank-trial") ? { active: false, current_sha256: null } : null;
    return new Response(JSON.stringify(value), { status: 200 });
  }));
  const onSelectDevice = vi.fn();
  render(<DeviceHome deviceId="desk" profile={profile}
    state={{ on: true, bri: 128, seg: [{ id: 0, start: 0, stop: 60, fx: 0 }] } as never}
    device={{ id: "desk", name: "Desk", host: "desk.lan", has_pin: true, twin_id: "twin" }}
    devices={[
      { id: "desk", name: "Desk", host: "desk.lan", has_pin: true, twin_id: "twin" },
      { id: "twin", name: "Offline twin", host: "twin:8080", has_pin: false, virtual: true },
    ]} onSelectDevice={onSelectDevice} lastPresetWrite="2026-01-02T03:04:05+00:00" />);
  expect(await screen.findByText(/WLED 16.0.1/)).toBeInTheDocument();
  expect(screen.getByLabelText("Whole-device status")).toHaveTextContent("1segments live");
  fireEvent.click(screen.getByRole("button", { name: "Open offline twin" }));
  expect(onSelectDevice).toHaveBeenCalledWith("twin");
  fireEvent.click(screen.getByText("Firmware history (1)"));
  expect(screen.getByText("Flash").closest("li")).toHaveTextContent("done · WLED 16.0.1 · 200 effects");
});
