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
  expect(await screen.findByText(/Only your usermods' code was added/)).toBeInTheDocument();
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
