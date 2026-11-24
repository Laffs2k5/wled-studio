// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GitState } from "../api";
import { GitPanel } from "./GitPanel";

afterEach(() => vi.unstubAllGlobals());

const base = {
  repo: true, branch: "main", upstream: "origin/main", ahead: 0, behind: 0, remote: "github.com/someone/effects",
  last: { sha: "abc1234", subject: "seed", when: "2026-11-24T20:00:00+00:00" }, can_commit: true, can_push: true,
};

function stub(state: Record<string, unknown>) {
  const calls: { key: string; body?: string }[] = [];
  let st: GitState = { ...base, ...state };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, body: init?.body as string });
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (key === "GET /api/effects/fx/git") return reply(st);
    if (key === "GET /api/effects/fx/git/diff") return reply({ diff: "-old\n+new\n", truncated: false, new_files: ["n.h"] });
    if (key === "POST /api/effects/fx/git/commit") { st = { ...st, changes: [], ahead: 1, last: { ...base.last, subject: "Brighter" } }; return reply(st); }
    if (key === "POST /api/effects/fx/git/push") { st = { ...st, ahead: 0 }; return reply(st); }
    return reply({ detail: "no" }, 404);
  }));
  return calls;
}

test("nothing for a folder that isn't a clone", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ repo: false }))));
  const { container } = render(<GitPanel folder="fx" version={0} notify={() => {}} />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});

test("shows the changes, commits them, then pushes", async () => {
  const calls = stub({ changes: [{ status: "M", path: "fx.cpp" }, { status: "??", path: "n.h" }] });
  const notify = vi.fn();
  render(<GitPanel folder="fx" version={0} notify={notify} />);
  expect(await screen.findByText(/2 changes/)).toBeInTheDocument();
  expect(screen.getByText("Push")).toBeDisabled();                 // commit first
  fireEvent.click(screen.getByText("Show changes"));
  expect(await screen.findByText(/\+new/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Commit message"), { target: { value: "Brighter" } });
  fireEvent.click(screen.getByText("Commit"));
  expect(await screen.findByText(/1 commit not pushed/)).toBeInTheDocument();
  expect(JSON.parse(calls.find((c) => c.key === "POST /api/effects/fx/git/commit")!.body!)).toEqual({ message: "Brighter" });
  fireEvent.click(screen.getByText("Push"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("Pushed to github.com/someone/effects"));
  expect(screen.getByText("Push")).toBeDisabled();                 // nothing left to push
});

test("says why it can't commit or push", async () => {
  stub({ changes: [], can_commit: false, can_push: false });
  render(<GitPanel folder="fx" version={0} notify={() => {}} />);
  expect(await screen.findByText(/Committing is off here/)).toBeInTheDocument();
  expect(screen.queryByText("Push")).toBeNull();
});

test("a failed push is reported", async () => {
  stub({ changes: [], ahead: 1 });
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ detail: "the remote changed the same lines" }), { status: 409 });
    return new Response(JSON.stringify({ ...base, changes: [], ahead: 1 }));
  });
  const notify = vi.fn();
  render(<GitPanel folder="fx" version={0} notify={notify} />);
  fireEvent.click(await screen.findByText("Push"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("the remote changed the same lines", true));
});
