// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Looks } from "./Looks";

function stubFetch(routes: Record<string, unknown>) {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, body: init?.body as string | undefined });
    const match = Object.keys(routes).find((k) => key.startsWith(k));
    return new Response(JSON.stringify(match ? routes[match] : { detail: "no route" }), { status: match ? 200 : 404 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const looks = [{ name: "Evening", preset_id: 3, mic: false, segments: [] }, { name: "Loose", segments: [] }];

test("lists looks with their slots", () => {
  render(<Looks deviceId="desk" looks={looks} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
  expect(screen.getByText("slot 3")).toBeInTheDocument();
  expect(screen.getByText("no slot")).toBeInTheDocument();
});

test("a look on walls names them", () => {
  const onWalls = [{ name: "Ends", segments: [{ start: 0, stop: 20, wall: "A" }, { start: 20, stop: 60, wall: "L2" },
    { start: 60, stop: 70, wall: "A" }] }];
  render(<Looks deviceId="desk" looks={onWalls} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
  expect(screen.getByTitle("Follows these walls of the room model")).toHaveTextContent("A · L2");
});

test("import and capture call the API and refresh", async () => {
  const calls = stubFetch({
    "POST /api/devices/desk/import": { imported: ["A"], kept_existing: [], skipped_presets: [] },
    "POST /api/devices/desk/capture/": { name: "Night", segments: [] },
  });
  const onChanged = vi.fn();
  const notify = vi.fn();
  render(<Looks deviceId="desk" looks={[]} onChanged={onChanged} onApplied={() => {}} notify={notify} />);
  fireEvent.click(screen.getByText("Import from device"));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(notify).toHaveBeenCalledWith("Imported 1, kept 0 existing");
  fireEvent.change(screen.getByLabelText("Look name"), { target: { value: "Night" } });
  fireEvent.change(screen.getByLabelText("Preset slot"), { target: { value: "7" } });
  fireEvent.click(screen.getByText("Save current"));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  expect(calls.map((c) => c.key)).toContain("POST /api/devices/desk/capture/Night?preset_id=7");
});

test("check, then write; drift must be acknowledged", async () => {
  const plan = {
    done: false, drift: true, changed_ids: ["3"], backup: null, reason: "dry run",
    report: [{ look: "Evening", preset_id: 3, status: "review", notes: ["'Comet': metadata changed (review)"], written: false }],
  };
  const calls = stubFetch({ "POST /api/devices/desk/push": plan });
  render(<Looks deviceId="desk" looks={looks} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
  fireEvent.click(screen.getByText("Check what would change"));
  expect(await screen.findByText(/changed since the last write/)).toBeInTheDocument();
  const write = screen.getByText("Write 1 slot(s)");
  expect(write).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Write anyway/));
  fireEvent.click(screen.getByLabelText(/marked “review” too/));
  expect(write).toBeEnabled();
  fireEvent.click(write);
  await waitFor(() => expect(calls.length).toBe(2));
  expect(JSON.parse(calls[1].body!)).toEqual({ dry_run: false, adopt_drift: true, accept_review: true });
});

test("show a look live; delete asks first", async () => {
  const calls = stubFetch({ "POST /api/devices/desk/apply/": { status: "ok", notes: [] }, "DELETE /api/looks/": null });
  const onApplied = vi.fn();
  vi.stubGlobal("confirm", vi.fn(() => true));
  render(<Looks deviceId="desk" looks={looks} onChanged={() => {}} onApplied={onApplied} notify={() => {}} />);
  fireEvent.click(screen.getAllByText("Show")[0]);
  await waitFor(() => expect(onApplied).toHaveBeenCalled());
  fireEvent.click(screen.getByLabelText("Delete Evening"));
  await waitFor(() => expect(calls.some((c) => c.key === "DELETE /api/looks/Evening")).toBe(true));
});

test("a look's change-check status shows, with an Accept that takes a new snapshot", async () => {
  const calls = stubFetch({ "POST /api/devices/desk/accept/Evening": { look: looks[0], status: "ok", notes: [], accepted: [] } });
  vi.stubGlobal("confirm", vi.fn(() => true));
  const onChanged = vi.fn();
  const notify = vi.fn();
  const checks = [
    { look: "Evening", status: "review" as const, notes: ["'Comet' changed: Tail (ix) is gone"] },
    { look: "Loose", status: "ok" as const, notes: [] },
  ];
  render(<Looks deviceId="desk" looks={looks} checks={checks} onChanged={onChanged} onApplied={() => {}} notify={notify} />);
  const badge = screen.getByText("review");
  expect(badge).toHaveAttribute("title", "'Comet' changed: Tail (ix) is gone");
  expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(1); // not for ok looks
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Tail (ix) is gone"));
  expect(calls.map((c) => c.key)).toContain("POST /api/devices/desk/accept/Evening");
  expect(notify).toHaveBeenCalledWith("Accepted “Evening” (now ok)");
});

test("an unavailable look can't be accepted", () => {
  const checks = [{ look: "Evening", status: "unavailable" as const, notes: ["effect 'Comet' isn't on this device"] }];
  render(<Looks deviceId="desk" looks={looks} checks={checks} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
  expect(screen.getByText("unavailable")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
});
