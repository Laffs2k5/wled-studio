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

test("lists looks with their preset ids", () => {
  render(<Looks deviceId="desk" looks={looks} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
  expect(screen.getByText("preset 3")).toBeInTheDocument();
  expect(screen.getByText("no preset id")).toBeInTheDocument();
});

test("a look on walls names them", () => {
  const onWalls = [{ name: "Ends", segments: [{ start: 0, stop: 20, wall: "A" }, { start: 20, stop: 60, wall: "L2" },
    { start: 60, stop: 70, wall: "A" }] }];
  render(<Looks deviceId="desk" looks={onWalls} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
  expect(screen.getByTitle("Follows these walls of the room model")).toHaveTextContent("A · L2");
});

test("import calls the API and refreshes", async () => {
  stubFetch({ "POST /api/devices/desk/import": { imported: ["A"], kept_existing: [], skipped_presets: [] } });
  const onChanged = vi.fn();
  const notify = vi.fn();
  render(<Looks deviceId="desk" looks={[]} onChanged={onChanged} onApplied={() => {}} notify={notify} />);
  fireEvent.click(screen.getByText("Import from device"));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(notify).toHaveBeenCalledWith("Imported 1 preset from desk into the library, kept 0 existing");
  expect(screen.queryByText("Save current")).toBeNull();              // saving is under the live controls now
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

test("a look whose effect the device lacks: not on this device, can't be accepted, shown or edited", () => {
  const checks = [{ look: "Evening", status: "unavailable" as const, notes: ["effect 'Comet' isn't on this device"] }];
  render(<Looks deviceId="desk" looks={looks} checks={checks} onChanged={() => {}} onApplied={() => {}} notify={() => {}}
    onEdit={() => {}} />);
  const why = "Uses effect “Comet”, which desk does not have.";
  expect(screen.getByText("not on this device")).toHaveAttribute("title", why);
  expect(screen.queryByText("unavailable")).toBeNull();
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  const [show, other] = screen.getAllByRole("button", { name: "Show" });
  expect(show).toBeDisabled();
  expect(show).toHaveAttribute("title", why);
  expect(other).toBeEnabled();                                     // "Loose" is fine
  expect(screen.getByRole("button", { name: "Edit Evening" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Edit Evening" })).toHaveAttribute("title", why);
  expect(screen.getByRole("button", { name: "Edit Loose" })).toBeEnabled();
});

test("Edit opens a look in the editor", () => {
  const onEdit = vi.fn();
  render(<Looks deviceId="desk" looks={looks} onChanged={() => {}} onApplied={() => {}} notify={() => {}} onEdit={onEdit} />);
  fireEvent.click(screen.getByLabelText("Edit Evening"));
  expect(onEdit).toHaveBeenCalledWith("Evening");
});

test("rename a look, and see which playlists use it", async () => {
  const calls = stubFetch({ "POST /api/looks/Evening/rename": { name: "Dusk", segments: [] } });
  vi.stubGlobal("prompt", vi.fn(() => "Dusk"));
  const onChanged = vi.fn();
  const notify = vi.fn();
  render(<Looks deviceId="desk" looks={looks} onChanged={onChanged} onApplied={() => {}} notify={notify}
    playlists={[{ name: "Mix", entries: [{ look: "Evening", duration: 100, transition: 7 }], repeat: 0, shuffle: false }]} />);
  expect(screen.getByTitle("In Mix")).toHaveTextContent("▶1");
  fireEvent.click(screen.getByLabelText("Rename Evening"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  const call = calls.find((c) => c.key === "POST /api/looks/Evening/rename")!;
  expect(JSON.parse(call.body!)).toEqual({ to: "Dusk" });
  expect(notify).toHaveBeenCalledWith("Renamed to “Dusk” in the library");
});

describe("folders and order", () => {
  const lib = [
    { name: "Calm", segments: [] }, { name: "Fire", segments: [], folder: "Storms" },
    { name: "Party", segments: [] }, { name: "Rain", segments: [], folder: "Storms" },
  ];
  function stubLib() {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ moved: 1, order: [] }), { status: 200 });
    }));
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());
  const libCalls = (calls: { url: string; body: unknown }[]) => calls.filter((c) => c.url.startsWith("/api/library"));

  test("groups looks by folder, and moves one within its folder", async () => {
    const calls = stubLib();
    const onChanged = vi.fn();
    render(<Looks deviceId="desk" looks={lib} onChanged={onChanged} onApplied={() => {}} notify={() => {}} />);
    expect(screen.getByText(/Not in a folder \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Storms \(2\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Move Fire up")).toBeDisabled();             // first in its folder
    fireEvent.click(screen.getByLabelText("Move Rain up"));                    // Rain swaps with Fire, not Party
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(libCalls(calls)[0]).toEqual({ url: "/api/library/looks/order", body: { names: ["Calm", "Rain", "Party", "Fire"] } });
  });

  test("moves the selected looks to a folder", async () => {
    const calls = stubLib();
    render(<Looks deviceId="desk" looks={lib} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
    fireEvent.click(screen.getByLabelText("Select Party"));
    fireEvent.click(screen.getByLabelText("Select Calm"));
    fireEvent.change(screen.getByLabelText("Move the selected looks to"), { target: { value: "Storms" } });
    fireEvent.click(screen.getByText("Move"));
    await waitFor(() => expect(libCalls(calls).length).toBe(1));
    expect(libCalls(calls)[0]).toEqual({ url: "/api/library/looks/folder", body: { names: ["Calm", "Party"], folder: "Storms" } });
  });

  test("collapses a folder, renames and dissolves it", async () => {
    const calls = stubLib();
    vi.stubGlobal("prompt", () => "Weather");
    vi.stubGlobal("confirm", () => true);
    render(<Looks deviceId="desk" looks={lib} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
    fireEvent.click(screen.getByText(/Storms \(2\)/));
    expect(screen.queryByText("Rain")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Rename folder Storms"));
    await waitFor(() => expect(libCalls(calls).at(-1)).toEqual({ url: "/api/library/folders/rename", body: { from: "Storms", to: "Weather" } }));
    fireEvent.click(screen.getByLabelText("Dissolve folder Storms"));
    await waitFor(() => expect(libCalls(calls).at(-1)).toEqual({ url: "/api/library/folders/rename", body: { from: "Storms", to: null } }));
  });
});

describe("what goes on this device", () => {
  const lib = [{ name: "Calm", segments: [] }, { name: "Fire", segments: [] }, { name: "Rain", segments: [] }];
  const chosenSet = { all: false, looks: ["Calm"], playlists: ["Storm"], brought: ["Storm brings Rain"],
    on_device: { looks: ["Calm", "Rain"], playlists: ["Storm"] } };
  function stubSets(set: object) {
    const calls: { key: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : null });
      const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (key === "GET /api/devices") return reply([{ id: "desk", name: "Desk" }, { id: "test", name: "Test board" }]);
      if (url.startsWith("/api/devices/test/set")) return reply({ ...chosenSet, looks: ["Calm", "Fire"] });
      if (url.startsWith("/api/devices/desk/set")) return reply(set);
      return reply({});
    }));
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());

  test("everything by default, and choosing a set", async () => {
    const calls = stubSets({ all: true, looks: [], playlists: [], brought: [], on_device: { looks: ["Calm", "Fire", "Rain"], playlists: [] } });
    render(<Looks deviceId="desk" looks={lib} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
    expect(await screen.findByText(/Everything in the library goes on Desk/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Choose what goes on it"));
    await waitFor(() => expect(calls.find((c) => c.key === "PUT /api/devices/desk/set")?.body).toEqual(
      { looks: ["Calm", "Fire", "Rain"], playlists: [] }));
  });

  test("with a set: off-device looks are marked, and can be added or taken off", async () => {
    const calls = stubSets(chosenSet);
    render(<Looks deviceId="desk" looks={lib} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
    expect(await screen.findByText(/Desk has its own set: 1 looks, 1 playlists \(Storm brings Rain\)/)).toBeInTheDocument();
    expect(screen.getByText("Fire").closest("li")).toHaveClass("off-device");
    expect(screen.getByText("via playlist")).toBeInTheDocument();            // Rain, brought by Storm
    fireEvent.click(screen.getByLabelText("Add Fire to this device"));
    await waitFor(() => expect(calls.find((c) => c.key === "POST /api/devices/desk/set/add")?.body).toEqual({ looks: ["Fire"], playlists: [] }));
    fireEvent.click(screen.getByLabelText("Take Calm off this device"));
    await waitFor(() => expect(calls.find((c) => c.key === "POST /api/devices/desk/set/remove")?.body).toEqual({ looks: ["Calm"], playlists: [] }));
  });

  test("copies the selected looks to another device", async () => {
    const calls = stubSets(chosenSet);
    const notify = vi.fn();
    render(<Looks deviceId="desk" looks={lib} onChanged={() => {}} onApplied={() => {}} notify={notify} />);
    await screen.findByText(/Desk has its own set/);
    fireEvent.click(screen.getByLabelText("Select Fire"));
    fireEvent.change(screen.getByLabelText("Copy the selected looks to device"), { target: { value: "test" } });
    fireEvent.click(screen.getByText("Copy"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Copied 1 to Test board's set"));
    expect(calls.find((c) => c.key === "POST /api/devices/test/set/add")?.body).toEqual({ looks: ["Fire"], playlists: [] });
  });
});
