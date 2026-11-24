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
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test("lists the build's own effects with their controls, and sends changes to the preview", async () => {
  const m = fakeModule();
  render(<EffectStudio notify={() => {}} load={async () => new Preview(m as never)} />);
  const select = await screen.findByLabelText("Preview effect");
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Studio Comet (id 2)", "Glow (id 3)"]);
  expect(screen.getByLabelText("Tail")).toHaveValue("200");    // the effect's default
  m.sets.length = 0;
  fireEvent.change(screen.getByLabelText("Tail"), { target: { value: "50" } });
  expect(m.sets).toContainEqual([1, 50]);
  fireEvent.input(screen.getByLabelText("Colour 1 (effect)"), { target: { value: "#00ff00" } });
  expect(m.sets).toContainEqual([9, 0x0000ff00]);
  fireEvent.change(select, { target: { value: "3" } });
  expect(screen.getByLabelText("Intensity")).toBeInTheDocument();
});

test("a preview with WLED's colour code offers WLED's palettes by name", async () => {
  const base = fakeModule();
  const names = JSON.stringify(["Default", "* Random Cycle", "* Color 1", "* Colors 1&2", "* Color Gradient", "* Colors Only", "Party"]);
  const m = { ...base, _preview_palette_names: () => -1, UTF8ToString: (p: number) => (p === -1 ? names : base.UTF8ToString(p)) };
  render(<EffectStudio notify={() => {}} load={async () => new Preview(m as never)} />);
  const pal = await screen.findByLabelText("Palette");
  expect([...pal.querySelectorAll("option")].map((o) => o.textContent)).toContain("Party");
  expect(screen.getByText(/palettes and fades are WLED's own/)).toBeInTheDocument();
});

test("explains a build without a preview", async () => {
  render(<EffectStudio notify={() => {}} load={async () => { throw new Error("404"); }} />);
  expect(await screen.findByText(/has no effect preview/)).toBeInTheDocument();
});

test("shows the code editor before there is a preview", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/effects"
    ? new Response(JSON.stringify([{ folder: "my-fx", files: ["fx.cpp"] }]), { status: 200 })
    : url === "/api/devices" ? new Response("[]", { status: 200 })
    : new Response(JSON.stringify({ enabled: false }), { status: 200 })));
  render(<EffectStudio notify={() => {}} load={async () => { throw new Error("404"); }} />);
  expect(await screen.findByText(/has no effect preview/)).toBeInTheDocument();
  const files = await screen.findByLabelText("Effect file");
  expect([...files.querySelectorAll("option")].map((o) => o.textContent)).toContain("my-fx/fx.cpp");
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
  expect(await screen.findByLabelText("What the preview shows")).toHaveTextContent(
    "Showing: the built-in example effect, not your code. Compile your own effects to see them.");
  expect(screen.getByText("Effect folders to compile:")).toBeInTheDocument();
  fireEvent.click(await screen.findByLabelText("my_fx"));
  expect(JSON.parse(localStorage.getItem("wledstudio.studio.folders")!)).toEqual(["my_fx"]);   // remembered
  fireEvent.click(screen.getByText("Compile and preview"));
  expect(await screen.findByText(/^Compiling… 0:0\d$/)).toBeInTheDocument();          // with the time so far
  await vi.advanceTimersByTimeAsync(2500);
  await waitFor(() => expect(loads).toContain(`/api/firmware/jobs/${JID}/preview/preview.mjs`));
  await waitFor(() => expect(screen.getByLabelText("What the preview shows")).toHaveTextContent(/^Showing: my_fx, compiled \d\d:\d\d\.$/));
  vi.useRealTimers();
});

test("remembers the ticked folders, and forgets one the builder no longer has", async () => {
  localStorage.setItem("wledstudio.studio.folders", JSON.stringify(["my_fx", "gone_fx"]));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url === "/api/firmware/status") return reply({ enabled: true });
    if (url === "/api/firmware/usermods") return reply(["my_fx", "other_fx"]);
    return reply({ detail: "no route" }, 404);
  }));
  render(<EffectStudio notify={() => {}} load={async () => new Preview(fakeModule() as never)} />);
  expect(await screen.findByLabelText("my_fx")).toBeChecked();
  expect(screen.getByLabelText("other_fx")).not.toBeChecked();
  await waitFor(() => expect(JSON.parse(localStorage.getItem("wledstudio.studio.folders")!)).toEqual(["my_fx"]));
});

test("a failed compile shows the compiler's messages here, and a place opens the file at its line", async () => {
  const JID = "d".repeat(32);
  const log = "noise\n/b/effects/my_fx/fx.cpp:2:5: error: boom\n1 error generated.\nem++: error: failed";
  const notify = vi.fn();
  const reads: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (key === "GET /api/firmware/status") return reply({ enabled: true });
    if (key === "GET /api/firmware/usermods") return reply(["my_fx"]);
    if (key === "GET /api/effects") return reply([{ folder: "my_fx", files: ["fx.cpp"] }]);
    if (key === "GET /api/effects/my_fx/fx.cpp") { reads.push(url); return reply({ content: "line 1\nline 2\nline 3\n" }); }
    if (key === "GET /api/devices") return reply([]);
    if (key === "POST /api/firmware/previews") return reply({ id: JID, state: "queued" }, 202);
    if (key === `GET /api/firmware/jobs/${JID}`) return reply({ id: JID, state: "failed" });
    if (key === `GET /api/firmware/jobs/${JID}/log`) return new Response(log, { status: 200 });
    return reply({ detail: "no route" }, 404);
  }));
  render(<EffectStudio notify={notify} load={async () => new Preview(fakeModule() as never)} />);
  fireEvent.click(await screen.findByLabelText("my_fx"));
  fireEvent.click(screen.getByText("Compile and preview"));
  const errors = await screen.findByRole("alert", { name: "Compile errors" });
  const shortList = errors.querySelector("pre")!;
  expect(shortList).toHaveTextContent("my_fx/fx.cpp:2:5: error: boom");
  expect(shortList).not.toHaveTextContent("em++");
  expect(screen.getByLabelText("Full compile log")).toHaveTextContent("em++: error: failed");
  expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Compiling failed/), true);
  fireEvent.click(screen.getByRole("button", { name: "my_fx/fx.cpp:2:5: error: boom" }));
  const code = await screen.findByLabelText("Code");
  const { viewOf } = await import("./Code");
  await waitFor(() => expect(viewOf(code)?.state.doc.toString()).toBe("line 1\nline 2\nline 3\n"));
  await waitFor(() => expect(viewOf(code)!.state.selection.main.head).toBe(7));   // the start of line 2
  expect(reads).toHaveLength(1);
});

test("saving a file that's in the preview marks the preview out of date", async () => {
  const JID = "e".repeat(32);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (key === "GET /api/firmware/status") return reply({ enabled: true });
    if (key === "GET /api/firmware/usermods") return reply(["my_fx"]);
    if (key === "GET /api/effects") return reply([{ folder: "my_fx", files: ["fx.cpp"] }]);
    if (key === "GET /api/effects/my_fx/fx.cpp") return reply({ content: "x\n" });
    if (key === "PUT /api/effects/my_fx/fx.cpp") return reply({ bytes: 2 });
    if (key === "GET /api/effects/my_fx/git") return reply({ repo: false });
    if (key === "GET /api/devices") return reply([]);
    if (key === "POST /api/firmware/previews") return reply({ id: JID, state: "queued" }, 202);
    if (key === `GET /api/firmware/jobs/${JID}`) return reply({ id: JID, state: "passed" });
    return reply({ detail: "no route" }, 404);
  }));
  render(<EffectStudio notify={() => {}} load={async () => new Preview(fakeModule() as never)} />);
  // opening a file ticks its folder for compiling
  fireEvent.change(await screen.findByLabelText("Effect file"), { target: { value: "my_fx/fx.cpp" } });
  await waitFor(() => expect(screen.getByLabelText("my_fx")).toBeChecked());
  fireEvent.click(screen.getByText("Compile and preview"));
  await waitFor(() => expect(screen.getByLabelText("What the preview shows")).toHaveTextContent(/Showing: my_fx/));
  const code = await screen.findByLabelText("Code");
  const { viewOf } = await import("./Code");
  await waitFor(() => expect(viewOf(code)?.state.doc.toString()).toBe("x\n"));
  const v = viewOf(code)!;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "y\n" }, userEvent: "input.type" });
  fireEvent.click(await screen.findByRole("button", { name: "Save" }));
  expect(await screen.findByText(/Out of date: code changed since this compile/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compile" })).toBeEnabled();
});

test("frame messages are RGBW with a channel byte", async () => {
  const { frameMessage } = await import("../preview");
  expect(Array.from(frameMessage(new Uint32Array([0x04ff8000, 0x00000001])))).toEqual([4, 255, 128, 0, 4, 0, 0, 1, 0]);
});

test("streams to the header's device: sizes the preview to its LEDs and opens the stream with the token", async () => {
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
    if (url === "/api/devices/desk/room") return reply({ edges: [{ direction: "right", pixels: 100 }, { direction: "down", pixels: 150 }] });
    if (url === "/api/effects") return reply({ detail: "off" }, 503);
    return reply({ enabled: false });
  }));
  const m = fakeModule();
  const setups: number[] = [];
  m._preview_setup = (n: number) => { setups.push(n); };
  // the header's device is the preview's device, without picking it here
  render(<EffectStudio notify={() => {}} device="desk" load={async () => new Preview(m as never)} />);
  expect(await screen.findByLabelText("Stream device")).toHaveValue("desk");
  fireEvent.click(screen.getByText("Stream to the strip"));
  expect(await screen.findByText("Stop streaming")).toBeInTheDocument();
  expect(setups).toContain(250);   // the room's LEDs, then the device's
  expect(screen.getByLabelText("Preview strip")).toHaveClass("room");
  expect(sockets[0].url).toMatch(/\/api\/devices\/desk\/stream$/);
  expect(sockets[0].protocols).toEqual(["wledstudio", "bearer.tok"]);
  fireEvent.click(screen.getByText("Stop streaming"));
  expect(await screen.findByText("Stream to the strip")).toBeInTheDocument();
  sessionStorage.clear();
});

test("a sound effect gets the simulated beat or a fixed sound level", async () => {
  const strings: string[] = [];
  const str = (s: string) => { strings.push(s); return strings.length - 1; };
  const names = ["Solid", "Meter"], metas = ["", "Gain;!;!;1v"];
  const sets: [number, number][] = [], audio: number[] = [];
  const m = {
    _preview_setup: () => {}, _preview_effect_count: () => names.length,
    _preview_effect_name: (id: number) => str(names[id]), _preview_effect_metadata: (id: number) => str(metas[id]),
    _preview_select: (id: number) => id, _preview_set: (k: number, v: number) => { sets.push([k, v]); },
    _preview_length: () => 4, _preview_frame: () => 0, _preview_audio: (l: number) => { audio.push(l); },
    UTF8ToString: (p: number) => strings[p], HEAPU32: new Uint32Array(64),
  };
  render(<EffectStudio notify={() => {}} load={async () => new Preview(m as never)} />);
  const beat = await screen.findByLabelText("Simulated beat");
  expect(beat).toBeChecked();
  fireEvent.change(screen.getByLabelText("Sound simulation"), { target: { value: "1" } });
  expect(sets).toContainEqual([12, 1]);                      // WLED's sound simulation setting
  fireEvent.click(beat);                                      // off: a fixed level
  expect(audio.at(-1)).toBe(128);
  fireEvent.change(screen.getByLabelText("Sound level"), { target: { value: "200" } });
  expect(audio.at(-1)).toBe(200);
  fireEvent.click(screen.getByLabelText("Simulated beat"));  // back to the simulation
  expect(audio.at(-1)).toBe(-1);
});

test("no sound controls for a build without preview_audio", async () => {
  const m = fakeModule();
  render(<EffectStudio notify={() => {}} load={async () => new Preview(m as never)} />);
  await screen.findByLabelText("Preview effect");
  expect(screen.queryByLabelText("Simulated beat")).toBeNull();
});
