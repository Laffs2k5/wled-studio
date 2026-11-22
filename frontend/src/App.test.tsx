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
    "POST /api/devices/desk/state": () => state,
  });
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Comet" })).toBeInTheDocument();
  expect(screen.getByLabelText("Tail")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Looks" })).getByText("Evening")).toBeInTheDocument();
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
