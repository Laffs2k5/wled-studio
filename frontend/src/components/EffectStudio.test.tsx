// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Preview } from "../preview";
import { EffectStudio } from "./EffectStudio";

/** A fake preview module with the same C API as the WebAssembly build. */
function fakeModule() {
  const names = ["Solid", "RSVD", "Studio Comet", "Glow"];
  const metas = ["", "", "Speed,Tail;!;!;1;sx=100,ix=200", "!,!;!;!;1"];
  const strings: string[] = [];
  const str = (s: string) => { strings.push(s); return strings.length - 1; };
  const sets: [number, number][] = [];
  const heap = new Uint32Array(64);
  const m = {
    sets,
    _preview_setup: (n: number) => { void n; },
    _preview_effect_count: () => names.length,
    _preview_effect_name: (id: number) => str(names[id] ?? ""),
    _preview_effect_metadata: (id: number) => str(metas[id] ?? ""),
    _preview_select: (id: number) => id,
    _preview_set: (k: number, v: number) => { sets.push([k, v]); },
    _preview_length: () => 4,
    _preview_frame: () => 0,
    UTF8ToString: (p: number) => strings[p],
    HEAPU32: heap,
  };
  return m;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/effects"
    ? new Response(JSON.stringify({ detail: "off" }), { status: 503 })
    : url === "/api/devices" ? new Response("[]", { status: 200 })
    : new Response(JSON.stringify({ enabled: false }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

test("lists the build's own effects with their controls, and sends changes to the preview", async () => {
  const m = fakeModule();
  render(<EffectStudio notify={() => {}} load={async () => new Preview(m as never)} />);
  const select = await screen.findByLabelText("Preview effect");
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Studio Comet (id 2)", "Glow (id 3)"]);
  expect(screen.getByLabelText("Tail")).toHaveValue("200");    // the effect's default
  m.sets.length = 0;
  fireEvent.change(screen.getByLabelText("Tail"), { target: { value: "50" } });
  expect(m.sets).toContainEqual([1, 50]);
  fireEvent.input(screen.getByLabelText("Colour Fx"), { target: { value: "#00ff00" } });
  expect(m.sets).toContainEqual([9, 0x0000ff00]);
  fireEvent.change(select, { target: { value: "3" } });
  expect(screen.getByLabelText("Intensity")).toBeInTheDocument();
});

test("explains a build without a preview", async () => {
  render(<EffectStudio notify={() => {}} load={async () => { throw new Error("404"); }} />);
  expect(await screen.findByText(/has no effect preview/)).toBeInTheDocument();
});

test("compiles your effects with the builder and previews them", async () => {
  const JID = "c".repeat(32);
  let polls = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (key === "GET /api/firmware/status") return reply({ enabled: true });
    if (key === "GET /api/firmware/usermods") return reply(["my_fx"]);
    if (key === "POST /api/firmware/previews") return reply({ id: JID, state: "queued" }, 202);
    if (key === `GET /api/firmware/jobs/${JID}`) return reply({ id: JID, state: polls++ ? "passed" : "running" });
    return reply({ detail: "no route" }, 404);
  }));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const loads: (string | undefined)[] = [];
  const load = async (url?: string) => { loads.push(url); return new Preview(fakeModule() as never); };
  render(<EffectStudio notify={() => {}} load={load} />);
  fireEvent.click(await screen.findByLabelText("my_fx"));
  fireEvent.click(screen.getByText("Compile and preview"));
  await vi.advanceTimersByTimeAsync(2500);
  await waitFor(() => expect(loads).toContain(`/api/firmware/jobs/${JID}/preview/preview.mjs`));
  vi.useRealTimers();
});

test("frame messages are RGBW with a channel byte", async () => {
  const { frameMessage } = await import("../preview");
  expect(Array.from(frameMessage(new Uint32Array([0x04ff8000, 0x00000001])))).toEqual([4, 255, 128, 0, 4, 0, 0, 1, 0]);
});

test("streams to a device: sizes the preview to its LEDs and opens the stream with the token", async () => {
  const sockets: { url: string; protocols: string[] }[] = [];
  class FakeSocket {
    readyState = 0; bufferedAmount = 0; binaryType = ""; onopen: (() => void) | null = null; onclose: (() => void) | null = null;
    constructor(public url: string, public protocols: string[]) { sockets.push({ url, protocols }); setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
    send() {}
    close() { this.onclose?.(); }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  sessionStorage.setItem("wledstudio.token", "tok");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url === "/api/devices") return reply([{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }]);
    if (url === "/api/devices/desk/profile") return reply({ device: { id: "desk", name: "Desk" }, leds: { count: 250 } });
    if (url === "/api/effects") return reply({ detail: "off" }, 503);
    return reply({ enabled: false });
  }));
  const m = fakeModule();
  const setups: number[] = [];
  m._preview_setup = (n: number) => { setups.push(n); };
  render(<EffectStudio notify={() => {}} load={async () => new Preview(m as never)} />);
  fireEvent.change(await screen.findByLabelText("Stream device"), { target: { value: "desk" } });
  fireEvent.click(screen.getByText("Stream to the strip"));
  expect(await screen.findByText("Stop streaming")).toBeInTheDocument();
  expect(setups).toContain(250);
  expect(sockets[0].url).toMatch(/\/api\/devices\/desk\/stream$/);
  expect(sockets[0].protocols).toEqual(["wledstudio", "bearer.tok"]);
  fireEvent.click(screen.getByText("Stop streaming"));
  expect(await screen.findByText("Stream to the strip")).toBeInTheDocument();
  sessionStorage.clear();
});
