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
