// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeviceBar } from "./DeviceBar";

afterEach(() => vi.unstubAllGlobals());

const devices = [{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }];

function stub() {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ key: `${init?.method} ${url}`, body: init?.body as string });
    if (url === "/api/devices" && init?.method === "POST") return new Response(JSON.stringify({ id: "new", name: "New", host: "x.lan", has_pin: true }), { status: 201 });
    return new Response(null, { status: 204 });
  }));
  return calls;
}

test("sets the PIN of the current device; the PIN is write-only", async () => {
  const calls = stub();
  const onChanged = vi.fn();
  render(<DeviceBar devices={devices} current="desk" onSelect={() => {}} onChanged={onChanged} notify={() => {}} />);
  fireEvent.click(screen.getByText("PIN"));
  const input = screen.getByLabelText("New settings PIN");
  expect(input).toHaveAttribute("type", "password");
  fireEvent.change(input, { target: { value: "4321" } });
  fireEvent.click(screen.getByText("Save PIN"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(calls[0].key).toBe("PUT /api/devices/desk/pin");
  expect(JSON.parse(calls[0].body!)).toEqual({ pin: "4321" });
});

test("adds a device", async () => {
  const calls = stub();
  const onSelect = vi.fn();
  render(<DeviceBar devices={devices} current="desk" onSelect={onSelect} onChanged={() => {}} notify={() => {}} />);
  fireEvent.click(screen.getByText("Add device"));
  fireEvent.change(screen.getByLabelText("Device name"), { target: { value: "New" } });
  fireEvent.change(screen.getByLabelText("Device host"), { target: { value: "x.lan" } });
  fireEvent.change(screen.getByLabelText("Settings PIN"), { target: { value: "1" } });
  fireEvent.click(screen.getByText("Add"));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("new"));
  expect(JSON.parse(calls[0].body!)).toEqual({ name: "New", host: "x.lan", pin: "1" });
});
