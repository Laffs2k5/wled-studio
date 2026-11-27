// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { gradient, Palettes } from "./Palettes";

afterEach(() => vi.unstubAllGlobals());

test("gradient", () => {
  expect(gradient([[0, "ff0000"], [255, "0000ff"]])).toBe("linear-gradient(to right, #ff0000 0%, #0000ff 100%)");
});

test("creates a palette with an extra stop, sorted by position", async () => {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ key: `${init?.method} ${url}`, body: init?.body as string });
    return new Response(init?.body as string, { status: 200 });
  }));
  const onChanged = vi.fn();
  render(<Palettes palettes={[]} onChanged={onChanged} notify={() => {}} />);
  fireEvent.click(screen.getByText("New palette"));
  fireEvent.change(screen.getByLabelText("Palette name"), { target: { value: "Dawn" } });
  expect(screen.getByText("New palette")).toBeInTheDocument();      // not "Edit “Dawn”" before it's saved
  fireEvent.click(screen.getByText("Add stop"));
  fireEvent.input(screen.getByLabelText("Stop 2 colour"), { target: { value: "#00ff00" } });
  fireEvent.change(screen.getByLabelText("Stop 2 position"), { target: { value: "40" } });
  expect(screen.getByLabelText("Stop 2 at")).toHaveTextContent("40");
  expect(screen.getByLabelText("Stop 1 position")).toBeDisabled();
  fireEvent.click(screen.getByText("Save palette"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(calls[0].key).toBe("PUT /api/palettes/Dawn");
  expect(JSON.parse(calls[0].body!)).toEqual({ name: "Dawn", stops: [[0, "ff3300"], [40, "00ff00"], [255, "3300ff"]] });
});

test("edit loads an existing palette; delete asks first", async () => {
  const f = vi.fn(async () => new Response("", { status: 200 }));
  vi.stubGlobal("fetch", f);
  const onChanged = vi.fn();
  render(<Palettes palettes={[{ name: "Ice", stops: [[0, "ffffff"], [255, "0044ff"]] }]} onChanged={onChanged} notify={() => {}} />);
  fireEvent.click(screen.getByText("Edit"));
  expect(screen.getByText("Edit “Ice”")).toBeInTheDocument();
  expect(screen.getByLabelText("Palette name (a new name saves a copy)")).toHaveValue("Ice");
  expect(screen.getByLabelText("Stop 2 colour")).toHaveValue("#0044ff");
  fireEvent.click(screen.getByLabelText("Delete palette Ice"));
  expect(screen.getByLabelText("Delete palette Ice?")).toHaveTextContent("Looks that use it keep their saved palette name");
  fireEvent.click(screen.getByRole("button", { name: "Delete palette" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

test("after a save: the editor closes, the row says how to use it; each row says whether it's on the device", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => new Response(init?.body as string, { status: 200 })));
  const onCheckAndWrite = vi.fn();
  const ice = { name: "Ice", stops: [[0, "ffffff"], [255, "0044ff"]] as [number, string][] };
  const { rerender } = render(<Palettes palettes={[ice]} onChanged={() => {}} notify={() => {}} deviceName="Desk" pending={["Ice"]}
    onCheckAndWrite={onCheckAndWrite} />);
  expect(screen.getByText("not on Desk yet")).toHaveClass("warn");
  fireEvent.click(screen.getByLabelText("Edit palette Ice"));
  fireEvent.click(screen.getByText("Save palette"));
  const note = await screen.findByLabelText("Palette saved");
  expect(note).toHaveTextContent("Saved “Ice” in the library. To use it: write presets to Desk once, then pick it in an effect's Palette list.");
  expect(screen.getByText("Ice").closest("li")).toHaveClass("just-saved");
  expect(screen.getByText("New palette").closest("details")).not.toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Check and write" }));
  expect(onCheckAndWrite).toHaveBeenCalled();
  rerender(<Palettes palettes={[ice]} onChanged={() => {}} notify={() => {}} deviceName="Desk" pending={[]} />);
  expect(screen.getByText("on Desk")).toBeInTheDocument();
  rerender(<Palettes palettes={[ice]} onChanged={() => {}} notify={() => {}} deviceName="Desk" pending={null} />);
  expect(screen.queryByText(/on Desk/)).toBeNull();                 // unknown while the device can't be checked
});

test("lists device palettes and imports only selected WLED-made files", async () => {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (init?.method === "POST") return new Response(JSON.stringify({ imported: ["Warm"], replaced: [] }));
    return new Response(JSON.stringify([
      { index: 0, id: 200, stops: [[0, "112233"], [255, "445566"]],
        owned: true, owned_name: "Studio", in_library: true, library_name: "Studio" },
      { index: 2, id: 198, stops: [[0, "ff4400"], [255, "0000ff"]],
        owned: false, owned_name: null, in_library: false, library_name: null },
      { index: 3, id: 197, stops: [[0, "ffffff"], [255, "0044ff"]],
        owned: false, owned_name: null, in_library: true, library_name: "Ice" },
    ]));
  }));
  const onChanged = vi.fn();
  render(<Palettes palettes={[{ name: "Studio", stops: [[0, "112233"], [255, "445566"]] },
    { name: "Ice", stops: [[0, "ffffff"], [255, "0044ff"]] }]}
    onChanged={onChanged} notify={() => {}} deviceId="desk" deviceName="Desk" />);

  expect(await screen.findByLabelText("Palettes on the device")).toBeInTheDocument();
  expect(screen.getByLabelText("Import palette 200")).not.toBeChecked();
  expect(screen.getByLabelText("Import palette 198")).toBeChecked();
  expect(screen.getByLabelText("Import palette 197")).not.toBeChecked();
  expect(screen.getByText("Owned as “Studio”")).toBeInTheDocument();
  expect(screen.getByText("Already in the library as “Ice”")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Name for palette 198"), { target: { value: "Warm" } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(calls.find((call) => call.url.endsWith("/palettes/import"))?.body).toEqual({
    palettes: [{ index: 2, name: "Warm" }], replace: false,
  });
  expect(screen.getByRole("status")).toHaveTextContent("Imported 1 palette.");
});

test("asks before replacing a library palette during device import", async () => {
  const f = vi.fn(async (_url: string, init?: RequestInit) => new Response(
    JSON.stringify(init?.method === "POST" ? { imported: ["Ice"], replaced: ["Ice"] } : [
      { index: 1, id: 199, stops: [[0, "ff0000"], [255, "0000ff"]],
        owned: false, owned_name: null, in_library: false, library_name: null },
    ])));
  vi.stubGlobal("fetch", f);
  render(<Palettes palettes={[{ name: "Ice", stops: [[0, "ffffff"], [255, "0000ff"]] }]}
    onChanged={() => {}} notify={() => {}} deviceId="desk" />);
  await screen.findByLabelText("Name for palette 199");
  fireEvent.change(screen.getByLabelText("Name for palette 199"), { target: { value: "Ice" } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  expect(screen.getByLabelText("Replace existing palettes?")).toHaveTextContent("Replace “Ice” in the library?");
  fireEvent.click(screen.getByRole("button", { name: "Replace and import" }));
  await waitFor(() => expect(JSON.parse((f.mock.calls[1][1] as RequestInit).body as string).replace).toBe(true));
});
