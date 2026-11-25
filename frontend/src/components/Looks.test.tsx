// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { importText, Looks } from "./Looks";

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

/** Opens a look's ⋯ menu and picks an item. */
function menu(look: string, item: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: `More for ${look}` }));
  return within(screen.getByRole("menu", { name: `Actions for ${look}` })).getByRole("menuitem", { name: item });
}

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

test("import calls the API, refreshes, and leaves its result under the button", async () => {
  stubFetch({ "POST /api/devices/desk/import": { imported: ["A"], kept_existing: ["B", "C"], imported_playlists: [], skipped_presets: [] } });
  const onChanged = vi.fn();
  const notify = vi.fn();
  render(<Looks deviceId="desk" looks={[]} onChanged={onChanged} onApplied={() => {}} notify={notify} />);
  fireEvent.click(screen.getByText("Import from device"));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Import result")).toHaveTextContent(
    "Imported 1 new look from desk into the library. 2 looks already in the library were left as they are.");
  expect(notify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByLabelText("Import result")).toBeNull();
  expect(screen.queryByText("Save current")).toBeNull();              // saving is under the live controls now
});

test("a failed import says so where the import was", async () => {
  stubFetch({});
  render(<Looks deviceId="desk" looks={[]} onChanged={() => {}} onApplied={() => {}} notify={() => {}} />);
  fireEvent.click(screen.getByText("Import from device"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't import from desk: no route");
});

test("the import's words: playlists, nothing new, presets not taken", () => {
  expect(importText({ imported: [], kept_existing: ["A"], imported_playlists: ["P"], skipped_presets: ["9"] }, "Desk")).toBe(
    "Imported 1 playlist from Desk into the library. 1 look already in the library was left as it is. "
    + "Left out: preset 9 (playlists already in the library, or not readable as a look).");
  expect(importText({ imported: [], kept_existing: [] }, "Desk")).toBe("Nothing new to import from Desk.");
});

test("a look's preset id is changed on its row, with a warning when it's taken", async () => {
  const calls = stubFetch({ "PUT /api/looks/Loose/preset-id": { look: { name: "Loose", preset_id: 3, segments: [] }, shared_with: ["Evening"] } });
  const onChanged = vi.fn();
  const notify = vi.fn();
  render(<Looks deviceId="desk" looks={looks} onChanged={onChanged} onApplied={() => {}} notify={notify} />);
  fireEvent.click(screen.getByRole("button", { name: "Preset id of Loose: no preset id" }));
  const field = screen.getByLabelText("New preset id for Loose");
  expect(screen.getByText("No preset id: the look stays in the library only.")).toBeInTheDocument();
  fireEvent.change(field, { target: { value: "0" } });
  expect(screen.getByText(/whole number from 1 to 250/)).toBeInTheDocument();
  fireEvent.change(field, { target: { value: "3" } });
  expect(screen.getByText(/^Preset 3 is used by “Evening”: saving gives two looks the same id/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(JSON.parse(calls.find((c) => c.key === "PUT /api/looks/Loose/preset-id")!.body!)).toEqual({ preset_id: 3 });
  expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^“Loose” now has preset 3 \(in the library; .*also used by Evening/), true);
  expect(screen.queryByLabelText("New preset id for Loose")).toBeNull();
});

test("a preset id cleared on the row; Escape cancels", async () => {
  const calls = stubFetch({ "PUT /api/looks/Evening/preset-id": { look: { name: "Evening", segments: [] }, shared_with: [] } });
  const notify = vi.fn();
  render(<Looks deviceId="desk" looks={looks} onChanged={() => {}} onApplied={() => {}} notify={notify} />);
  fireEvent.click(screen.getByRole("button", { name: "Preset id of Evening: preset 3" }));
  fireEvent.keyDown(screen.getByLabelText("New preset id for Evening"), { key: "Escape" });
  expect(screen.queryByLabelText("New preset id for Evening")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preset id of Evening: preset 3" }));
  fireEvent.change(screen.getByLabelText("New preset id for Evening"), { target: { value: "" } });
  fireEvent.keyDown(screen.getByLabelText("New preset id for Evening"), { key: "Enter" });
  await waitFor(() => expect(notify).toHaveBeenCalledWith(
    "“Evening” has no preset id now (in the library; write presets to put it on the device)", false));
  expect(JSON.parse(calls.find((c) => c.key === "PUT /api/looks/Evening/preset-id")!.body!)).toEqual({ preset_id: null });
});

test("a refused preset id keeps the field open", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "no such look" }), { status: 404 })));
  const notify = vi.fn();
  render(<Looks deviceId="desk" looks={looks} onChanged={() => {}} onApplied={() => {}} notify={notify} />);
  fireEvent.click(screen.getByRole("button", { name: "Preset id of Evening: preset 3" }));
  fireEvent.change(screen.getByLabelText("New preset id for Evening"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("no such look", true));
  expect(screen.getByLabelText("New preset id for Evening")).toHaveValue("4");
});

test("show a look live; delete asks first", async () => {
  const calls = stubFetch({ "POST /api/devices/desk/apply/": { status: "ok", notes: [] }, "DELETE /api/looks/": null });
  const onApplied = vi.fn();
  vi.stubGlobal("confirm", vi.fn(() => true));
  render(<Looks deviceId="desk" looks={looks} onChanged={() => {}} onApplied={onApplied} notify={() => {}} />);
  fireEvent.click(screen.getAllByText("Show on strip")[0]);
  await waitFor(() => expect(onApplied).toHaveBeenCalled());
  fireEvent.click(menu("Evening", "Delete…"));
  await waitFor(() => expect(calls.some((c) => c.key === "DELETE /api/looks/Evening")).toBe(true));
});

test("a look whose effect changed: said in plain words, and \"Looks right: keep\" confirms in the page first", async () => {
  const calls = stubFetch({ "POST /api/devices/desk/accept/Evening": { look: looks[0], status: "ok", notes: [], accepted: [] } });
  const onChanged = vi.fn();
  const notify = vi.fn();
  const raw = "'Comet' changed: Tail (ix) is gone; o1 relabelled: Twin -> Reverse; sx relabelled: Rate -> Speed";
  const checks = [
    { look: "Evening", status: "review" as const, notes: [raw] },
    { look: "Loose", status: "ok" as const, notes: [] },
  ];
  render(<Looks deviceId="desk" looks={looks} checks={checks} onChanged={onChanged} onApplied={() => {}} notify={notify} />);
  const plain = "The effect “Comet” on desk has different controls than when this look was saved "
    + "(1 slider removed, 1 slider renamed, 1 option renamed). The look may not look the same.";
  expect(screen.getByText("effect changed")).toHaveAttribute("title", plain);
  expect(screen.queryByText("review")).toBeNull();
  expect(screen.getAllByRole("button", { name: "Looks right: keep" })).toHaveLength(1); // not for ok looks
  fireEvent.click(screen.getByRole("button", { name: "Looks right: keep" }));
  const ask = screen.getByRole("group", { name: "Keep Evening as it looks on desk?" });
  expect(ask).toHaveTextContent("Use desk's version of “Comet” as the reference for “Evening”? Other devices with the old version will then show “effect changed”.");
  expect(ask).toHaveTextContent(raw);                                         // behind Details
  expect(calls.some((c) => c.key.startsWith("POST"))).toBe(false);             // nothing yet
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group", { name: /Keep Evening/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Looks right: keep" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep this version" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(calls.map((c) => c.key)).toContain("POST /api/devices/desk/accept/Evening");
  expect(notify).toHaveBeenCalledWith("Kept desk's version of “Comet” for “Evening” (in the library)");
});

test("a look whose effect the device lacks: not on this device, can't be accepted, shown or edited", () => {
  const checks = [{ look: "Evening", status: "unavailable" as const, notes: ["effect 'Comet' isn't on this device"] }];
  render(<Looks deviceId="desk" looks={looks} checks={checks} onChanged={() => {}} onApplied={() => {}} notify={() => {}}
    onEdit={() => {}} />);
  const why = "Uses effect “Comet”, which desk does not have.";
  expect(screen.getByText("not on this device")).toHaveAttribute("title", why);
  expect(screen.queryByText("unavailable")).toBeNull();
  expect(screen.queryByRole("button", { name: "Looks right: keep" })).toBeNull();
  const [show, other] = screen.getAllByRole("button", { name: "Show on strip" });
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
  expect(screen.getByTitle("In Mix")).toHaveTextContent("in 1 playlist");
  fireEvent.click(menu("Evening", "Rename…"));
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
    expect(menu("Fire", "Move up")).toBeDisabled();                           // first in its folder
    fireEvent.click(menu("Rain", "Move up"));                                  // Rain swaps with Fire, not Party
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
    expect(screen.getByText("left off Desk")).toBeInTheDocument();
    expect(menu("Rain", "On this device through a playlist")).toBeDisabled();
    fireEvent.click(menu("Fire", "Put on this device"));
    await waitFor(() => expect(calls.find((c) => c.key === "POST /api/devices/desk/set/add")?.body).toEqual({ looks: ["Fire"], playlists: [] }));
    fireEvent.click(menu("Calm", "Remove from this device"));
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

test("a calm row: the facts in words, Show on strip and Edit, and the rest in a ⋯ menu that closes", async () => {
  const lib = [{ name: "Loud", mic: true, segments: [], folder: "Party" }, { name: "Quiet", mic: false, segments: [] }];
  const calls = stubFetch({ "POST /api/library/looks/folder": { moved: ["Quiet"] } });
  const onChanged = vi.fn();
  render(<Looks deviceId="desk" looks={lib} onChanged={onChanged} onApplied={() => {}} notify={() => {}} onEdit={() => {}} />);
  expect(screen.getByText("♪ mic")).toBeInTheDocument();                       // mic on: said
  expect(screen.queryByText("–")).toBeNull();                                  // mic off: nothing
  expect(screen.queryByText("♪")).toBeNull();
  const row = screen.getByText("Quiet").closest("li")!;
  expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["no preset id", "Show on strip", "Edit", "⋯"]);
  fireEvent.click(screen.getByRole("button", { name: "More for Quiet" }));
  expect(screen.getByRole("menu", { name: "Actions for Quiet" })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "More for Quiet" }));
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(menu("Quiet", "Move to folder…"));
  fireEvent.change(screen.getByLabelText("Folder for Quiet"), { target: { value: "Party" } });
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(JSON.parse(calls.find((c) => c.key === "POST /api/library/looks/folder")!.body!)).toEqual({ names: ["Quiet"], folder: "Party" });
  expect(screen.queryByRole("menu")).toBeNull();
});
