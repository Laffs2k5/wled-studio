// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  expect(screen.getByLabelText("Room shape preview")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Save room shape (kept in the app)"));
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
  fireEvent.change(screen.getByLabelText("Zone 1 last LED"), { target: { value: "6" } });
  fireEvent.click(screen.getByText("Add zone"));
  fireEvent.change(screen.getByLabelText("Zone 2 name"), { target: { value: "Desk" } });
  fireEvent.click(screen.getByLabelText("Remove zone 2"));
  fireEvent.click(screen.getByText("Save room shape (kept in the app)"));
  await waitFor(() => expect(calls.some((c) => c.key === "PUT /api/devices/desk/room")).toBe(true));
  const put = calls.find((c) => c.key === "PUT /api/devices/desk/room")!;
  expect(JSON.parse(put.body!).zones).toEqual([{ label: "Door", start: 2, stop: 7 }]);
});

test("unsaved room edits ask before discard", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    edges: [{ direction: "right", pixels: 5 }],
  }), { status: 200 })));
  render(<RoomEditor deviceId="desk" defaultOpen onSaved={() => {}} notify={() => {}} />);
  await screen.findByDisplayValue("5");
  fireEvent.change(screen.getByLabelText("Wall 1 LEDs"), { target: { value: "8" } });
  expect(screen.getByText("Unsaved room shape changes")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Discard changes"));
  expect(screen.getByLabelText("Discard room shape changes?")).toBeInTheDocument();
  fireEvent.click(within(screen.getByLabelText("Discard room shape changes?")).getByRole("button", { name: "Discard changes" }));
  expect(screen.getByLabelText("Wall 1 LEDs")).toHaveValue("5");
});

test("removing a room model offers Undo and refreshes the shape", async () => {
  const calls: string[] = [];
  const room = { edges: [{ direction: "right", pixels: 5 }] };
  let saved = room as object | null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (key === "GET /api/devices/desk/room") return reply(saved);
    if (key === "DELETE /api/devices/desk/room") { saved = null; return reply(null); }
    if (key === "GET /api/deleted") return reply(saved ? [] : [{
      id: "a".repeat(32), kind: "room", label: "Desk room model", when: "2026-11-27T10:00:00Z",
      device_id: "desk",
    }]);
    if (key.startsWith("POST /api/deleted/")) { saved = room; return reply({ kind: "room", label: "Desk room model" }); }
    return reply(null);
  }));
  const onSaved = vi.fn();
  render(<RoomEditor deviceId="desk" defaultOpen onSaved={onSaved} notify={() => {}} />);
  await screen.findByDisplayValue("5");
  fireEvent.click(screen.getByText("Remove room model…"));
  fireEvent.click(screen.getByText("Yes, remove the room model"));
  expect(await screen.findByText("Room model removed from the app.")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(screen.getByDisplayValue("5")).toBeInTheDocument());
  expect(calls.some((key) => key.startsWith("POST /api/deleted/"))).toBe(true);
  expect(onSaved).toHaveBeenCalledWith(null);
});

test("recently deleted rooms and grids can be restored", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    if (key === "GET /api/deleted") return new Response(JSON.stringify([
      { id: "a".repeat(32), kind: "room", label: "Desk room model", when: "2026-11-27T10:00:00Z", device_id: "desk" },
      { id: "b".repeat(32), kind: "grid", label: "Remote A", when: "2026-11-26T10:00:00Z", grid_id: "grid-1" },
    ]));
    if (key === "POST /api/deleted/" + "b".repeat(32) + "/restore") {
      return new Response(JSON.stringify({ kind: "grid", label: "Remote A", id: "grid-2" }));
    }
    return new Response("null");
  }));
  render(<RoomEditor deviceId="desk" notify={() => {}} onSaved={() => {}} />);
  fireEvent.click(await screen.findByText("Recently deleted (2)"));
  expect(screen.getByText(/Room model — Desk room model/)).toBeInTheDocument();
  expect(screen.getByText(/Slot grid — Remote A/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByText(/Slot grid — Remote A/).closest("li")!).getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(calls).toContain(`POST /api/deleted/${"b".repeat(32)}/restore`));
});

test("a room restored over a current one needs explicit replace", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    if (key === "GET /api/deleted") return new Response(JSON.stringify([
      { id: "a".repeat(32), kind: "room", label: "Desk room model", when: "2026-11-27T10:00:00Z", device_id: "desk" },
    ]));
    if (key === "GET /api/devices/desk/room") return new Response("null");
    if (key.startsWith("POST /api/deleted/") && init?.body === '{"replace":false}') {
      return new Response(JSON.stringify({ detail: "This device has a room model now. Restore with replace to overwrite it." }),
        { status: 409 });
    }
    if (key.startsWith("POST /api/deleted/") && init?.body === '{"replace":true}') {
      return new Response(JSON.stringify({ kind: "room", label: "Desk room model" }));
    }
    return new Response("null");
  }));
  render(<RoomEditor deviceId="desk" notify={() => {}} onSaved={() => {}} />);
  fireEvent.click(await screen.findByText("Recently deleted (1)"));
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  const confirm = await screen.findByRole("group", { name: "Replace the current room model with Desk room model?" });
  fireEvent.click(within(confirm).getByRole("button", { name: "Replace and restore" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Replace and restore" })).not.toBeInTheDocument());
});
