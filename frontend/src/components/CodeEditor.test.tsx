// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CodeEditor } from "./CodeEditor";

afterEach(() => vi.unstubAllGlobals());

function stub(files: Record<string, string>) {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, body: init?.body as string });
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (key === "GET /api/effects") return reply([{ folder: "my_fx", files: ["library.json", "my_fx.cpp"] }]);
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
  expect(code).toHaveValue("void x() {}\n");
  expect(screen.getByText("Save")).toBeDisabled();
  fireEvent.change(code, { target: { value: "void y() {}\n" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("my_fx"));
  const put = calls.find((c) => c.key === "PUT /api/effects/my_fx/my_fx.cpp")!;
  expect(JSON.parse(put.body!)).toEqual({ content: "void y() {}\n" });
});

test("tab indents inside the editor", async () => {
  stub({ "my_fx.cpp": "ab" });
  render(<CodeEditor notify={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Effect file"), { target: { value: "my_fx/my_fx.cpp" } });
  const code = (await screen.findByLabelText("Code")) as HTMLTextAreaElement;
  code.setSelectionRange(1, 1);
  fireEvent.keyDown(code, { key: "Tab" });
  expect(code).toHaveValue("a  b");
});

test("creates a new effect from the template and opens it", async () => {
  const calls = stub({ "new_fx.cpp": "// template" });
  render(<CodeEditor notify={() => {}} />);
  fireEvent.click(await screen.findByText("New effect"));
  fireEvent.change(screen.getByLabelText("New effect folder"), { target: { value: "new_fx" } });
  fireEvent.change(screen.getByLabelText("New effect name"), { target: { value: "New Fx" } });
  fireEvent.change(screen.getByLabelText("Effect id"), { target: { value: "251" } });
  fireEvent.click(screen.getByText("Create"));
  expect(await screen.findByLabelText("Code")).toHaveValue("// template");
  expect(JSON.parse(calls.find((c) => c.key === "POST /api/effects")!.body!)).toEqual({ folder: "new_fx", title: "New Fx", effect_id: 251 });
});

test("hidden when no effects directory is configured", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "off" }), { status: 503 })));
  const { container } = render(<CodeEditor notify={() => {}} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
