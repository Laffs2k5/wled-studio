// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { profile } from "../test/fixtures";
import { AddDevice, normaliseHost } from "./AddDevice";

afterEach(() => vi.unstubAllGlobals());

test("an address as people paste it becomes a host", () => {
  expect(normaliseHost(" http://192.0.2.5/ ")).toBe("192.0.2.5");
  expect(normaliseHost("HTTPS://wled.local:8080//")).toBe("wled.local:8080");
  expect(normaliseHost("wled.local")).toBe("wled.local");
  expect(normaliseHost("http://wled.local/settings")).toBe("wled.local/settings");   // left for the backend to refuse
});

function stub(answers: boolean) {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ key: `${init?.method ?? "GET"} ${url}`, body: init?.body as string });
    if (url === "/api/devices") return new Response(JSON.stringify({ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }), { status: 201 });
    if (url === "/api/devices/desk/profile") return answers ? new Response(JSON.stringify(profile))
      : new Response(JSON.stringify({ detail: "http://wled.lan/json/info: ConnectError" }), { status: 502 });
    return new Response(JSON.stringify({ detail: "no" }), { status: 404 });
  }));
  return calls;
}

function fill() {
  fireEvent.change(screen.getByLabelText("Device name"), { target: { value: "Desk" } });
  fireEvent.change(screen.getByLabelText("Address (IP or host name)"), { target: { value: "https://wled.lan/" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

test("the first-run card adds the device, then reads it and says what it found", async () => {
  const calls = stub(true);
  const notify = vi.fn();
  const onAdded = vi.fn();
  render(<AddDevice variant="card" notify={notify} onAdded={onAdded} />);
  fill();
  await waitFor(() => expect(notify).toHaveBeenCalledWith("Added Desk. Found: WLED 16.0.1, 60 LEDs.", false));
  expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: "desk" }));
  expect(JSON.parse(calls[0].body!)).toEqual({ name: "Desk", host: "wled.lan" });
  expect(calls.map((c) => c.key)).toEqual(["POST /api/devices", "GET /api/devices/desk/profile"]);   // reads only
});

test("a device that doesn't answer after adding: said so, in plain words", async () => {
  stub(false);
  const notify = vi.fn();
  render(<AddDevice variant="card" notify={notify} onAdded={() => {}} />);
  fill();
  await waitFor(() => expect(notify).toHaveBeenCalledWith(
    "Added Desk, but it does not answer at wled.lan yet. Check that it is powered and on the network, and that the address is right.", true));
});

test("a refused address keeps the form", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "can't resolve 'nowhere'" }), { status: 422 })));
  const notify = vi.fn();
  const onAdded = vi.fn();
  render(<AddDevice variant="card" notify={notify} onAdded={onAdded} />);
  fill();
  await waitFor(() => expect(notify).toHaveBeenCalledWith("can't resolve 'nowhere'", true));
  expect(onAdded).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Device name")).toHaveValue("Desk");
});
