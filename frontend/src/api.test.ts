// SPDX-License-Identifier: EUPL-1.2
import { api, ApiError, request } from "./api";

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
