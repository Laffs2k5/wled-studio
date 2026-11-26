// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { saveLiveSnapshot, stateHash } from "../liveSnapshots";
import { LiveSnapshots } from "./LiveSnapshots";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

test("restores an automatic live snapshot only after rechecking the current state", async () => {
  const previous = { on: true, bri: 20, seg: [] };
  const current = { on: true, bri: 99, seg: [] };
  saveLiveSnapshot("desk", previous, "before master control");
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const body = url.endsWith("/state") && !init?.method ? current : previous;
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  render(<LiveSnapshots deviceId="desk" notify={() => {}} onRestored={() => {}} />);
  fireEvent.click(screen.getByText("Restore…"));
  fireEvent.click(screen.getByRole("button", { name: "Restore and verify" }));
  await waitFor(() => expect(calls).toContain("POST /api/devices/desk/snapshots/restore"));
  expect(calls[0]).toBe("GET /api/devices/desk/state");
});

test("hashes Unicode exactly like Python's WLED state check", async () => {
  const state = { on: true, bri: 128, seg: [{ id: 0, n: "Café 🎮" }] } as never;
  expect(await stateHash(state)).toBe("5f879befd3910c350e4f3bf9a0920cead895502c26ded41de528d1706b03df79");
});
