// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeviceBar } from "./DeviceBar";
import { ChangeDevice } from "./ChangeDevice";

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

test("the gear opens the current device's settings; there is no PIN button any more", () => {
  stub();
  const onSettings = vi.fn();
  render(<DeviceBar devices={devices} current="desk" onSelect={() => {}} onChanged={() => {}} notify={() => {}} onSettings={onSettings} />);
  expect(screen.queryByText("PIN")).toBeNull();
  const gear = screen.getByRole("button", { name: "Device settings" });
  expect(gear).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(gear);
  expect(onSettings).toHaveBeenCalled();
});

test("adds a device from the header; a pasted URL is taken as its host", async () => {
  const calls = stub();
  const onSelect = vi.fn();
  render(<DeviceBar devices={devices} current="desk" onSelect={onSelect} onChanged={() => {}} notify={() => {}} />);
  fireEvent.click(screen.getByText("Add device"));
  expect(screen.getByText("Adding only reads the device.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Device name"), { target: { value: "New" } });
  fireEvent.change(screen.getByLabelText("Address (IP or host name)"), { target: { value: "http://x.lan/" } });
  fireEvent.change(screen.getByLabelText("Settings PIN (optional)"), { target: { value: "1" } });
  fireEvent.click(screen.getByText("Add"));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("new"));
  expect(JSON.parse(calls[0].body!)).toEqual({ name: "New", host: "x.lan", pin: "1" });
});

test("no Add device in the header while the first-run card asks for one", () => {
  render(<DeviceBar devices={[]} current={null} onSelect={() => {}} onChanged={() => {}} notify={() => {}} hideAdd />);
  expect(screen.queryByText("Add device")).toBeNull();
});

test("a virtual device is marked in the picker", () => {
  render(<DeviceBar devices={[...devices, { id: "twin", name: "Twin", host: "twin.lan", has_pin: false, virtual: true }]}
    current="desk" onSelect={() => {}} onChanged={() => {}} notify={() => {}} />);
  expect(screen.getByRole("option", { name: "Twin · virtual (no LEDs) (twin.lan)" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Desk (wled.lan)" })).toBeInTheDocument();
});

test("Change device, beside a heading that names the device, takes you to the header's picker", () => {
  render(<>
    <DeviceBar devices={devices} current="desk" onSelect={() => {}} onChanged={() => {}} notify={() => {}} />
    <ChangeDevice />
  </>);
  fireEvent.click(screen.getByText("Change device"));
  expect(screen.getByLabelText("Device")).toHaveFocus();
});
