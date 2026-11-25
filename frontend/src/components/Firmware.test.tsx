// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Firmware } from "./Firmware";

const JID = "a".repeat(32);

function stub(routes: Record<string, () => Response>) {
  const calls: { key: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, body: init?.body as string | undefined });
    const h = routes[key];
    return h ? h() : new Response(JSON.stringify({ detail: `no route ${key}` }), { status: 404 });
  }));
  return calls;
}
const json = (b: unknown, status = 200) => () => new Response(JSON.stringify(b), { status });

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test("explains how to enable the builder", async () => {
  stub({ "GET /api/firmware/status": json({ enabled: false }) });
  render(<Firmware notify={() => {}} />);
  expect(await screen.findByText(/No firmware builder is configured/)).toBeInTheDocument();
});

test("starts a gate build and shows its checks and log", async () => {
  const job = { id: JID, state: "passed", pins: "q.json", target: "board", usermods: ["my_fx"], created: 1700000000,
    report: { passed: true, checks: { stock_matches_verified: true, only_usermod_objects_changed: true, fits_app_slot: true } } };
  const calls = stub({
    "GET /api/firmware/status": json({ enabled: true, status: "ok" }),
    "GET /api/firmware/targets": json([{ pins: "q.json", release: "q", target: "board", verified: ["windows"] },
      { pins: "q.json", release: "q", target: "other", verified: [] }]),
    "GET /api/firmware/usermods": json(["my_fx", "other_fx"]),
    "GET /api/firmware/jobs": json([]),
    "POST /api/firmware/jobs": json({ ...job, state: "queued", report: undefined }, 202),
    [`GET /api/firmware/jobs/${JID}`]: json(job),
    [`GET /api/firmware/jobs/${JID}/log`]: () => new Response("GATE PASSED", { status: 200 }),
  });
  render(<Firmware notify={() => {}} />);
  const build = await screen.findByText("Build");
  expect(build).toBeDisabled();
  fireEvent.click(await screen.findByLabelText("my_fx"));
  fireEvent.click(build);
  expect(await screen.findByText("✓ Only your effect code was added", { exact: false })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("Build log")).toHaveTextContent("GATE PASSED"));
  const post = calls.find((c) => c.key === "POST /api/firmware/jobs")!;
  expect(JSON.parse(post.body!)).toEqual({ pins: "q.json", target: "board", usermods: ["my_fx"] });
});

test("warns about unverified targets", async () => {
  stub({
    "GET /api/firmware/status": json({ enabled: true }),
    "GET /api/firmware/targets": json([{ pins: "q.json", release: "q", target: "other", verified: [] }]),
    "GET /api/firmware/usermods": json([]),
    "GET /api/firmware/jobs": json([]),
  });
  render(<Firmware notify={() => {}} />);
  await waitFor(() => expect(screen.getByText(/no verified result yet/)).toBeInTheDocument());
});

test("checks the library against a passed image before flashing", async () => {
  const job = { id: JID, state: "passed", pins: "q.json", target: "board", usermods: ["my_fx"], created: 1700000000,
    report: { passed: true, checks: { fits_app_slot: true } } };
  const preflight = { job: JID, device: "desk", effects: 220, counts: { ok: 2, review: 1 }, rows: [
    { look: "Calm", status: "ok", notes: [], today: "ok", changes: false },
    { look: "Tail", status: "review", notes: ["'Comet' changed: Tail (ix) is gone"], today: "ok", changes: true },
    { playlist: "Mix", status: "ok", notes: [], today: "ok", changes: false },
  ] };
  const calls = stub({
    "GET /api/firmware/status": json({ enabled: true, status: "ok" }),
    "GET /api/firmware/targets": json([{ pins: "q.json", release: "q", target: "board", verified: ["windows"] }]),
    "GET /api/firmware/usermods": json(["my_fx"]),
    "GET /api/firmware/jobs": json([job]),
    [`GET /api/firmware/jobs/${JID}`]: json(job),
    [`GET /api/firmware/jobs/${JID}/log`]: () => new Response("GATE PASSED", { status: 200 }),
    [`GET /api/firmware/jobs/${JID}/preflight?device=desk`]: json(preflight),
  });
  render(<Firmware notify={() => {}} devices={[{ id: "desk", name: "Desk", host: "h", has_pin: false }]} device="desk" />);
  fireEvent.click(await screen.findByRole("cell", { name: "board · q" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check the library" }));
  expect(await screen.findByText("220 effects in the image. 2 ok, 1 review")).toBeInTheDocument();
  expect(screen.getByText("Tail")).toBeInTheDocument();
  expect(screen.queryByText("Calm")).toBeNull();                   // only what flashing would change
  fireEvent.click(screen.getByLabelText(/Only what/));
  expect(screen.getByText("Calm")).toBeInTheDocument();
  expect(screen.getByText("▶ Mix")).toBeInTheDocument();
  expect(calls.map((c) => c.key)).toContain(`GET /api/firmware/jobs/${JID}/preflight?device=desk`);
});

test("says so when flashing changes nothing", async () => {
  const job = { id: JID, state: "passed", pins: "q.json", target: "board", usermods: ["my_fx"], created: 1700000000, report: { passed: true } };
  stub({
    "GET /api/firmware/status": json({ enabled: true, status: "ok" }),
    "GET /api/firmware/targets": json([]),
    "GET /api/firmware/usermods": json([]),
    "GET /api/firmware/jobs": json([job]),
    [`GET /api/firmware/jobs/${JID}`]: json(job),
    [`GET /api/firmware/jobs/${JID}/log`]: () => new Response("", { status: 200 }),
    [`GET /api/firmware/jobs/${JID}/preflight?device=desk`]: json({ job: JID, device: "desk", effects: 3, counts: {}, rows: [] }),
  });
  render(<Firmware notify={() => {}} devices={[{ id: "desk", name: "Desk", host: "h", has_pin: false }]} device="desk" />);
  fireEvent.click(await screen.findByRole("cell", { name: "board · q" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check the library" }));
  expect(await screen.findByText(/changes nothing for the library/)).toBeInTheDocument();
  expect(screen.getByText("3 effects in the image. Nothing in the library.")).toBeInTheDocument();
});

test("a virtual device gets one line instead of the flash step", async () => {
  const job = { id: JID, state: "passed", pins: "q.json", target: "board", usermods: ["my_fx"], created: 1700000000, report: { passed: true } };
  stub({
    "GET /api/firmware/status": json({ enabled: true, status: "ok" }),
    "GET /api/firmware/targets": json([]),
    "GET /api/firmware/usermods": json([]),
    "GET /api/firmware/jobs": json([job]),
    [`GET /api/firmware/jobs/${JID}`]: json(job),
    [`GET /api/firmware/jobs/${JID}/log`]: () => new Response("", { status: 200 }),
    "GET /api/notices/flash": json({ version: "v1", title: "t", text: "x", remembered: false, accepted: null }),
  });
  const devices = [{ id: "desk", name: "Desk", host: "h", has_pin: false },
    { id: "twin", name: "Twin", host: "t", has_pin: false, virtual: true }];
  const { rerender } = render(<Firmware notify={() => {}} device="twin" devices={devices} />);
  fireEvent.click(await screen.findByRole("cell", { name: "board · q" }));
  expect(await screen.findByText(/Twin is a virtual device: a software copy of WLED for testing/)).toBeInTheDocument();
  expect(screen.queryByText("Plan the flash")).toBeNull();
  expect(screen.queryByText(/Go back to the previous firmware/)).toBeNull();
  // the device is the header's: no picker of its own here
  expect(screen.queryByLabelText("Device to check for")).toBeNull();
  rerender(<Firmware notify={() => {}} device="desk" devices={devices} />);
  expect(await screen.findByText("Plan the flash")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Flash it to Desk/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Before flashing: your looks on Desk with this image/ })).toBeInTheDocument();
  expect(screen.getByText(/Go back to the previous firmware/)).toBeInTheDocument();
});

test("preselects the target that matches the header's device, and remembers a different choice", async () => {
  const targets = [{ pins: "a-16.0.0.json", release: "a-16.0.0", target: "dig-next-2", verified: ["windows"] },
    { pins: "a-16.0.1.json", release: "a-16.0.1", target: "board-one", verified: ["windows"] },
    { pins: "a-16.0.1.json", release: "a-16.0.1", target: "dig-next-2", verified: ["windows"] }];
  stub({
    "GET /api/firmware/status": json({ enabled: true }),
    "GET /api/firmware/targets": json(targets),
    "GET /api/firmware/usermods": json(["my_fx"]),
    "GET /api/firmware/jobs": json([]),
    "GET /api/devices/desk/profile": json({ info: { release: "Dig-Next-2", product: "Dig-Next-2", ver: "16.0.1" } }),
  });
  const devices = [{ id: "desk", name: "Desk", host: "h", has_pin: false }];
  const { unmount } = render(<Firmware notify={() => {}} devices={devices} device="desk" />);
  const select = await screen.findByLabelText("Board and WLED release");
  await waitFor(() => expect(select).toHaveValue("a-16.0.1.json|dig-next-2"));
  expect(screen.getByText("Matches Desk (Dig-Next-2, WLED 16.0.1).")).toBeInTheDocument();
  const labels = [...select.querySelectorAll("option")].map((o) => o.textContent);
  expect(labels).toEqual(["dig-next-2 · a-16.0.0 (same board, other release)", "board-one · a-16.0.1 (different board)",
    "dig-next-2 · a-16.0.1 (matches Desk)"]);
  // another board: an amber line names the one that matches
  fireEvent.change(select, { target: { value: "a-16.0.1.json|board-one" } });
  expect(screen.getByText(/Not Desk's board: it runs Dig-Next-2, WLED 16.0.1. The one that matches is dig-next-2 · a-16.0.1/))
    .toHaveClass("warn");
  fireEvent.click(screen.getByLabelText("my_fx"));
  unmount();
  // the choice and the ticks are remembered
  render(<Firmware notify={() => {}} devices={devices} device="desk" />);
  await waitFor(() => expect(screen.getByLabelText("Board and WLED release")).toHaveValue("a-16.0.1.json|board-one"));
  expect(await screen.findByLabelText("my_fx")).toBeChecked();
  expect(screen.getByText("Your effect folders to include")).toBeInTheDocument();
});

test("a device whose board isn't among the targets: the first, with a line that says so", async () => {
  stub({
    "GET /api/firmware/status": json({ enabled: true }),
    "GET /api/firmware/targets": json([{ pins: "a.json", release: "a-16.0.1", target: "board-one", verified: ["windows"] }]),
    "GET /api/firmware/usermods": json([]),
    "GET /api/firmware/jobs": json([]),
    "GET /api/devices/desk/profile": json({ info: { release: "Fake", product: "FakeDevice", ver: "16.0.1" } }),
  });
  render(<Firmware notify={() => {}} devices={[{ id: "desk", name: "Desk", host: "h", has_pin: false }]} device="desk" />);
  expect(await screen.findByText(/Not Desk's board: it runs Fake, WLED 16.0.1. None of the builder's targets matches it./)).toBeInTheDocument();
  expect(screen.getByLabelText("Board and WLED release")).toHaveValue("a.json|board-one");
});

test("from the Effect studio: its folders ticked, and the matching target over the last choice", async () => {
  localStorage.setItem("wledstudio.firmware.target", JSON.stringify({ desk: "a.json|board-one" }));
  stub({
    "GET /api/firmware/status": json({ enabled: true }),
    "GET /api/firmware/targets": json([{ pins: "a.json", release: "a-16.0.1", target: "board-one", verified: ["windows"] },
      { pins: "a.json", release: "a-16.0.1", target: "dig-next-2", verified: ["windows"] }]),
    "GET /api/firmware/usermods": json(["my_fx", "other_fx"]),
    "GET /api/firmware/jobs": json([]),
    "GET /api/devices/desk/profile": json({ info: { release: "Dig-Next-2", ver: "16.0.1" } }),
  });
  render(<Firmware notify={() => {}} devices={[{ id: "desk", name: "Desk", host: "h", has_pin: false }]} device="desk"
    request={{ folders: ["other_fx"], seq: 1 }} />);
  await waitFor(() => expect(screen.getByLabelText("Board and WLED release")).toHaveValue("a.json|dig-next-2"));
  expect(await screen.findByLabelText("other_fx")).toBeChecked();
  expect(screen.getByLabelText("my_fx")).not.toBeChecked();
});

test("lists firmware builds only, in plain words, and heads the open one with what it is", async () => {
  const now = Date.now() / 1000;
  const passed = { id: JID, kind: "gate", state: "passed", pins: "acme-16.0.1.json", target: "dig-next-2", usermods: ["my_fx"], created: now - 60,
    report: { passed: true, checks: { stock_matches_verified: true } } };
  const failed = { id: "b".repeat(32), kind: "gate", state: "failed", pins: "acme-16.0.1.json", target: "dig-next-2", usermods: ["my_fx"],
    created: now - 120, checks: { stock_matches_verified: true, only_usermod_objects_changed: false }, error: null };
  const running = { id: "c".repeat(32), kind: "gate", state: "running", pins: "acme-16.0.0.json", target: "board", usermods: ["a", "b"], created: now - 10 };
  const preview = { id: "d".repeat(32), kind: "preview", state: "passed", pins: "acme-16.0.1.json", usermods: ["my_fx"], created: now - 5 };
  stub({
    "GET /api/firmware/status": json({ enabled: true }),
    "GET /api/firmware/targets": json([]),
    "GET /api/firmware/usermods": json([]),
    "GET /api/firmware/jobs": json([preview, running, passed, failed]),
    [`GET /api/firmware/jobs/${JID}`]: json(passed),
    [`GET /api/firmware/jobs/${JID}/log`]: () => new Response("", { status: 200 }),
  });
  render(<Firmware notify={() => {}} />);
  const table = await screen.findByRole("table", { name: "Your builds" });
  const rows = [...table.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
  expect(rows).toHaveLength(3);                                    // no preview compile
  expect(rows.map((r) => r.slice(1))).toEqual([
    ["board · acme-16.0.0", "a, b", "running"],
    ["dig-next-2 · acme-16.0.1", "my_fx", "ready to flash"],
    ["dig-next-2 · acme-16.0.1", "my_fx", "failed check 2"],
  ]);
  expect(rows[0][0]).toMatch(/^today \d\d:\d\d$/);
  expect(table.querySelectorAll("tbody tr")[2].querySelector("td:last-child")).toHaveAttribute("title",
    expect.stringMatching(/^Something besides your effect code changed/));
  fireEvent.click(screen.getByText("ready to flash"));
  expect(await screen.findByRole("heading", { name: /^dig-next-2 · acme-16.0.1 with my_fx, built today \d\d:\d\d: ready to flash$/ }))
    .toBeInTheDocument();
  expect(table.querySelectorAll("tbody tr")[1]).toHaveClass("open");
  expect(table.querySelectorAll("tbody tr")[1]).toHaveAttribute("aria-selected", "true");
});

test("the plan's \"See which looks\" checks the library and shows it", async () => {
  const job = { id: JID, kind: "gate", state: "passed", pins: "q.json", target: "board", usermods: ["my_fx"], created: 1700000000,
    report: { passed: true } };
  const calls = stub({
    "GET /api/firmware/status": json({ enabled: true }),
    "GET /api/firmware/targets": json([]),
    "GET /api/firmware/usermods": json([]),
    "GET /api/firmware/jobs": json([job]),
    [`GET /api/firmware/jobs/${JID}`]: json(job),
    [`GET /api/firmware/jobs/${JID}/log`]: () => new Response("", { status: 200 }),
    "GET /api/notices/flash": json({ version: "v1", title: "t", text: "x", remembered: false, accepted: null }),
    [`GET /api/firmware/jobs/${JID}/flash-plan?device=desk`]: json({ job: JID, device: "desk", name: "Desk", image: {}, running: {},
      busy: false, can_flash: true, checks: [{ id: "library", level: "warn", text: "1 of your looks works differently." }] }),
    [`GET /api/firmware/jobs/${JID}/preflight?device=desk`]: json({ job: JID, device: "desk", effects: 3, counts: { unavailable: 1 },
      rows: [{ look: "Calm", status: "unavailable", notes: [], today: "ok", changes: true }] }),
  });
  render(<Firmware notify={() => {}} devices={[{ id: "desk", name: "Desk", host: "h", has_pin: false }]} device="desk" />);
  fireEvent.click(await screen.findByRole("cell", { name: "board · q" }));
  fireEvent.click(await screen.findByText("Plan the flash"));
  fireEvent.click(await screen.findByText("See which looks"));
  expect(await screen.findByText("Calm")).toBeInTheDocument();
  expect(calls.map((c) => c.key)).toContain(`GET /api/firmware/jobs/${JID}/preflight?device=desk`);
});
