// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { profile, state } from "./test/fixtures";

type Route = (url: string, init?: RequestInit) => unknown;

function backend(routes: Record<string, Route>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ detail: `no route ${key}` }), { status: 404 });
    const body = handler(url, init);
    return new Response(body === null ? "" : JSON.stringify(body), { status: 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

test("first run asks for a device", async () => {
  backend({ "GET /api/devices": () => [] });
  render(<App />);
  expect(await screen.findByText("Add a WLED device to start.")).toBeInTheDocument();
  expect(screen.getByLabelText("Device host")).toBeInTheDocument();
});

test("shows the device's effect with its own controls, and sends live changes", async () => {
  const calls = backend({
    "GET /api/devices": () => [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }],
    "GET /api/devices/desk/profile": () => profile,
    "GET /api/devices/desk/state": () => state,
    "GET /api/looks": () => [{ name: "Evening", preset_id: 3, segments: [] }],
    "GET /api/playlists": () => [],
    "GET /api/palettes": () => [],
    "GET /api/devices/desk/room": () => null,
    "POST /api/devices/desk/state": () => state,
    "POST /api/devices/desk/capture/Quick?preset_id=5": () => ({ name: "Quick", segments: [] }),
  });
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Comet" })).toBeInTheDocument();
  expect(screen.getByLabelText("Tail")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Looks" })).getByText("Evening")).toBeInTheDocument();
  // where each column's actions land: the strip now, or the app's library
  expect(screen.getByLabelText("Where changes go")).toHaveTextContent(
    "Live on Desk: every change here shows on the strip at once. Nothing is stored on the device until you write presets.");
  expect(screen.getByText(/Library: kept in the app, shared by all devices/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Tail"), { target: { value: "201" } });
  await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
  const post = calls.find((c) => c.init?.method === "POST")!;
  expect(JSON.parse(String(post.init!.body))).toEqual({ seg: [{ id: 0, ix: 201 }] });
});

test("errors are shown", async () => {
  backend({
    "GET /api/devices": () => [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }],
    "GET /api/looks": () => [],
  });
  render(<App />);
  expect(await screen.findByRole("status")).toHaveTextContent("no route");
});

test("asks for the token when the backend wants one, then sends it", async () => {
  sessionStorage.clear();
  let authorised = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    authorised = auth === "Bearer tok-123";
    if (!authorised) return new Response(JSON.stringify({ detail: "missing or wrong token" }), { status: 401 });
    if (url === "/api/devices") return new Response("[]", { status: 200 });
    return new Response("{}", { status: 200 });
  }));
  render(<App />);
  const input = await screen.findByLabelText("Access token");
  fireEvent.change(input, { target: { value: "tok-123" } });
  fireEvent.click(screen.getByText("Continue"));
  expect(await screen.findByText("Add a WLED device to start.")).toBeInTheDocument();
  expect(authorised).toBe(true);
  expect(sessionStorage.getItem("wledstudio.token")).toBe("tok-123");
});

test("a live change still held back is sent before a look is saved", async () => {
  const calls = backend({
    "GET /api/devices": () => [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }],
    "GET /api/devices/desk/profile": () => profile,
    "GET /api/devices/desk/state": () => state,
    "GET /api/looks": () => [],
    "GET /api/playlists": () => [],
    "GET /api/palettes": () => [],
    "GET /api/devices/desk/room": () => null,
    "POST /api/devices/desk/state": () => state,
    "POST /api/devices/desk/capture/Quick?preset_id=5": () => ({ name: "Quick", segments: [] }),
  });
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Tail"), { target: { value: "77" } });
  fireEvent.change(screen.getByLabelText("Look name"), { target: { value: "Quick" } });
  fireEvent.change(screen.getByLabelText("Preset id"), { target: { value: "5" } });
  fireEvent.click(screen.getByText("Save current"));   // at once, inside the 120 ms hold-back
  await waitFor(() => expect(calls.some((c) => c.url.includes("/capture/"))).toBe(true));
  const order = calls.filter((c) => c.init?.method === "POST").map((c) => c.url);
  expect(order[0]).toBe("/api/devices/desk/state");
  expect(order[1]).toBe("/api/devices/desk/capture/Quick?preset_id=5");
  expect(JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body))).toEqual({ seg: [{ id: 0, ix: 77 }] });
});

test("brightness shows its value; a sound effect with the mic off says it runs on a simulated beat", async () => {
  const sound = { ...state, seg: [{ ...state.seg[0], fx: 5, si: 1 }] };   // Pulse Meter: sound-reactive
  const calls = backend({
    "GET /api/devices": () => [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }],
    "GET /api/devices/desk/profile": () => profile,
    "GET /api/devices/desk/state": () => sound,
    "GET /api/looks": () => [],
    "GET /api/playlists": () => [],
    "GET /api/palettes": () => [],
    "GET /api/devices/desk/room": () => null,
    "POST /api/devices/desk/state": () => sound,
  });
  render(<App />);
  expect(await screen.findByRole("heading", { name: /Pulse Meter/ })).toBeInTheDocument();
  expect(screen.getByLabelText("Brightness").nextSibling).toHaveTextContent("128");
  const mic = screen.getByLabelText("Microphone on (sound effects react to real sound)");
  expect(mic).not.toBeChecked();
  expect(screen.getByText(/Mic is off: this effect runs on a simulated beat/)).toBeInTheDocument();
  const si = screen.getByLabelText("Sound simulation");
  expect(si).toHaveValue("1");
  fireEvent.change(si, { target: { value: "3" } });
  await waitFor(() => expect(calls.some((c) => String(c.init?.body).includes('"si":3'))).toBe(true));
  fireEvent.click(screen.getByText("Turn mic on"));
  expect(mic).toBeChecked();
  expect(screen.queryByLabelText("Sound simulation")).toBeNull();   // it reacts to real sound now
  await waitFor(() => expect(calls.some((c) => String(c.init?.body) === '{"AudioReactive":{"enabled":true}}')).toBe(true));
});

test("a sound effect on a device without sound input runs on the simulated beat", async () => {
  backend({
    "GET /api/devices": () => [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }],
    "GET /api/devices/desk/profile": () => ({ ...profile, usermods: [] }),
    "GET /api/devices/desk/state": () => ({ ...state, seg: [{ ...state.seg[0], fx: 5 }] }),
    "GET /api/looks": () => [],
    "GET /api/playlists": () => [],
    "GET /api/palettes": () => [],
    "GET /api/devices/desk/room": () => null,
  });
  render(<App />);
  expect(await screen.findByText(/This device has no sound input: this effect runs on a simulated beat/)).toBeInTheDocument();
  expect(screen.queryByText("Turn mic on")).toBeNull();
  expect(screen.queryByLabelText(/Microphone on/)).toBeNull();
});

test("a virtual device: marked in the live banner, and the device list is read again to mark it there", async () => {
  let listed = 0;
  backend({
    "GET /api/devices": () => [{ id: "twin", name: "Twin", host: "twin.lan", has_pin: false, virtual: ++listed > 1 }],
    "GET /api/devices/twin/profile": () => ({ ...profile, device: { id: "twin", name: "Twin" }, info: { ...profile.info, arch: "virtual" } }),
    "GET /api/devices/twin/state": () => state,
    "GET /api/looks": () => [],
    "GET /api/playlists": () => [],
    "GET /api/palettes": () => [],
    "GET /api/devices/twin/room": () => null,
  });
  render(<App />);
  const banner = await screen.findByLabelText("Where changes go");
  await waitFor(() => expect(banner).toHaveTextContent("Live on Twinvirtual (no LEDs): every change here shows in its live view at once."));
  expect(await screen.findByRole("option", { name: "Twin · virtual (no LEDs) (twin.lan)" })).toBeInTheDocument();
});
