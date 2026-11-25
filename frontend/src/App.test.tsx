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

afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, "", location.pathname); });

test("view navigation and the selected device are in the URL", async () => {
  backend({ "GET /api/devices": () => [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }] });
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Device")).toHaveValue("desk"));
  fireEvent.click(screen.getByRole("button", { name: "Effect studio" }));
  expect(location.hash).toBe("#/studio?device=desk");
  fireEvent.click(screen.getByRole("button", { name: "Slot grid" }));
  expect(location.hash).toBe("#/slots?device=desk");
});

test("first run asks for a device in a card of its own", async () => {
  backend({ "GET /api/devices": () => [] });
  render(<App />);
  const card = await screen.findByRole("form", { name: "Add your WLED controller" });
  expect(within(card).getByLabelText("Address (IP or host name)")).toHaveAccessibleDescription(/192\.168\.1\.50 or wled\.local/);
  expect(within(card).getByLabelText("Settings PIN (optional)")).toHaveAccessibleDescription(/Only if you set one in WLED under Security/);
  expect(within(card).getByText(/Adding only reads the device/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add device" })).toBeNull();   // the card asks; the header doesn't
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
  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("no route");
  // an error stays until dismissed (the same error again replaces it, rather than piling up)
  await new Promise((r) => setTimeout(r, 100));
  const toasts = screen.getAllByRole("alert");
  expect(toasts).toHaveLength(1);
  fireEvent.click(within(toasts[0]).getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a confirmation toast goes by itself after a few seconds", async () => {
  let added = false;
  backend({
    "GET /api/devices": () => (added ? [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }] : []),
    "POST /api/devices": () => { added = true; return { id: "desk", name: "Desk", host: "wled.lan", has_pin: false }; },
    "GET /api/devices/desk/profile": () => profile,
  });
  render(<App />);
  const card = await screen.findByRole("form", { name: "Add your WLED controller" });
  fireEvent.change(within(card).getByLabelText("Device name"), { target: { value: "Desk" } });
  fireEvent.change(within(card).getByLabelText("Address (IP or host name)"), { target: { value: "wled.lan" } });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    fireEvent.click(within(card).getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/Added Desk\. Found: WLED 16\.0\.1, 60 LEDs\./)).toHaveAttribute("role", "status");
    await vi.advanceTimersByTimeAsync(4000);
    expect(screen.queryByText(/Added Desk\./)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
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
  expect(await screen.findByRole("form", { name: "Add your WLED controller" })).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "Save as look…" }));
  fireEvent.change(screen.getByLabelText("Look name"), { target: { value: "Quick" } });
  fireEvent.change(screen.getByLabelText(/^Preset id/), { target: { value: "5" } });
  fireEvent.click(screen.getByText("Save in the library"));   // at once, inside the 120 ms hold-back
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

test("one device picker in the header for every view, remembered across reloads", async () => {
  localStorage.clear();
  const routes = (id: string, name: string) => ({
    [`GET /api/devices/${id}/profile`]: () => ({ ...profile, device: { id, name } }),
    [`GET /api/devices/${id}/state`]: () => state,
    [`GET /api/devices/${id}/room`]: () => null,
  });
  backend({
    "GET /api/devices": () => [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false },
      { id: "twin", name: "Twin", host: "twin.lan", has_pin: false, virtual: true }],
    ...routes("desk", "Desk"), ...routes("twin", "Twin"),
    "GET /api/looks": () => [], "GET /api/playlists": () => [], "GET /api/palettes": () => [],
    "GET /api/slots": () => ({ grid: null, cells: [] }),
    "GET /api/firmware/status": () => ({ enabled: false }),
  });
  const { unmount } = render(<App />);
  const select = await screen.findByLabelText("Device");
  expect(select).toHaveValue("desk");
  fireEvent.change(select, { target: { value: "twin" } });
  expect(localStorage.getItem("wledstudio.device")).toBe("twin");
  expect(await screen.findByText(/Live on Twin/)).toBeInTheDocument();
  for (const view of ["Slot grid", "Firmware", "Looks & effects"]) {
    fireEvent.click(screen.getByRole("button", { name: view }));
    expect(screen.getByLabelText("Device")).toHaveValue("twin");
  }
  unmount();
  render(<App />);   // a reload: the same device again
  await waitFor(() => expect(screen.getByLabelText("Device")).toHaveValue("twin"));
  localStorage.clear();
});

test("the look editor: a frame of its own, the effect list picks for it, and after saving the device is said to be out of date", async () => {
  const look = { name: "Evening", preset_id: 3, status: "ok", notes: [], owns_layout: true, ids: true, bounds: true,
    state: { on: true, bri: 90, seg: [{ id: 0, start: 0, stop: 60, fx: 8 }] } };
  const calls = backend({
    "GET /api/devices": () => [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }],
    "GET /api/devices/desk/profile": () => profile,
    "GET /api/devices/desk/state": () => state,
    "GET /api/looks": () => [{ name: "Evening", preset_id: 3, segments: [] }],
    "GET /api/playlists": () => [],
    "GET /api/palettes": () => [],
    "GET /api/devices/desk/room": () => null,
    "GET /api/devices/desk/check": () => [],
    "GET /api/devices/desk/looks/Evening/edit": () => look,
    "POST /api/devices/desk/looks/Evening": () => ({ name: "Evening", segments: [] }),
  });
  render(<App />);
  fireEvent.click(await screen.findByLabelText("Edit Evening"));
  expect(await screen.findByText("Editing the saved look “Evening”. The strip does not change.")).toBeInTheDocument();
  expect(screen.getByText(/Picks the effect of the segment you're editing in “Evening”/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("listbox", { name: "Effects" })).getByRole("option", { name: /Pulse Meter/ }));
  expect(screen.getByLabelText("Effect")).toHaveValue("5");
  expect(calls.some((c) => c.url === "/api/devices/desk/state" && c.init?.method === "POST")).toBe(false);   // not live
  fireEvent.click(screen.getByRole("button", { name: "Save “Evening”" }));
  expect(await screen.findByRole("note", { name: "Saved look" })).toHaveTextContent(
    "Saved “Evening” in the library. Preset 3 on Desk is now out of date until you write presets.");
  expect(screen.getByRole("button", { name: "Check and write" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("note", { name: "Saved look" })).toBeNull();
});

test("a device that doesn't answer: the address, what to check, Try again, and the library still usable", async () => {
  let up = false;
  const down = () => new Response(JSON.stringify({ detail: "http://wled.lan/json/info: ConnectError" }), { status: 502 });
  const routes: Record<string, () => unknown> = {
    "GET /api/devices": () => [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }],
    "GET /api/devices/desk/profile": () => profile,
    "GET /api/devices/desk/state": () => state,
    "GET /api/looks": () => [{ name: "Evening", preset_id: 3, segments: [] }],
    "GET /api/playlists": () => [],
    "GET /api/palettes": () => [],
    "GET /api/devices/desk/room": () => null,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    if (!up && (url.endsWith("/profile") || url.endsWith("/state") || url.endsWith("/check"))) return down();
    const route = routes[key];
    return route ? new Response(JSON.stringify(route()), { status: 200 })
      : new Response(JSON.stringify({ detail: `no route ${key}` }), { status: 404 });
  }));
  render(<App />);
  const card = await screen.findByRole("region", { name: "Device not answering" });
  expect(card).toHaveTextContent("Desk does not answer at wled.lan.");
  expect(card).toHaveTextContent("Check that it is powered and on the network");
  expect(screen.queryByText(/ConnectError/)).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();                       // no raw toast
  expect(screen.queryByRole("alert")).toBeNull();
  const looks = screen.getByRole("region", { name: "Looks" });
  expect(within(looks).getByText("Evening")).toBeInTheDocument();
  expect(within(looks).getByText(/Not checked against Desk: it does not answer/)).toBeInTheDocument();
  expect(within(looks).getByRole("button", { name: "Show on strip" })).toBeDisabled();
  expect(within(looks).getByRole("button", { name: "Import from device" })).toBeDisabled();
  up = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Comet" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Device not answering" })).toBeNull();
});

test("device settings: a wrong address is changed from the offline card; the panel then reads the new address", async () => {
  let host = "wled.lan";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url === "/api/devices") return ok([{ id: "desk", name: "Desk", host, has_pin: false }]);
    if (method === "PATCH" && url === "/api/devices/desk") {
      host = JSON.parse(String(init!.body)).host;
      return ok({ id: "desk", name: "Desk", host, has_pin: false });
    }
    if (url.endsWith("/profile") || url.endsWith("/state") || url.endsWith("/check")) {
      if (host === "wled.lan") return new Response(JSON.stringify({ detail: "http://wled.lan/json/info: ConnectError" }), { status: 502 });
      return ok(url.endsWith("/profile") ? profile : url.endsWith("/state") ? state : []);
    }
    if (url.endsWith("/room")) return ok(null);
    return ok([]);
  }));
  render(<App />);
  const card = await screen.findByRole("region", { name: "Device not answering" });
  fireEvent.click(within(card).getByRole("button", { name: "Change the address…" }));
  const settings = screen.getByRole("region", { name: "Device settings" });
  const address = within(settings).getByLabelText("Address (IP or host name)");
  await waitFor(() => expect(address).toHaveFocus());
  fireEvent.change(address, { target: { value: "wled-desk.lan" } });
  fireEvent.click(within(settings).getByRole("button", { name: "Save name and address" }));
  expect(await screen.findByRole("heading", { name: "Comet" })).toBeInTheDocument();
  // no room shape yet: a link to it from the live column opens the settings there
  fireEvent.click(within(settings).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("region", { name: "Device settings" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Set the room shape…" }));
  expect(await within(screen.getByRole("region", { name: "Device settings" })).findByText("Room shape (not set)")).toBeVisible();
});
