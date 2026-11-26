// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CrossDevice } from "./CrossDevice";

afterEach(() => vi.unstubAllGlobals());

test("compares another device and adds a look to its set explicitly", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url === "/api/devices") return reply([{ id: "desk", name: "Desk" }, { id: "shelf", name: "Shelf" }]);
    if (url === "/api/devices/shelf/check") return reply([{ look: "Calm", status: "unavailable", notes: ["missing"] }]);
    if (url === "/api/devices/shelf/set") return reply({ all: false, looks: [], playlists: [], brought: [],
      on_device: { looks: [], playlists: [] } });
    if (url === "/api/devices/shelf/set/add") return reply({ all: false, looks: ["Calm"], playlists: [], brought: [],
      on_device: { looks: ["Calm"], playlists: [] } });
    return reply({});
  }));
  const changed = vi.fn();
  render(<CrossDevice current="desk" looks={[{ name: "Calm", segments: [] }]} notify={() => {}} onChanged={changed} />);
  expect(await screen.findByText("not in device set")).toBeInTheDocument();
  expect(screen.getByText("not on this device")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Put in Shelf's set" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(calls).toContain("POST /api/devices/shelf/set/add");
});

test("suggests a nearest effect and replaces only after confirmation", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url === "/api/devices") return reply([{ id: "desk", name: "Desk" }, { id: "shelf", name: "Shelf" }]);
    if (url === "/api/devices/shelf/check") return reply([{ look: "Fire", status: "unavailable", notes: ["missing"] }]);
    if (url === "/api/devices/shelf/set") return reply({ all: true, looks: [], playlists: [], brought: [], on_device: { looks: ["Fire"], playlists: [] } });
    if (key === "GET /api/devices/shelf/looks/Fire/effect-replacements") return reply({
      replacements: [{ old: "Fire 2012", choices: [{ name: "Sparkle Rain", score: 0.4 }] }],
    });
    if (key === "POST /api/devices/shelf/looks/Fire/effect-replacements") return reply({ changed: 1 });
    return reply({});
  }));
  render(<CrossDevice current="desk" looks={[{ name: "Fire", segments: [] }]} notify={() => {}} onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Find nearest effects" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use Sparkle Rain" }));
  await waitFor(() => expect(calls).toContain("POST /api/devices/shelf/looks/Fire/effect-replacements"));
});
