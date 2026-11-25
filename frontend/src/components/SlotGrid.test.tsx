// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { gridProblem, SlotGrid } from "./SlotGrid";

afterEach(() => vi.unstubAllGlobals());

const GRID = { rows: 2, cols: 2, first: 40, row_step: 5, col_step: 1, name: "G{row}-{col} {name}" };
const cells = (names: Record<number, string>) => [40, 41, 45, 46].map((pid, i) => ({
  row: Math.floor(i / 2) + 1, col: (i % 2) + 1, preset_id: pid, kind: names[pid] ? "look" : null,
  name: names[pid] ?? null, base: names[pid]?.replace(/^G\d-\d /, "") ?? null, notes: [] as string[],
}));

function stub(initial: object) {
  const calls: string[] = [];
  let state = initial;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(`${key} ${init?.body ?? ""}`);
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (key === "GET /api/slots") return reply(state);
    if (key === "GET /api/looks") return reply([{ name: "Fire" }, { name: "G1-1 Calm" }]);
    if (key === "GET /api/playlists") return reply([{ name: "Evening" }]);
    if (key === "PUT /api/slots/grid") { state = { grid: JSON.parse(String(init!.body)), cells: cells({}) }; return reply(state); }
    if (key === "PUT /api/slots/41") return reply({ grid: GRID, cells: cells({ 40: "G1-1 Calm", 41: "G1-2 Fire" }), filled: "G1-2 Fire", freed: [] });
    if (key === "DELETE /api/slots/40") return reply({ grid: GRID, cells: cells({}), freed: ["G1-1 Calm"] });
    if (key === "POST /api/devices/desk/push") {
      const n = calls.filter((c) => c.startsWith("POST /api/devices/desk/push")).length;
      return reply({ done: false, drift: false, changed_ids: n > 1 ? ["41"] : [], backup: null, reason: "dry run", report: [] });
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
  await waitFor(() => expect(calls.some((c) => c.startsWith("PUT /api/slots/grid") && c.includes('"rows":2'))).toBe(true));
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
  fireEvent.change(screen.getByLabelText("Look or playlist to put here"), { target: { value: "l:Fire" } });
  fireEvent.click(screen.getByText("Put here"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("Put “G1-2 Fire” in slot 1·2 (in the library; write presets to put it on the device)"));
  expect(calls.find((c) => c.startsWith("PUT /api/slots/41"))).toContain('{"look":"Fire"}');
  fireEvent.click(screen.getByLabelText("Slot 1·1, preset 40: G1-1 Calm"));
  fireEvent.click(screen.getByText("Empty the slot"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining("G1-1 Calm left the slot")));
});

test("the write bar: the header's device checked on open and again after a slot is filled", async () => {
  const calls = stub({ grid: GRID, cells: cells({ 40: "G1-1 Calm" }) });
  render(<SlotGrid notify={() => {}} deviceId="desk" deviceName="Desk" />);
  expect(await screen.findByText("Desk is up to date", undefined, { timeout: 2000 })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Slot 1·2, preset 41: empty"));
  fireEvent.change(screen.getByLabelText("Look or playlist to put here"), { target: { value: "l:Fire" } });
  fireEvent.click(screen.getByText("Put here"));
  expect(await screen.findByText("Desk: 1 preset differs from the library", undefined, { timeout: 2000 })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review and write" })).toBeInTheDocument();
  expect(calls.filter((c) => c.startsWith("POST /api/devices/desk/push")).every((c) => c.includes('"dry_run":true'))).toBe(true);
});
