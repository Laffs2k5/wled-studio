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
  fireEvent.click(screen.getByText("Add stop"));
  fireEvent.input(screen.getByLabelText("Stop 2 colour"), { target: { value: "#00ff00" } });
  fireEvent.change(screen.getByLabelText("Stop 2 position"), { target: { value: "40" } });
  expect(screen.getByLabelText("Stop 1 position")).toBeDisabled();
  fireEvent.click(screen.getByText("Save palette"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(calls[0].key).toBe("PUT /api/palettes/Dawn");
  expect(JSON.parse(calls[0].body!)).toEqual({ name: "Dawn", stops: [[0, "ff3300"], [40, "00ff00"], [255, "3300ff"]] });
});

test("edit loads an existing palette; delete asks first", async () => {
  vi.stubGlobal("confirm", vi.fn(() => true));
  const f = vi.fn(async () => new Response("", { status: 200 }));
  vi.stubGlobal("fetch", f);
  const onChanged = vi.fn();
  render(<Palettes palettes={[{ name: "Ice", stops: [[0, "ffffff"], [255, "0044ff"]] }]} onChanged={onChanged} notify={() => {}} />);
  fireEvent.click(screen.getByText("Edit"));
  expect(screen.getByLabelText("Palette name")).toHaveValue("Ice");
  expect(screen.getByLabelText("Stop 2 colour")).toHaveValue("#0044ff");
  fireEvent.click(screen.getByLabelText("Delete palette Ice"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});
