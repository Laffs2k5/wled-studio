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

afterEach(() => vi.unstubAllGlobals());

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
  fireEvent.click(await screen.findByText("board"));
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
  fireEvent.click(await screen.findByText("board"));
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
  render(<Firmware notify={() => {}} device="twin" devices={[{ id: "desk", name: "Desk", host: "h", has_pin: false },
    { id: "twin", name: "Twin", host: "t", has_pin: false, virtual: true }]} />);
  fireEvent.click(await screen.findByText("board"));
  expect(await screen.findByText(/Twin is a virtual device: a software copy of WLED for testing/)).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Twin · virtual (no LEDs)" })).toBeInTheDocument();
  expect(screen.queryByText("Plan the flash")).toBeNull();
  expect(screen.queryByText(/The way back/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Device to check for"), { target: { value: "desk" } });
  expect(await screen.findByText("Plan the flash")).toBeInTheDocument();
  expect(screen.getByText(/The way back/)).toBeInTheDocument();
});
