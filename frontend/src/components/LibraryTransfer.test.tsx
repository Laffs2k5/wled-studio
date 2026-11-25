// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LibraryTransfer } from "./LibraryTransfer";

afterEach(() => vi.unstubAllGlobals());

test("library import is inspected before one explicit merge", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ looks: 1, playlists: 0, palettes: 0, kept: [] }), { status: 200 });
  }));
  const changed = vi.fn();
  render(<LibraryTransfer notify={() => {}} onChanged={changed} />);
  const file = new File(["{}"], "library.json", { type: "application/json" });
  fireEvent.change(screen.getByLabelText("Import a library file"), { target: { files: [file] } });
  fireEvent.click(screen.getByText("Inspect before import"));
  expect(await screen.findByRole("group", { name: "Confirm library import" })).toHaveTextContent("Will merge 1 looks");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Import the library"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(calls).toEqual([
    "POST /api/library/archive/import?mode=keep&preview=true",
    "POST /api/library/archive/import?mode=keep&preview=false",
  ]);
});
