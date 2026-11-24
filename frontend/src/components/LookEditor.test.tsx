// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { profile } from "../test/fixtures";
import { LookEditor, type EditedLook } from "./LookEditor";

afterEach(() => vi.unstubAllGlobals());

const base: EditedLook = {
  name: "Calm", preset_id: 6, status: "ok", notes: [], owns_layout: true, ids: true, bounds: true,
  state: { on: true, bri: 90, seg: [{ id: 0, start: 0, stop: 40, fx: 8, sx: 10, lc: 9 }, { id: 1, start: 40, stop: 60, fx: 0 }] },
};

function stub(look: EditedLook, status = 200) {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, body: init?.body as string | undefined });
    if (key.startsWith("GET")) return new Response(JSON.stringify(status === 200 ? look : { detail: "gone" }), { status });
    return new Response(JSON.stringify({ name: look.name, segments: [] }));
  }));
  return calls;
}

test("edits a saved look and saves it, without the strip", async () => {
  const calls = stub(base);
  const onClose = vi.fn();
  render(<LookEditor deviceId="desk" name="Calm" profile={profile} room={null} notify={() => {}} onClose={onClose} />);
  expect(await screen.findByText(/Editing “Calm”/)).toBeInTheDocument();
  expect(screen.getByText(/preset 6/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Tail"), { target: { value: "200" } });             // Comet's control
  fireEvent.click(screen.getByRole("button", { name: /^Segment 1/ }));
  expect(screen.queryByLabelText("Sound simulation")).toBeNull();
  fireEvent.change(screen.getByLabelText("Effect"), { target: { value: "5" } });             // Pulse Meter
  fireEvent.change(screen.getByLabelText("Sound simulation"), { target: { value: "2" } });   // a sound effect's beat
  fireEvent.click(screen.getByRole("button", { name: "Lower" }));                          // segment 1 under segment 0
  fireEvent.change(screen.getByLabelText("Look brightness"), { target: { value: "120" } });
  fireEvent.click(screen.getByRole("button", { name: "Save “Calm”" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  const post = calls.find((c) => c.key === "POST /api/devices/desk/looks/Calm")!;
  const body = JSON.parse(post.body!);
  expect(body.seg.map((s: { id: number; fx: number; start: number }) => [s.id, s.fx, s.start])).toEqual([[0, 5, 40], [1, 8, 0]]);
  expect(body.seg[1].ix).toBe(200);
  expect(body.seg[0].si).toBe(2);
  expect(body.seg[1].lc).toBe(9);   // WLED's own field passes through unchanged
  expect(body).toMatchObject({ bri: 120, on: true, owns_layout: true, ids: true });
  expect(calls.some((c) => c.key.startsWith("POST /api/devices/desk/state"))).toBe(false);
});

test("add, duplicate and remove segments in the editor", async () => {
  const calls = stub(base);
  render(<LookEditor deviceId="desk" name="Calm" profile={profile} room={null} notify={() => {}} onClose={() => {}} />);
  await screen.findByText(/Editing “Calm”/);
  fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
  expect(screen.getByRole("button", { name: /^Segment 2/ })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "+ Segment" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove segment 3" }));
  fireEvent.click(screen.getByRole("button", { name: "Save “Calm”" }));
  await waitFor(() => expect(calls.some((c) => c.key.startsWith("POST"))).toBe(true));
  const body = JSON.parse(calls.find((c) => c.key.startsWith("POST"))!.body!);
  expect(body.seg.map((s: { id: number; fx: number }) => [s.id, s.fx])).toEqual([[0, 8], [1, 0], [2, 8]]);
});

test("a look without the layout shows no layout tools", async () => {
  stub({ ...base, bounds: false, owns_layout: false, ids: false, state: { seg: [{ id: 0, fx: 8 }] } });
  render(<LookEditor deviceId="desk" name="Calm" profile={profile} room={null} notify={() => {}} onClose={() => {}} />);
  expect(await screen.findByText(/leaves the layout alone/)).toBeInTheDocument();
  expect(screen.queryByText("Layout and layer")).toBeNull();
  expect(screen.queryByRole("button", { name: "Raise" })).toBeNull();
});

test("a look that can't be opened is reported, and the editor closes", async () => {
  stub(base, 409);
  const notify = vi.fn();
  const onClose = vi.fn();
  render(<LookEditor deviceId="desk" name="Calm" profile={profile} room={null} notify={notify} onClose={onClose} />);
  await waitFor(() => expect(onClose).toHaveBeenCalledWith(false));
  expect(notify).toHaveBeenCalledWith(expect.any(String), true);
});

test("editing one control saves only the look's own fields plus that one, not the display defaults", async () => {
  // like a bank look written by a script: no bounds, no id, a few fields
  const minimal: EditedLook = { ...base, bounds: false, owns_layout: false, ids: false,
    state: { on: true, bri: 120, seg: [{ id: 0, frz: false, fx: 8, sx: 100, pal: 0 }] } };
  const calls = stub(minimal);
  render(<LookEditor deviceId="desk" name="Calm" profile={profile} room={null} notify={() => {}} onClose={() => {}} />);
  await screen.findByText(/Editing “Calm”/);
  fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "200" } });
  fireEvent.click(screen.getByRole("button", { name: "Save “Calm”" }));
  await waitFor(() => expect(calls.some((c) => c.key.startsWith("POST"))).toBe(true));
  const body = JSON.parse(calls.find((c) => c.key.startsWith("POST"))!.body!);
  expect(body.seg).toEqual([{ id: 0, frz: false, fx: 8, sx: 200, pal: 0 }]);
  expect(body).toMatchObject({ owns_layout: false, ids: false });
});
