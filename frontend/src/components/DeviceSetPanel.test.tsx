// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeviceSetPanel } from "./DeviceSetPanel";

afterEach(() => vi.unstubAllGlobals());

test("the Presets view owns choosing what goes on the device", async () => {
  const calls: { key: string; body: unknown }[] = [];
  let set = { all: false, looks: ["Calm"], playlists: [], brought: ["Storm brings Rain"],
    on_device: { looks: ["Calm", "Rain"], playlists: ["Storm"] } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ key, body });
    if (key === "GET /api/devices") return new Response(JSON.stringify([
      { id: "desk", name: "Desk" }, { id: "other", name: "Other" },
    ]), { status: 200 });
    if (key.startsWith("POST /api/devices/desk/set/add")) {
      set = { ...set, looks: [...set.looks, body.looks[0]] };
    }
    if (key.startsWith("POST /api/devices/desk/set/remove")) {
      set = { ...set, looks: set.looks.filter((name) => !body.looks.includes(name)) };
    }
    return new Response(JSON.stringify(set), { status: 200 });
  }));
  const changed = vi.fn();
  render(<DeviceSetPanel deviceId="desk" deviceName="Desk"
    looks={[{ name: "Calm", segments: [] }, { name: "Fire", segments: [] }, { name: "Rain", segments: [] }]}
    playlists={[{ name: "Storm", entries: [], repeat: 0, shuffle: false }]} notify={() => {}} onChanged={changed} />);
  expect(await screen.findByText("Desk has its own set: 1 look and 0 playlists.")).toBeInTheDocument();
  expect(screen.getByText("Storm brings Rain")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Put Fire on Desk"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(calls.find((call) => call.key === "POST /api/devices/desk/set/add")?.body)
    .toEqual({ looks: ["Fire"], playlists: [] });
  fireEvent.click(screen.getByLabelText("Put Calm on Desk"));
  await waitFor(() => expect(calls.some((call) => call.key === "POST /api/devices/desk/set/remove")).toBe(true));
});
