// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { importLines, LibraryTransfer } from "./LibraryTransfer";

afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test("library import is inspected before one explicit merge", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/library/versions") return reply([]);
    return reply({ looks: 1, playlists: 0, palettes: 0, kept: [], rooms: ["Desk"], unmatched_devices: ["Porch"] });
  }));
  const changed = vi.fn();
  render(<LibraryTransfer notify={() => {}} onChanged={changed} />);
  const file = new File(["{}"], "library.json", { type: "application/json" });
  fireEvent.change(screen.getByLabelText("Import a library file"), { target: { files: [file] } });
  fireEvent.click(screen.getByText("Inspect before import"));
  const confirm = await screen.findByRole("group", { name: "Confirm library import" });
  expect(confirm).toHaveTextContent("Will import 1 looks");
  expect(confirm).toHaveTextContent("Room model for: Desk.");
  expect(confirm).toHaveTextContent("No device here named Porch");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Import the library"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(calls.filter((c) => c.startsWith("POST"))).toEqual([
    "POST /api/library/archive/import?mode=keep&preview=true",
    "POST /api/library/archive/import?mode=keep&preview=false",
  ]);
});

test("an earlier version is restored after a second click", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
    if (url === "/api/library/versions") return reply([
      { name: "library-00007.json", saved: "2026-01-02T10:00:00+00:00", looks: 4, playlists: 1, palettes: 0 },
    ]);
    return reply({ looks: 4, playlists: 1, palettes: 0 });
  }));
  const changed = vi.fn();
  render(<LibraryTransfer notify={() => {}} onChanged={changed} />);
  expect(await screen.findByText(/Earlier versions of the library \(1\)/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Restore…"));
  const group = screen.getByRole("group", { name: /Confirm restoring/ });
  fireEvent.click(within(group).getByText("Restore this version"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(calls).toContain('POST /api/library/versions/library-00007.json/restore {"confirm":"restore"}');
  expect(screen.getByRole("status")).toHaveTextContent("Library restored: 4 looks");
});

test("importLines says what an import does, done or planned", () => {
  const r = { looks: 2, playlists: 0, palettes: 1, kept: ["Calm"], slot_grids: 1, kept_grids: [],
    protected_presets: 0, rooms: [], sets: ["Desk"], unmatched_devices: [] };
  expect(importLines(r, false)).toEqual([
    "Will import 2 looks, 0 playlists and 1 palettes.",
    "Kept as they are here (same name): Calm.",
    "Adds or replaces 1 slot grid.",
    "Device set for: Desk.",
  ]);
  expect(importLines(r, true)[0]).toBe("Imported 2 looks, 0 playlists and 1 palettes.");
});
