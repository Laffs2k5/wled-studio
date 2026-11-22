// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Playlists } from "./Playlists";

afterEach(() => vi.unstubAllGlobals());

const looks = [{ name: "Calm", preset_id: 1, segments: [] }, { name: "Party", preset_id: 2, segments: [] },
  { name: "Unslotted", segments: [] }];

test("builds a playlist from looks with slots and saves it", async () => {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ key: `${init?.method} ${url}`, body: init?.body as string });
    return new Response(init?.body as string, { status: 200 });
  }));
  const onChanged = vi.fn();
  render(<Playlists looks={looks} playlists={[]} onChanged={onChanged} notify={() => {}} />);
  fireEvent.click(screen.getByText("New playlist"));
  expect([...screen.getByLabelText("Look to add").querySelectorAll("option")].map((o) => o.textContent))
    .toEqual(["Add a look…", "Calm", "Party"]);
  expect(screen.getByText("Only looks with a slot can be in a playlist.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Evening mix" } });
  fireEvent.change(screen.getByLabelText("Playlist slot"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("Look to add"), { target: { value: "Calm" } });
  fireEvent.change(screen.getByLabelText("Seconds"), { target: { value: "45" } });
  fireEvent.click(screen.getByText("Add"));
  fireEvent.change(screen.getByLabelText("Look to add"), { target: { value: "Party" } });
  fireEvent.click(screen.getByText("Add"));
  fireEvent.click(screen.getByLabelText("Shuffle"));
  fireEvent.click(screen.getByText("Save playlist"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(calls[0].key).toBe("PUT /api/playlists/Evening%20mix");
  expect(JSON.parse(calls[0].body!)).toEqual({
    name: "Evening mix", preset_id: 20, repeat: 0, shuffle: true,
    entries: [{ look: "Calm", duration: 450, transition: 7 }, { look: "Party", duration: 450, transition: 7 }],
  });
});

test("lists and deletes playlists", async () => {
  vi.stubGlobal("confirm", vi.fn(() => true));
  const f = vi.fn(async () => new Response("", { status: 200 }));
  vi.stubGlobal("fetch", f);
  const onChanged = vi.fn();
  render(<Playlists looks={looks} onChanged={onChanged} notify={() => {}}
    playlists={[{ name: "Mix", preset_id: 9, entries: [{ look: "Calm", duration: 100, transition: 7 }], repeat: 0, shuffle: true }]} />);
  expect(screen.getByText("1 looks, shuffled · slot 9")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Delete playlist Mix"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(f).toHaveBeenCalledWith("/api/playlists/Mix", expect.objectContaining({ method: "DELETE" }));
});
