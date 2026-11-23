// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionBar } from "./SessionBar";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(session: { active: boolean; started: number | null }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    if (key.startsWith("POST")) return new Response(JSON.stringify({ active: true, started: 1_800_000_000 }));
    if (key.startsWith("DELETE")) return new Response(JSON.stringify({ restored: url.endsWith("true") }));
    return new Response(JSON.stringify(session));
  }));
  return calls;
}

test("start, then put the device back", async () => {
  const calls = stubFetch({ active: false, started: null });
  const onRestored = vi.fn();
  const notify = vi.fn();
  const flush = vi.fn(async () => {});
  render(<SessionBar deviceId="desk" notify={notify} beforeAction={flush} onRestored={onRestored} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start editing session" }));
  expect(await screen.findByText(/Editing since/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Done: put the device back" }));
  await waitFor(() => expect(onRestored).toHaveBeenCalled());
  expect(flush).toHaveBeenCalled();
  expect(calls).toEqual(["GET /api/devices/desk/session", "POST /api/devices/desk/session",
    "DELETE /api/devices/desk/session?restore=true"]);
  expect(notify).toHaveBeenCalledWith("The device is back as it was");
  expect(screen.getByRole("button", { name: "Start editing session" })).toBeInTheDocument();
});

test("a running session is shown, and can end keeping the changes", async () => {
  const calls = stubFetch({ active: true, started: 1_800_000_000 });
  const onRestored = vi.fn();
  render(<SessionBar deviceId="desk" notify={() => {}} onRestored={onRestored} />);
  fireEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Start editing session" }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining("already running"), true));
});
