// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { viewOf } from "./Code";
import { CodeEditor, nextFreeId } from "./CodeEditor";

/** The editor's text, and typing into it as a user would (a transaction from the view). */
const textOf = (host: HTMLElement) => viewOf(host)!.state.doc.toString();
function type(host: HTMLElement, text: string) {
  const v = viewOf(host)!;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, userEvent: "input.type" });
}

afterEach(() => vi.unstubAllGlobals());

let mapped = false;
let gitReads = 0;
function stub(files: Record<string, string>) {
  mapped = false;
  gitReads = 0;
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, body: init?.body as string });
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (key === "GET /api/effects") return reply([{ folder: "my_fx", files: ["library.json", "my_fx.cpp"], effect_ids: [253] }]);
    if (key === "GET /api/devices") return reply([{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }]);
    if (key === "POST /api/effects/my_fx/room-map") { mapped = true; return reply({ leds: 250 }); }
    if (key === "GET /api/effects/my_fx/room-map") return reply(mapped
      ? { exists: true, device: "desk", device_name: "Desk", leds: 250, written: "2020-01-02T03:04:05+00:00", stale: false }
      : { exists: true, device: "desk", device_name: "Desk", leds: 240, written: "2020-01-02T03:04:05+00:00", stale: true });
    if (key === "GET /api/effects/my_fx/git") { gitReads++; return reply({ repo: false }); }
    if (key.startsWith("GET /api/effects/")) return reply({ content: files[url.split("/").slice(-1)[0]] ?? "" });
    if (key.startsWith("PUT /api/effects/")) return reply({ bytes: 1 });
    if (key === "POST /api/effects") return reply({ folder: "new_fx", files: ["library.json", "new_fx.cpp"] }, 201);
    return reply({ detail: "no" }, 404);
  }));
  return calls;
}

test("opens, edits and saves a file", async () => {
  const calls = stub({ "my_fx.cpp": "void x() {}\n" });
  const onSaved = vi.fn();
  render(<CodeEditor notify={() => {}} onSaved={onSaved} />);
  const pick = await screen.findByLabelText("Effect file");
  fireEvent.change(pick, { target: { value: "my_fx/my_fx.cpp" } });
  const code = await screen.findByLabelText("Code");
  await waitFor(() => expect(textOf(code)).toBe("void x() {}\n"));
  expect(screen.getByText("Save")).toBeDisabled();   // loading a file isn't an edit
  type(code, "void y() {}\n");
  await waitFor(() => expect(screen.getByText("Save")).toBeEnabled());   // the edit marks it unsaved
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("my_fx"));
  const put = calls.find((c) => c.key === "PUT /api/effects/my_fx/my_fx.cpp")!;
  expect(JSON.parse(put.body!)).toEqual({ content: "void y() {}\n" });
});

test("switching files swaps the text and isn't an edit", async () => {
  stub({ "my_fx.cpp": "void x() {}\n", "library.json": '{"name": "fx"}\n' });
  render(<CodeEditor notify={() => {}} />);
  const pick = await screen.findByLabelText("Effect file");
  fireEvent.change(pick, { target: { value: "my_fx/my_fx.cpp" } });
  const code = await screen.findByLabelText("Code");
  await waitFor(() => expect(textOf(code)).toBe("void x() {}\n"));
  fireEvent.change(pick, { target: { value: "my_fx/library.json" } });
  await waitFor(() => expect(textOf(code)).toBe('{"name": "fx"}\n'));
  expect(screen.getByText("Save")).toBeDisabled();
});

test("a file from the URL opens without the user finding it in the select", async () => {
  stub({ "my_fx.cpp": "void x() {}\n" });
  const onFileOpen = vi.fn();
  render(<CodeEditor notify={() => {}} openFile={{ folder: "my_fx", name: "my_fx.cpp" }} onFileOpen={onFileOpen} />);
  const code = await screen.findByLabelText("Code");
  await waitFor(() => expect(textOf(code)).toBe("void x() {}\n"));
  expect(screen.getByLabelText("Effect file")).toHaveValue("my_fx/my_fx.cpp");
  expect(onFileOpen).toHaveBeenCalledWith("my_fx", "my_fx.cpp");
});

test("a new effect: labelled fields, the next free id with the used ones, then created, opened and offered for compiling", async () => {
  const calls = stub({ "new_fx.cpp": "// template" });
  const onCreated = vi.fn();
  const onCompile = vi.fn();
  render(<CodeEditor notify={() => {}} previewIds={[{ id: 254, by: "Studio Comet" }]} onCreated={onCreated} onCompile={onCompile} />);
  fireEvent.click(await screen.findByRole("button", { name: "＋ New effect" }));
  const form = screen.getByRole("form", { name: "New effect" });
  const id = within(form).getByLabelText("Effect id (200-254; never change it later: presets store it)");
  expect(id).toHaveAttribute("placeholder", "252");                 // 254 and 253 are taken
  expect(within(form).getByText(/252, the next free one, unless you type another\. In use: 253 \(my_fx\), 254 \(Studio Comet\)\./))
    .toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Folder name (lowercase, e.g. my_wave)"), { target: { value: "New-fx" } });
  expect(within(form).getByText(/Lowercase letters, digits and _ only/)).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Folder name (lowercase, e.g. my_wave)"), { target: { value: "new_fx" } });
  fireEvent.change(within(form).getByLabelText("Name shown in WLED"), { target: { value: "New Fx" } });
  fireEvent.change(id, { target: { value: "254" } });
  expect(within(form).getByText("Effect id 254 is taken by Studio Comet.")).toBeInTheDocument();
  expect(within(form).getByRole("button", { name: "Create" })).toBeDisabled();
  fireEvent.change(id, { target: { value: "199" } });
  expect(within(form).getByText("The effect id must be a whole number from 200 to 254.")).toBeInTheDocument();
  fireEvent.change(id, { target: { value: "" } });                   // back to the suggestion
  fireEvent.change(within(form).getByLabelText("Start from"), { target: { value: "room" } });
  fireEvent.click(within(form).getByRole("button", { name: "Create" }));
  const code = await screen.findByLabelText("Code");
  await waitFor(() => expect(textOf(code)).toBe("// template"));
  expect(JSON.parse(calls.find((c) => c.key === "POST /api/effects")!.body!)).toEqual(
    { folder: "new_fx", title: "New Fx", effect_id: 252, template: "room" });
  expect(onCreated).toHaveBeenCalledWith("new_fx");
  expect(screen.getByText(/Created new_fx \(effect id 252\) and opened its code\. It's ticked for compiling\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Compile and preview" }));
  expect(onCompile).toHaveBeenCalled();
});

test("the next free id counts down from 254", () => {
  expect(nextFreeId([])).toBe(254);
  expect(nextFreeId([{ id: 254, by: "a" }, { id: 252, by: "b" }])).toBe(253);
  expect(nextFreeId(Array.from({ length: 55 }, (_, i) => ({ id: 200 + i, by: "x" })))).toBeNull();
});

test("hidden when no effects directory is configured", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "off" }), { status: 503 })));
  const { container } = render(<CodeEditor notify={() => {}} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

test("room-aware effects: says where room_map.h came from and that it's out of date; generating it refreshes the lists", async () => {
  const calls = stub({ "my_fx.cpp": "x" });
  render(<CodeEditor notify={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Effect file"), { target: { value: "my_fx/my_fx.cpp" } });
  const box = await screen.findByRole("region", { name: "Room-aware effects" });
  expect(within(box).getByText(/Effects that include/)).toHaveTextContent("Effects that include room_map.h need each LED's position.");
  const line = await within(box).findByLabelText("room_map.h");
  expect(line).toHaveTextContent(/^room_map\.h: generated from Desk, 240 LEDs \(written .*\)\. Desk's room shape changed since: generate it again\.$/);
  expect(line).toHaveClass("warn");
  fireEvent.change(within(box).getByLabelText("From the room shape of"), { target: { value: "desk" } });
  const listsBefore = calls.filter((c) => c.key === "GET /api/effects").length;
  const gitBefore = gitReads;
  fireEvent.click(within(box).getByText("Generate room_map.h"));
  expect(await within(box).findByText("room_map.h generated: 250 LEDs.")).toBeInTheDocument();
  expect(JSON.parse(calls.find((c) => c.key === "POST /api/effects/my_fx/room-map")!.body!)).toEqual({ device: "desk" });
  await waitFor(() => expect(within(box).getByLabelText("room_map.h")).not.toHaveClass("warn"));
  expect(calls.filter((c) => c.key === "GET /api/effects").length).toBeGreaterThan(listsBefore);   // the file list
  expect(gitReads).toBeGreaterThan(gitBefore);                                                     // the git panel (bug 5)
});

test("the room map comes from the header's device unless another is picked", async () => {
  stub({ "my_fx.cpp": "x" });
  const { rerender } = render(<CodeEditor notify={() => {}} device="desk" />);
  fireEvent.change(await screen.findByLabelText("Effect file"), { target: { value: "my_fx/my_fx.cpp" } });
  expect(await screen.findByLabelText("From the room shape of")).toHaveValue("desk");
  rerender(<CodeEditor notify={() => {}} device={null} />);
  expect(screen.getByLabelText("From the room shape of")).toHaveValue("");
});
