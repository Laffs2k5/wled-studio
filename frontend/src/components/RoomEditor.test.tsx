// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoomEditor } from "./RoomEditor";

afterEach(() => vi.unstubAllGlobals());

test("builds a room shape, shows the LED total, saves it", async () => {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ key: `${init?.method ?? "GET"} ${url}`, body: init?.body as string });
    if (!init?.method) return new Response("null", { status: 200 });
    return new Response(init.body as string, { status: 200 });
  }));
  const onSaved = vi.fn();
  render(<RoomEditor deviceId="desk" ledCount={20} onSaved={onSaved} notify={() => {}} />);
  fireEvent.click(screen.getByText(/Room shape/));
  fireEvent.click(screen.getByText("Add wall"));
  fireEvent.click(screen.getByText("Add wall"));
  fireEvent.change(screen.getByLabelText("Wall 1 LEDs"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("Wall 1 name"), { target: { value: "A" } });
  expect(screen.getByText("22 of 20 LEDs")).toHaveClass("warn");
  fireEvent.change(screen.getByLabelText("Wall 2 LEDs"), { target: { value: "8" } });
  expect(screen.getByText("20 of 20 LEDs")).not.toHaveClass("warn");
  fireEvent.click(screen.getByText("Save shape"));
  await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith({ edges: expect.any(Array) }));
  const put = calls.find((c) => c.key === "PUT /api/devices/desk/room")!;
  expect(JSON.parse(put.body!)).toEqual({ edges: [{ direction: "right", pixels: 12, label: "A" }, { direction: "down", pixels: 8 }] });
});

test("loads an existing shape; saved is only said after a save", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ edges: [{ direction: "left", pixels: 5 }] }), { status: 200 })));
  const onSaved = vi.fn();
  render(<RoomEditor deviceId="desk" ledCount={5} onSaved={onSaved} notify={() => {}} />);
  expect(await screen.findByText("Room shape (1 walls)")).toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
});

test("without a known LED count, only the total; opened on request", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("null", { status: 200 })));
  render(<RoomEditor deviceId="desk" onSaved={() => {}} notify={() => {}} defaultOpen />);
  expect(await screen.findByText("Room shape (not set)")).toBeInTheDocument();
  expect(screen.getByText("Add wall")).toBeVisible();
  fireEvent.click(screen.getByText("Add wall"));
  expect(screen.getByText("10 LEDs")).toBeInTheDocument();
});

test("zones are edited and saved with the shape", async () => {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ key: `${init?.method ?? "GET"} ${url}`, body: init?.body as string });
    if ((init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ edges: [{ direction: "right", pixels: 20, label: "A" }],
        zones: [{ label: "Door", start: 2, stop: 6 }] }), { status: 200 });
    }
    return new Response(init?.body as string, { status: 200 });
  }));
  render(<RoomEditor deviceId="desk" ledCount={20} onSaved={() => {}} notify={() => {}} />);
  fireEvent.click(screen.getByText(/Room shape/));
  expect(await screen.findByDisplayValue("Door")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Zone 1 stop"), { target: { value: "7" } });
  fireEvent.click(screen.getByText("Add zone"));
  fireEvent.change(screen.getByLabelText("Zone 2 name"), { target: { value: "Desk" } });
  fireEvent.click(screen.getByLabelText("Remove zone 2"));
  fireEvent.click(screen.getByText("Save shape"));
  await waitFor(() => expect(calls.some((c) => c.key === "PUT /api/devices/desk/room")).toBe(true));
  const put = calls.find((c) => c.key === "PUT /api/devices/desk/room")!;
  expect(JSON.parse(put.body!).zones).toEqual([{ label: "Door", start: 2, stop: 7 }]);
});
