// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { viewOf } from "./Code";
import { CodeEditor } from "./CodeEditor";

/** The editor's text, and typing into it as a user would (a transaction from the view). */
const textOf = (host: HTMLElement) => viewOf(host)!.state.doc.toString();
function type(host: HTMLElement, text: string) {
  const v = viewOf(host)!;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, userEvent: "input.type" });
}

afterEach(() => vi.unstubAllGlobals());

function stub(files: Record<string, string>) {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, body: init?.body as string });
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (key === "GET /api/effects") return reply([{ folder: "my_fx", files: ["library.json", "my_fx.cpp"] }]);
    if (key === "GET /api/devices") return reply([{ id: "desk", name: "Desk", host: "wled.lan", has_pin: false }]);
    if (key === "POST /api/effects/my_fx/room-map") return reply({ leds: 250 });
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

test("creates a new effect from the template and opens it", async () => {
  const calls = stub({ "new_fx.cpp": "// template" });
  render(<CodeEditor notify={() => {}} />);
  fireEvent.click(await screen.findByText("New effect"));
  fireEvent.change(screen.getByLabelText("New effect folder"), { target: { value: "new_fx" } });
  fireEvent.change(screen.getByLabelText("New effect name"), { target: { value: "New Fx" } });
  fireEvent.change(screen.getByLabelText("Effect id"), { target: { value: "251" } });
  fireEvent.click(screen.getByText("Create"));
  const code = await screen.findByLabelText("Code");
  await waitFor(() => expect(textOf(code)).toBe("// template"));
  expect(JSON.parse(calls.find((c) => c.key === "POST /api/effects")!.body!)).toEqual(
    { folder: "new_fx", title: "New Fx", effect_id: 251, template: "wave" });
});

test("hidden when no effects directory is configured", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "off" }), { status: 503 })));
  const { container } = render(<CodeEditor notify={() => {}} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

test("writes the room map for the open effect", async () => {
  const calls = stub({ "my_fx.cpp": "x" });
  const notify = vi.fn();
  render(<CodeEditor notify={notify} />);
  fireEvent.change(await screen.findByLabelText("Effect file"), { target: { value: "my_fx/my_fx.cpp" } });
  fireEvent.change(await screen.findByLabelText("Room map device"), { target: { value: "desk" } });
  fireEvent.click(screen.getByText("Write room map"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("room_map.h written: 250 LEDs"));
  expect(JSON.parse(calls.find((c) => c.key === "POST /api/effects/my_fx/room-map")!.body!)).toEqual({ device: "desk" });
});

test("the room map comes from the header's device unless another is picked", async () => {
  stub({ "my_fx.cpp": "x" });
  const { rerender } = render(<CodeEditor notify={() => {}} device="desk" />);
  fireEvent.change(await screen.findByLabelText("Effect file"), { target: { value: "my_fx/my_fx.cpp" } });
  expect(await screen.findByLabelText("Room map device")).toHaveValue("desk");
  rerender(<CodeEditor notify={() => {}} device={null} />);
  expect(screen.getByLabelText("Room map device")).toHaveValue("");
});
