// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SaveLook } from "./SaveLook";

afterEach(() => vi.unstubAllGlobals());

const looks = [{ name: "Plain orange", preset_id: 6, segments: [] }, { name: "Warm glow", preset_id: 1, segments: [] }];
const playlists = [{ name: "Evening", preset_id: 2, entries: [], repeat: 0, shuffle: false }];

function stub(fail = false) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    return fail ? new Response(JSON.stringify({ detail: "http://wled.lan: ConnectError" }), { status: 502 })
      : new Response(JSON.stringify({ name: "Night", segments: [] }), { status: 200 });
  }));
  return urls;
}

function open(props: Partial<Parameters<typeof SaveLook>[0]> = {}) {
  const onSaved = vi.fn(), notify = vi.fn();
  render(<SaveLook deviceId="desk" looks={looks} playlists={playlists} notify={notify} onSaved={onSaved} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Save as look…" }));
  return { onSaved, notify };
}

test("a labelled form: name, an optional preset id with the next free one, and what the look keeps", async () => {
  const urls = stub();
  const beforeSave = vi.fn(async () => {});
  const { onSaved, notify } = open({ beforeSave });
  expect(screen.getByRole("form", { name: "Save as look" })).toBeInTheDocument();
  expect(screen.getByLabelText("Preset id (optional; without one the look stays in the library only)")).toHaveValue("");
  expect(screen.getByText(/Next free: 3\./)).toBeInTheDocument();
  expect(screen.getByLabelText(/Whole strip setup: segments and their effects/)).toBeChecked();
  fireEvent.change(screen.getByLabelText("Look name"), { target: { value: "Night" } });
  fireEvent.click(screen.getByRole("button", { name: "Use 3" }));
  fireEvent.click(screen.getByText("Save in the library"));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(beforeSave).toHaveBeenCalled();
  expect(urls).toEqual(["/api/devices/desk/capture/Night?preset_id=3"]);
  expect(notify).toHaveBeenCalledWith(
    "Saved “Night” in the library. Not on the device yet: the bar at the bottom shows what writing would change.");
  // closed; opened again it's empty, so the next look doesn't land on the same preset
  fireEvent.click(screen.getByRole("button", { name: "Save as look…" }));
  expect(screen.getByLabelText("Look name")).toHaveValue("");
  expect(screen.getByLabelText(/^Preset id/)).toHaveValue("");
});

test("effects and colours only: saved without the layout", async () => {
  const urls = stub();
  const { onSaved } = open();
  fireEvent.change(screen.getByLabelText("Look name"), { target: { value: "Colours" } });
  fireEvent.click(screen.getByLabelText(/Effects and colours only: applied to whatever segments the strip has/));
  fireEvent.click(screen.getByText("Save in the library"));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(urls).toEqual(["/api/devices/desk/capture/Colours?layout=false"]);
});

test("warns when the id is taken, the name exists, or the id isn't one", () => {
  stub();
  open();
  fireEvent.change(screen.getByLabelText("Look name"), { target: { value: "Warm glow" } });
  expect(screen.getByText("A look named “Warm glow” exists: saving replaces it.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Preset id/), { target: { value: "6" } });
  expect(screen.getByText(/^Preset 6 is used by “Plain orange”: saving gives two looks the same id/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Preset id/), { target: { value: "2" } });
  expect(screen.getByText(/^Preset 2 is used by playlist “Evening”/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Preset id/), { target: { value: "1" } });   // its own id: no warning
  expect(screen.queryByText(/is used by/)).toBeNull();
  fireEvent.change(screen.getByLabelText(/^Preset id/), { target: { value: "300" } });
  expect(screen.getByText("A preset id is a whole number from 1 to 250.")).toBeInTheDocument();
  expect(screen.getByText("Save in the library")).toBeDisabled();
});

test("a failed save keeps the name and the id", async () => {
  stub(true);
  const { notify, onSaved } = open();
  fireEvent.change(screen.getByLabelText("Look name"), { target: { value: "Night" } });
  fireEvent.change(screen.getByLabelText(/^Preset id/), { target: { value: "7" } });
  fireEvent.click(screen.getByText("Save in the library"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("http://wled.lan: ConnectError", true));
  expect(screen.getByLabelText("Look name")).toHaveValue("Night");
  expect(screen.getByLabelText(/^Preset id/)).toHaveValue("7");
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Cancel"));
  expect(screen.queryByRole("form")).toBeNull();
});
