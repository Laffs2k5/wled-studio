// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DeviceSettings } from "./DeviceSettings";

afterEach(() => vi.unstubAllGlobals());

const desk = { id: "desk", name: "Desk", host: "wled.lan", has_pin: true };

function stub(fail?: { method: string; status: number; detail: string }) {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ key: `${method} ${url}`, body: init?.body as string });
    if (fail && fail.method === method) return new Response(JSON.stringify({ detail: fail.detail }), { status: fail.status });
    if (url.endsWith("/profile")) return new Response(JSON.stringify({ leds: { count: 30 }, info: {} }), { status: 200 });
    if (url.endsWith("/room")) return new Response("null", { status: 200 });
    if (method === "PATCH") return new Response(JSON.stringify({ ...desk, ...JSON.parse(init!.body as string) }), { status: 200 });
    return new Response(null, { status: 204 });
  }));
  return calls;
}

function open(extra: Partial<Parameters<typeof DeviceSettings>[0]> = {}) {
  const props = { onClose: vi.fn(), onChanged: vi.fn(), onRemoved: vi.fn(), onRoomSaved: vi.fn(), notify: vi.fn(), ...extra };
  const view = render(<DeviceSettings device={desk} {...props} />);
  return { ...props, rerender: (d: typeof desk) => view.rerender(<DeviceSettings device={d} {...props} />) };
}

test("changes the name and the address; a pasted URL is taken as its host", async () => {
  const calls = stub();
  const p = open();
  const save = screen.getByRole("button", { name: "Save name and address" });
  expect(save).toBeDisabled();   // nothing changed yet
  fireEvent.change(screen.getByLabelText("Address (IP or host name)"), { target: { value: "http://wled-new.lan/" } });
  fireEvent.click(save);
  expect(await screen.findByText("Saved. The app now looks for Desk at wled-new.lan.")).toBeInTheDocument();
  expect(p.onChanged).toHaveBeenCalled();
  // the device list read again: the result stays until the next action
  p.rerender({ ...desk, host: "wled-new.lan" });
  expect(screen.getByText("Saved. The app now looks for Desk at wled-new.lan.")).toBeInTheDocument();
  expect(screen.getByLabelText("Address (IP or host name)")).toHaveValue("wled-new.lan");
  const patch = calls.find((c) => c.key === "PATCH /api/devices/desk")!;
  expect(JSON.parse(patch.body!)).toEqual({ host: "wled-new.lan" });
});

test("a refused address says why, where the form is", async () => {
  stub({ method: "PATCH", status: 422, detail: "a device host is a name or IP address with an optional :port, nothing else" });
  const p = open();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Desk 2" } });
  fireEvent.change(screen.getByLabelText("Address (IP or host name)"), { target: { value: "wled.lan/x" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name and address" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/name or IP address/);
  expect(p.onChanged).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Name")).toHaveValue("Desk 2");   // the form keeps what was typed
});

test("the PIN is saved and removed by separate buttons; it is write-only", async () => {
  const calls = stub();
  const p = open();
  expect(screen.getByText(/Needed to write presets, palettes and firmware/)).toBeInTheDocument();
  expect(screen.getByText(/A PIN is stored in the app/)).toBeInTheDocument();
  const input = screen.getByLabelText("New settings PIN");
  expect(input).toHaveAttribute("type", "password");
  expect(screen.getByRole("button", { name: "Save PIN" })).toBeDisabled();   // an empty field never removes it
  fireEvent.change(input, { target: { value: "4321" } });
  fireEvent.click(screen.getByRole("button", { name: "Save PIN" }));
  expect(await screen.findByText("PIN saved in the app.")).toBeInTheDocument();
  expect(JSON.parse(calls.find((c) => c.key === "PUT /api/devices/desk/pin")!.body!)).toEqual({ pin: "4321" });
  fireEvent.click(screen.getByRole("button", { name: "Remove PIN" }));
  expect(await screen.findByText(/PIN removed from the app/)).toBeInTheDocument();
  expect(JSON.parse(calls.filter((c) => c.key === "PUT /api/devices/desk/pin")[1].body!)).toEqual({ pin: null });
  expect(p.onChanged).toHaveBeenCalledTimes(2);
});

test("the editing hook is saved and removed; it is write-only", async () => {
  const calls = stub();
  const p = open();
  expect(screen.getByText(/No hook is set/)).toBeInTheDocument();
  const input = screen.getByLabelText("Hook URL");
  expect(input).toHaveAttribute("type", "password");
  expect(screen.getByRole("button", { name: "Save hook" })).toBeDisabled();
  fireEvent.change(input, { target: { value: " http://hub.lan/api/webhook/x " } });
  fireEvent.click(screen.getByRole("button", { name: "Save hook" }));
  expect(await screen.findByText("Editing hook saved.")).toBeInTheDocument();
  expect(JSON.parse(calls.find((c) => c.key === "PUT /api/devices/desk/editing-hook")!.body!))
    .toEqual({ url: "http://hub.lan/api/webhook/x" });
  p.rerender({ ...desk, has_editing_hook: true } as typeof desk);
  expect(screen.getByText(/A hook is set/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove hook" }));
  expect(await screen.findByText("Editing hook removed.")).toBeInTheDocument();
  expect(JSON.parse(calls.filter((c) => c.key === "PUT /api/devices/desk/editing-hook")[1].body!)).toEqual({ url: null });
});

test("removing asks first, and says what goes and what stays", async () => {
  const calls = stub();
  const p = open();
  fireEvent.click(screen.getByRole("button", { name: "Remove device…" }));
  const ask = screen.getByRole("alertdialog", { name: "Remove Desk?" });
  expect(ask).toHaveTextContent(/its address, the PIN stored here, its room shape, which looks go on it/);
  expect(ask).toHaveTextContent(/Nothing on the device changes: its presets, settings and firmware stay/);
  fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
  expect(calls.some((c) => c.key.startsWith("DELETE"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Remove device…" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Desk" }));
  await waitFor(() => expect(p.onRemoved).toHaveBeenCalled());
  expect(calls.some((c) => c.key === "DELETE /api/devices/desk")).toBe(true);
  expect(p.notify).toHaveBeenCalledWith("Removed Desk from the app. Nothing on the device changed.");
});

test("the room shape is here, opened when asked for, with the device's LED count", async () => {
  stub();
  open({ focus: "room" });
  expect(await screen.findByText("Room shape (not set)")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Add wall"));
  expect(await screen.findByText("10 of 30 LEDs")).toBeInTheDocument();
});

test("links a real controller to an explicitly chosen virtual twin", async () => {
  const calls = stub();
  open({ devices: [
    { ...desk, virtual: false },
    { id: "twin", name: "Offline twin", host: "twin:8080", has_pin: false, virtual: true },
  ] });
  fireEvent.change(screen.getByLabelText("Virtual twin"), { target: { value: "twin" } });
  fireEvent.click(screen.getByRole("button", { name: "Save twin" }));
  expect(await screen.findByText("Virtual twin linked.")).toBeInTheDocument();
  expect(JSON.parse(calls.find((c) => c.key === "PATCH /api/devices/desk")!.body!)).toEqual({ twin_id: "twin" });
});
