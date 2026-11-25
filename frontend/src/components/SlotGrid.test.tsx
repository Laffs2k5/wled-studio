// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PushResult } from "../types";
import { cellState, gridProblem, SlotGrid } from "./SlotGrid";

afterEach(() => vi.unstubAllGlobals());

const GRID = { rows: 2, cols: 2, first: 40, row_step: 5, col_step: 1, name: "G{row}-{col} {name}" };
const cells = (names: Record<number, string>) => [40, 41, 45, 46].map((pid, i) => ({
  row: Math.floor(i / 2) + 1, col: (i % 2) + 1, preset_id: pid, kind: names[pid] ? "look" : null,
  name: names[pid] ?? null, base: names[pid]?.replace(/^G\d-\d /, "") ?? null, notes: [] as string[],
}));

function stub(initial: object, sharedId = false) {
  const calls: string[] = [];
  let state = initial as { grid: object | null; cells: object[] };
  let shared = sharedId;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(`${key} ${init?.body ?? ""}`);
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (key === "GET /api/slots/grids") return reply(state.grid
      ? { current: "grid-1", grids: [{ ...state, id: "grid-1", name: "Remote A" }] }
      : { current: null, grids: [] });
    if (key === "GET /api/slots") return reply(state);
    if (key === "GET /api/looks") return reply([
      { name: "Fire", preset_id: 3 }, { name: "G1-1 Calm", preset_id: 40 },
      ...(shared ? [{ name: "Extra", preset_id: 40 }] : []),
    ]);
    if (key === "GET /api/playlists") return reply([{ name: "Evening" }]);
    if (key === "PUT /api/slots/grid") { state = { grid: JSON.parse(String(init!.body)), cells: cells({}) }; return reply(state); }
    if (key === "POST /api/slots/grids") {
      state = { grid: JSON.parse(String(init!.body)).grid, cells: cells({}) };
      return reply({ ...state, id: "grid-1", name: JSON.parse(String(init!.body)).name });
    }
    if (key.startsWith("PUT /api/slots/41")) return reply({ grid: GRID, cells: cells({ 40: "G1-1 Calm", 41: "Fire" }), filled: "Fire", freed: [] });
    if (key.startsWith("DELETE /api/slots/40")) return reply({ grid: GRID, cells: cells({}), freed: ["G1-1 Calm"] });
    if (key === "DELETE /api/slots/grid") { state = { grid: null, cells: [] }; return reply(state); }
    if (key === "DELETE /api/slots/grids/grid-1") { state = { grid: null, cells: [] }; return reply({ current: null, grids: [] }); }
    if (key === "PUT /api/looks/Extra/preset-id") { shared = false; return reply({ look: { name: "Extra" }, shared_with: [] }); }
    if (key === "POST /api/devices/desk/push") {
      const n = calls.filter((c) => c.startsWith("POST /api/devices/desk/push")).length;
      const report: object[] = [{ look: "G1-1 Calm", preset_id: 40, status: "ok", notes: [], written: true, changed: false, on_device: "G1-1 Calm" }];
      if (n > 1) report.push({ look: "G1-2 Fire", preset_id: 41, status: "ok", notes: [], written: true, changed: true, on_device: null });
      return reply({ done: false, drift: false, changed_ids: n > 1 ? ["41"] : [], backup: null, reason: "dry run", report,
        duplicates: shared ? [{ preset_id: 40, looks: ["G1-1 Calm", "Extra"], playlists: [] }] : [] });
    }
    return new Response(JSON.stringify({ detail: "no" }), { status: 404 });
  }));
  return calls;
}

test("without a grid, it asks for its shape in plain words and shows the ids it gives", async () => {
  const calls = stub({ grid: null, cells: [] });
  render(<SlotGrid notify={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Banks (rows)"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Buttons per bank (columns)"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Preset id of bank 1, button 1"), { target: { value: "111" } });
  fireEvent.change(screen.getByLabelText("Each next bank starts N ids later"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Each next button is N ids later"), { target: { value: "1" } });
  const mini = screen.getByRole("table", { name: "Preset ids of the grid" });
  expect(within(mini).getByRole("row", { name: "Bank 1 111 112 113" })).toBeInTheDocument();
  expect(within(mini).getByRole("row", { name: "Bank 2 121 122 123" })).toBeInTheDocument();
  expect(screen.queryByText(/first \+ \(r − 1\)/)).toBeNull();                // no formula
  fireEvent.change(screen.getByLabelText("Name pattern"), { target: { value: "G{row}-{col} {name}" } });   // under Advanced
  expect(screen.getByText(/G2-3 Fire/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Save the grid"));
  await waitFor(() => expect(calls.some((c) => c.startsWith("POST /api/slots/grids") && c.includes('"rows":2'))).toBe(true));
  expect(await screen.findByLabelText("Slot grid")).toBeInTheDocument();
});

test("a grid past 250, or with shared ids, can't be saved, and says why", async () => {
  const calls = stub({ grid: null, cells: [] });
  render(<SlotGrid notify={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Preset id of bank 1, button 1"), { target: { value: "240" } });
  expect(screen.getByRole("alert")).toHaveTextContent("The last button would be preset 263, but WLED's presets end at 250.");
  expect(screen.getByText("Save the grid")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Preset id of bank 1, button 1"), { target: { value: "101" } });
  fireEvent.change(screen.getByLabelText("Each next bank starts N ids later"), { target: { value: "2" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Two buttons would share preset 103: make each next bank start at least 4 ids later.");
  fireEvent.change(screen.getByLabelText("Each next bank starts N ids later"), { target: { value: "" } });
  expect(screen.getByRole("alert")).toHaveTextContent("The step between banks must be a whole number from 1 to 100.");
  fireEvent.change(screen.getByLabelText("Each next bank starts N ids later"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Name pattern"), { target: { value: "R{row}·{col}" } });
  expect(screen.getByRole("alert")).toHaveTextContent("must contain {name}");
  fireEvent.change(screen.getByLabelText("Name pattern"), { target: { value: "R{row}·{col} {name}" } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Save the grid")).toBeEnabled();
  expect(calls.some((c) => c.startsWith("PUT"))).toBe(false);
});

test("the miniature shortens a tall grid", async () => {
  stub({ grid: null, cells: [] });
  render(<SlotGrid notify={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Banks (rows)"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("Preset id of bank 1, button 1"), { target: { value: "1" } });
  expect(screen.getByText("14 more banks, up to Bank 20: 191–194")).toBeInTheDocument();
  expect(gridProblem({ rows: 20, cols: 4, first: 1, row_step: 10, col_step: 1, name: "R{row}·{col} {name}" })).toBeNull();
  expect(gridProblem({ rows: 2, cols: 2, first: 1, row_step: 10, col_step: 1, name: `{name} ${"x".repeat(40)}` })).toMatch(/6 to 40 characters/);
});

test("shows what sits where, and fills and empties slots", async () => {
  const calls = stub({ grid: GRID, cells: cells({ 40: "G1-1 Calm" }) });
  const notify = vi.fn();
  render(<SlotGrid notify={notify} />);
  expect(await screen.findByLabelText("Slot 1·1, preset 40: G1-1 Calm")).toHaveTextContent("Calm");
  fireEvent.click(screen.getByLabelText("Slot 1·2, preset 41: empty"));
  const panel = screen.getByLabelText("The picked slot");
  expect(panel).toHaveTextContent("Slots reference the saved item; no renamed duplicate is created");
  fireEvent.click(within(screen.getByLabelText("Library")).getByRole("button", { name: "Fire" }));
  fireEvent.click(screen.getByRole("button", { name: "Move it here" }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("Moved “Fire” to preset 41 (in the library; write presets to put it on the device)"));
  expect(calls.find((c) => c.startsWith("PUT /api/slots/41"))).toContain('{"look":"Fire","mode":"move"}');
  fireEvent.click(screen.getByLabelText("Slot 1·1, preset 40: G1-1 Calm"));
  fireEvent.click(screen.getByText("Empty the slot"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining("G1-1 Calm left the slot")));
});

test("the grid uses the Presets view's device plan and reports a change after filling", async () => {
  const calls = stub({ grid: GRID, cells: cells({ 40: "G1-1 Calm" }) });
  const onChanged = vi.fn();
  const plan: PushResult = { done: false, drift: false, changed_ids: [], backup: null, reason: "dry run",
    report: [{ look: "G1-1 Calm", preset_id: 40, status: "ok", notes: [], written: true, changed: false,
      on_device: "G1-1 Calm" }] };
  render(<SlotGrid notify={() => {}} deviceId="desk" deviceName="Desk" plan={plan} onChanged={onChanged} />);
  expect(await screen.findByLabelText("Slot 1·1, preset 40: G1-1 Calm (on device)")).toBeInTheDocument();
  // dragged from the library onto a slot
  const fire = within(screen.getByLabelText("Library")).getByRole("button", { name: "Fire" }).closest("li")!;
  const data = new Map<string, string>();
  const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "" };
  fireEvent.dragStart(fire, { dataTransfer });
  fireEvent.drop(screen.getByLabelText("Slot 1·2, preset 41: empty").closest("td")!, { dataTransfer });
  fireEvent.click(screen.getByRole("button", { name: "Move it here" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls.some((c) => c.startsWith("PUT /api/slots/41"))).toBe(true);
  expect(screen.queryByLabelText("Write to device")).toBeNull();
});

test("a picked slot can be shown on the strip; without a picked slot the library says to pick one", async () => {
  const calls = stub({ grid: GRID, cells: cells({ 40: "G1-1 Calm" }) });
  const notify = vi.fn();
  render(<SlotGrid notify={notify} deviceId="desk" deviceName="Desk" />);
  fireEvent.click(within(await screen.findByLabelText("Library")).getByRole("button", { name: "Fire" }));
  expect(notify).toHaveBeenCalledWith("Click a slot first, then the look to put in it.");
  expect(calls.some((c) => c.startsWith("PUT /api/slots"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /^Slot 1·1, preset 40/ }));
  fireEvent.click(screen.getByText("Show on strip"));
  await waitFor(() => expect(calls.some((c) => c.startsWith("POST /api/devices/desk/apply/G1-1%20Calm"))).toBe(true));
});

test("cellState: each slot against the device's dry run", () => {
  const cell = { row: 1, col: 1, preset_id: 40, kind: "look" as const, name: "A", base: "A", notes: [] };
  const plan = (r: object, extra: object = {}) => ({ done: false, drift: false, changed_ids: [], backup: null, reason: null,
    report: [{ look: "A", preset_id: 40, status: "ok", notes: [], ...r }], ...extra }) as never;
  expect(cellState(cell, null)).toBeNull();
  expect(cellState({ ...cell, name: null }, plan({}))).toBeNull();
  expect(cellState(cell, plan({ look: "B" }))!.text).toBe("not for this device");
  expect(cellState(cell, plan({ written: true, changed: false }))!.text).toBe("on device");
  expect(cellState(cell, plan({ written: true, changed: true, on_device: null }))!.text).toBe("not written");
  expect(cellState(cell, plan({ written: true, changed: true, on_device: "Old" }))!.text).toBe("differs");
  expect(cellState(cell, plan({ status: "unavailable", written: false }))!.text).toBe("can't show here");
  expect(cellState(cell, plan({ status: "review", written: false }))!.text).toBe("effect changed");
  expect(cellState(cell, plan({ written: true }, { duplicates: [{ preset_id: 40, looks: ["A", "B"], playlists: [] }] }))!.text).toBe("shared id");
});

test("shared ids are visible on the cell and library, with direct fixes", async () => {
  const calls = stub({ grid: GRID, cells: cells({ 40: "G1-1 Calm" }) }, true);
  const open = vi.fn();
  const plan: PushResult = { done: false, drift: false, changed_ids: ["40"], backup: null, reason: "dry run",
    report: [{ look: "G1-1 Calm", preset_id: 40, status: "ok", notes: [], written: true, changed: true, on_device: null }],
    duplicates: [{ preset_id: 40, looks: ["G1-1 Calm", "Extra"], playlists: [] }] };
  const view = render(<SlotGrid notify={() => {}} deviceId="desk" deviceName="Desk" onOpenLook={open} plan={plan} />);
  const cell = await screen.findByLabelText(/Slot 1·1, preset 40: G1-1 Calm \(shared id\)/, undefined, { timeout: 2000 });
  expect(cell).toHaveClass("shared-id");
  fireEvent.click(cell);
  const warning = screen.getByLabelText("Shared preset id");
  expect(warning).toHaveTextContent("Only one can be on the device");
  fireEvent.click(within(warning).getByRole("button", { name: "Open “Extra”" }));
  expect(open).toHaveBeenCalledWith("Extra");
  fireEvent.click(within(warning).getByRole("button", { name: "Remove the id from “Extra”" }));
  await waitFor(() => expect(calls.some((c) => c.startsWith("PUT /api/looks/Extra/preset-id"))).toBe(true));
  expect(calls.find((c) => c.startsWith("PUT /api/looks/Extra/preset-id"))).toContain('{"preset_id":null}');
  view.rerender(<SlotGrid notify={() => {}} deviceId="desk" deviceName="Desk" onOpenLook={open} plan={null} />);
  expect(screen.queryByLabelText("Shared preset id")).toBeNull();
});

test("removing the grid is explained and confirmed in grid settings", async () => {
  const calls = stub({ grid: GRID, cells: cells({}) });
  render(<SlotGrid notify={() => {}} />);
  await screen.findByLabelText("Slot grid");
  fireEvent.click(screen.getByText("Grid settings"));
  expect(screen.getByText(/independent; preset ids remain global/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Remove the grid"));
  expect(screen.getByLabelText("Confirm removing the grid")).toHaveTextContent(
    "The looks keep their primary preset ids; only this layout and its \"also use\" assignments are forgotten.");
  expect(calls.some((c) => c.startsWith("DELETE /api/slots/grids/grid-1"))).toBe(false);
  fireEvent.click(screen.getByText("Yes, remove the grid"));
  await waitFor(() => expect(calls.some((c) => c.startsWith("DELETE /api/slots/grids/grid-1"))).toBe(true));
  expect(await screen.findByLabelText("Banks (rows)")).toBeInTheDocument();
});
