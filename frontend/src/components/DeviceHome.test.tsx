// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen } from "@testing-library/react";
import { profile } from "../test/fixtures";
import { DeviceHome } from "./DeviceHome";

afterEach(() => vi.unstubAllGlobals());

test("shows current device facts and persisted firmware history", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/last-preset-write") ? { last_write: "2026-01-02T03:04:05+00:00" } : [
      { id: "a", job: "1234567890", kind: "flash", state: "done", when: 1700000000, ver: "16.0.1", effects: 200 },
    ],
  ), { status: 200 })));
  render(<DeviceHome deviceId="desk" profile={profile} lastPresetWrite="2026-01-02T03:04:05+00:00" />);
  expect(await screen.findByText(/WLED 16.0.1/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Firmware history (1)"));
  expect(screen.getByText("Flash").closest("li")).toHaveTextContent("done · WLED 16.0.1 · 200 effects");
});
