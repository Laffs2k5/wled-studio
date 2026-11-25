// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { duration, Playlists, total } from "./Playlists";

afterEach(() => vi.unstubAllGlobals());

const looks = [{ name: "Calm", preset_id: 1, segments: [] }, { name: "Party", preset_id: 2, segments: [] },
  { name: "Unslotted", segments: [] }];
const mix = { name: "Mix", preset_id: 9, folder: "Evening", repeat: 2, shuffle: true, end: "Calm",
  entries: [{ look: "Calm", duration: 100, transition: 15 }, { look: "Party", duration: 450, transition: 15 }] };

function stub(fail?: { status: number; detail: string }) {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ key: `${init?.method} ${url}`, body: init?.body as string });
    if (fail && url.includes("/play/")) return new Response(JSON.stringify({ detail: fail.detail }), { status: fail.status });
    if (url.includes("/play/")) return new Response(JSON.stringify({ status: "ok", notes: [] }), { status: 200 });
    return new Response((init?.body as string) ?? "", { status: 200 });
  }));
  return calls;
}

test("builds a playlist from looks with preset ids; the others are offered greyed out, with the reason", async () => {
  const calls = stub();
  const onChanged = vi.fn();
  render(<Playlists looks={looks} playlists={[]} onChanged={onChanged} notify={() => {}} />);
  fireEvent.click(screen.getByText("New playlist"));
  const pick = screen.getByLabelText("Add a look");
  expect([...pick.querySelectorAll("option")].map((o) => [o.textContent, o.disabled]))
    .toEqual([["Choose a look…", false], ["Calm", false], ["Party", false], ["Unslotted (needs a preset id)", true]]);
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Evening mix" } });
  fireEvent.change(screen.getByLabelText("Playlist's preset id (1-250)"), { target: { value: "20" } });
  fireEvent.change(pick, { target: { value: "Calm" } });
  fireEvent.change(screen.getByLabelText("Seconds"), { target: { value: "45" } });
  fireEvent.click(screen.getByText("Add"));
  fireEvent.change(pick, { target: { value: "Party" } });
  fireEvent.click(screen.getByText("Add"));
  expect(screen.getByLabelText("Total duration")).toHaveTextContent("Total: 1 min 30 s per round.");
  // reorder, and change one entry's time
  fireEvent.click(screen.getByLabelText("Move Party up"));
  fireEvent.change(screen.getByLabelText("Seconds for Party"), { target: { value: "15" } });
  expect(screen.getByLabelText("Total duration")).toHaveTextContent("Total: 1 min per round.");
  fireEvent.change(screen.getByLabelText("Fade between looks (s)"), { target: { value: "2" } });
  fireEvent.click(screen.getByLabelText("Shuffle"));
  fireEvent.click(screen.getByText("Save playlist"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(calls[0].key).toBe("PUT /api/playlists/Evening%20mix");
  expect(JSON.parse(calls[0].body!)).toEqual({
    name: "Evening mix", preset_id: 20, repeat: 0, shuffle: true,
    entries: [{ look: "Party", duration: 150, transition: 20 }, { look: "Calm", duration: 450, transition: 20 }],
  });
});

test("Edit loads a saved playlist into the form; saving replaces it and keeps what the form doesn't show", async () => {
  const calls = stub();
  render(<Playlists looks={looks} playlists={[mix]} onChanged={() => {}} notify={() => {}} />);
  expect(screen.getByText("2 looks, shuffled, 55 s per round · preset 9")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Edit playlist Mix"));
  expect(screen.getByText("Edit playlist “Mix”")).toBeInTheDocument();
  expect(screen.getByLabelText("Playlist name (can't be changed here)")).toBeDisabled();
  expect(screen.getByLabelText("Fade between looks (s)")).toHaveValue("1.5");
  expect(within(screen.getByLabelText("Looks in the playlist")).getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(screen.getByLabelText("Remove Calm"));
  fireEvent.click(screen.getByText("Save “Mix”"));
  await waitFor(() => expect(calls.some((c) => c.key === "PUT /api/playlists/Mix")).toBe(true));
  expect(JSON.parse(calls.find((c) => c.key === "PUT /api/playlists/Mix")!.body!)).toEqual({
    name: "Mix", preset_id: 9, repeat: 2, shuffle: true, end: "Calm", entries: [{ look: "Party", duration: 450, transition: 15 }],
  });
  expect(screen.getByText("New playlist")).toBeInTheDocument();     // the form is back to a new one
});

test("Show on strip plays it on the device; a refusal says why on the row", async () => {
  const calls = stub({ status: 409, detail: "Not on Desk yet: preset 2 (“Party”). Write presets first, then show the playlist." });
  render(<Playlists looks={looks} playlists={[mix]} onChanged={() => {}} notify={() => {}} deviceId="desk" deviceName="Desk" />);
  fireEvent.click(screen.getByLabelText("Show Mix on strip"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Not on Desk yet: preset 2 (“Party”). Write presets first");
  expect(calls[0].key).toBe("POST /api/devices/desk/play/Mix");
  stub();
  const onShown = vi.fn();
  render(<Playlists looks={looks} playlists={[{ ...mix, name: "Other" }]} onChanged={() => {}} notify={() => {}} deviceId="desk" deviceName="Desk" onShown={onShown} />);
  fireEvent.click(screen.getByLabelText("Show Other on strip"));
  expect(await screen.findByText("Playing “Other” on Desk (live; nothing is saved on it).")).toBeInTheDocument();
  expect(onShown).toHaveBeenCalled();
});

test("no Show while the device doesn't answer", () => {
  render(<Playlists looks={looks} playlists={[mix]} onChanged={() => {}} notify={() => {}} deviceId="desk" deviceName="Desk" offline />);
  expect(screen.getByLabelText("Show Mix on strip")).toBeDisabled();
});

test("lists and deletes playlists", async () => {
  vi.stubGlobal("confirm", vi.fn(() => true));
  const f = vi.fn(async () => new Response("", { status: 200 }));
  vi.stubGlobal("fetch", f);
  const onChanged = vi.fn();
  render(<Playlists looks={looks} onChanged={onChanged} notify={() => {}}
    playlists={[{ name: "Mix", preset_id: 9, entries: [{ look: "Calm", duration: 100, transition: 7 }], repeat: 0, shuffle: true }]} />);
  expect(screen.getByText("1 look, shuffled, 10 s per round · preset 9")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("More for playlist Mix"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete playlist" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(f).toHaveBeenCalledWith("/api/playlists/Mix", expect.objectContaining({ method: "DELETE" }));
});

test("a playlist shows the worst status of its looks", () => {
  render(<Playlists looks={looks} onChanged={() => {}} notify={() => {}}
    checks={[{ playlist: "Mix", status: "review", notes: ["'Calm' is review"] }]}
    playlists={[{ name: "Mix", preset_id: 9, entries: [{ look: "Calm", duration: 100, transition: 7 }], repeat: 0, shuffle: false }]} />);
  expect(screen.getByText("effect changed")).toHaveAttribute("title", "Plays “Calm”, whose effect has different controls on this device.");
});

test("durations in words", () => {
  expect(duration(450)).toBe("45 s");
  expect(duration(1200)).toBe("2 min");
  expect(total([{ look: "A", duration: 100, transition: 7 }, { look: "B", duration: 0, transition: 7 }])).toBe("stays on “B” once it gets there");
});
