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

test("loads an existing shape", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ edges: [{ direction: "left", pixels: 5 }] }), { status: 200 })));
  const onSaved = vi.fn();
  render(<RoomEditor deviceId="desk" ledCount={5} onSaved={onSaved} notify={() => {}} />);
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ edges: [{ direction: "left", pixels: 5 }] }));
  expect(screen.getByText("Room shape (1 walls)")).toBeInTheDocument();
});
