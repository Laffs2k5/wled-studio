// SPDX-License-Identifier: EUPL-1.2
import { api, ApiError, plainDeviceError, request } from "./api";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockImplementation(async () => new Response(body === null ? "" : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

test("writes carry the cross-site guard header, reads don't", async () => {
  const f = mockFetch(200, { ok: true });
  await request("GET", "/api/health");
  expect(f.mock.calls[0][1].headers["X-WLED-Studio"]).toBeUndefined();
  await request("POST", "/api/x", { a: 1 });
  const init = f.mock.calls[1][1];
  expect(init.headers["X-WLED-Studio"]).toBe("1");
  expect(init.headers["Content-Type"]).toBe("application/json");
  expect(init.body).toBe('{"a":1}');
});

test("errors carry the backend's message", async () => {
  mockFetch(422, { detail: "a device host is a name or IP address" });
  await expect(api.addDevice("x", "http://bad")).rejects.toThrow("a device host is a name or IP address");
  mockFetch(422, { detail: [{ msg: "too long" }, { msg: "bad" }] });
  await expect(request("POST", "/api/x", {})).rejects.toThrow("too long; bad");
  mockFetch(409, { detail: { status: "unavailable", notes: ["effect 'Glow' isn't on this device"] } });
  await expect(request("POST", "/api/x", {})).rejects.toThrow(/^effect 'Glow' isn't on this device$/);
  mockFetch(502, null);
  const err = (await request("GET", "/api/x").catch((e: unknown) => e)) as ApiError;
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(502);
});

test("names in paths are encoded", async () => {
  const f = mockFetch(200, {});
  await api.capture("desk", "Evening / warm", 4);
  expect(f.mock.calls[0][0]).toBe("/api/devices/desk/capture/Evening%20%2F%20warm?preset_id=4");
  await api.addDevice("A", "wled.lan", "1234");
  expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ name: "A", host: "wled.lan", pin: "1234" });
});

test("a device failure reads in plain words, without the exception's class name", () => {
  expect(plainDeviceError("http://192.0.2.7:8081/json/info: ConnectError"))
    .toBe("The device at 192.0.2.7:8081 does not answer. Check that it is powered and on the network.");
  expect(plainDeviceError("http://wled.lan: ReadTimeout")).toBe("The device at wled.lan does not answer. Check that it is powered and on the network.");
  expect(plainDeviceError("presets.json: ConnectTimeout")).toBe("The device does not answer. Check that it is powered and on the network.");
  expect(plainDeviceError("http://wled.lan/json/state: HTTP 500")).toBe("The device at wled.lan answered with an error (HTTP 500).");
  expect(plainDeviceError("http://wled.lan: RemoteProtocolError")).toBe("The connection to the device at wled.lan broke off. Try again.");
  expect(plainDeviceError("the device is locked")).toBe("the device is locked");
});
