// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionBar, showedText } from "./SessionBar";

afterEach(() => vi.unstubAllGlobals());

const SHOWED = { preset: null, playlist: null, fx: [8] };

function stubFetch(session: { active: boolean; started: number | null }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    if (key.startsWith("POST")) return new Response(JSON.stringify({ active: true, started: 1_800_000_000, showed: SHOWED }));
    if (key.startsWith("DELETE")) return new Response(JSON.stringify({ restored: url.endsWith("true") }));
    return new Response(JSON.stringify(session));
  }));
  return calls;
}

test("remember what the strip shows, then put it back; it says what it showed, and that saving isn't affected", async () => {
  const calls = stubFetch({ active: false, started: null });
  const onRestored = vi.fn();
  const notify = vi.fn();
  const flush = vi.fn(async () => {});
  render(<SessionBar deviceId="desk" notify={notify} beforeAction={flush} onRestored={onRestored}
    effects={[{ id: 8, name: "Comet" }]} />);
  expect(await screen.findByText(/so you can put it back after trying things\. Saving a look is not affected\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remember what the strip shows now" }));
  expect(await screen.findByLabelText("Trying things")).toHaveTextContent(
    /^Trying things since \d\d?:\d\d( [AP]M)?\. Before that, the strip showed Comet\. Saving a look is not affected\./);
  // neither way out is the primary button: ending keeps or loses what the strip shows
  const back = screen.getByRole("button", { name: "Put the strip back as it was" });
  expect(back).not.toHaveClass("primary");
  expect(screen.getByRole("button", { name: "Keep what it shows now" })).not.toHaveClass("primary");
  fireEvent.click(back);
  await waitFor(() => expect(onRestored).toHaveBeenCalled());
  expect(flush).toHaveBeenCalled();
  expect(calls).toEqual(["GET /api/devices/desk/session", "POST /api/devices/desk/session",
    "DELETE /api/devices/desk/session?restore=true"]);
  expect(notify).toHaveBeenCalledWith("The strip is back as it was");
  expect(screen.getByRole("button", { name: "Remember what the strip shows now" })).toBeInTheDocument();
});

test("a running session is shown, and can end keeping what the strip shows", async () => {
  const calls = stubFetch({ active: true, started: 1_800_000_000 });
  const onRestored = vi.fn();
  render(<SessionBar deviceId="desk" notify={() => {}} onRestored={onRestored} />);
  fireEvent.click(await screen.findByRole("button", { name: "Keep what it shows now" }));
  await waitFor(() => expect(calls).toContain("DELETE /api/devices/desk/session?restore=false"));
  expect(onRestored).not.toHaveBeenCalled();
});

test("a failure is reported and the bar shows the server's view again", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? new Response(JSON.stringify({ detail: "an editing session is already running on this device" }), { status: 409 })
      : new Response(JSON.stringify({ active: false, started: null }))));
  const notify = vi.fn();
  render(<SessionBar deviceId="desk" notify={notify} onRestored={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Remember what the strip shows now" }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining("already running"), true));
});

test("what the strip showed, in words", () => {
  const looks = [{ name: "Evening", preset_id: 3, segments: [] }];
  const playlists = [{ name: "Mix", preset_id: 20, entries: [], repeat: 0, shuffle: false }];
  expect(showedText({ preset: 3, playlist: null, fx: [8] }, [], looks)).toBe("preset 3 “Evening”");
  expect(showedText({ preset: 4, playlist: 20, fx: [8] }, [], looks, playlists)).toBe("playlist 20 “Mix”");
  expect(showedText({ preset: 9, playlist: null, fx: [] })).toBe("preset 9");
  expect(showedText({ preset: null, playlist: null, fx: [8, 2, 3] }, [{ id: 8, name: "Comet" }])).toBe("Comet and 2 more segments");
  expect(showedText({ preset: null, playlist: null, fx: [5] })).toBe("effect 5");
  expect(showedText({ preset: null, playlist: null, fx: [] })).toBeNull();
  expect(showedText(null)).toBeNull();
});
