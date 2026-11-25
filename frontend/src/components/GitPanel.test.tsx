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

test("three steps: the changes, commit them all, then push to GitHub; each result where it happened", async () => {
  const calls = stub({ changes: [{ status: "M", path: "fx.cpp" }, { status: "??", path: "n.h" }] });
  const notify = vi.fn();
  render(<GitPanel folder="fx" version={0} notify={notify} />);
  expect(await screen.findByLabelText("1 Changes")).toHaveTextContent("Changes: 2 files (fx.cpp changed, n.h new)");
  expect(screen.getByLabelText("3 Push")).toHaveTextContent("Commit your changes first.");
  expect(screen.queryByText("Push to GitHub")).toBeNull();
  expect(screen.getByText("Get new commits from GitHub")).toBeDisabled();
  fireEvent.click(screen.getByText("Show changes"));
  expect(await screen.findByText(/\+new/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Commit message"), { target: { value: "Brighter" } });
  fireEvent.click(screen.getByText("Commit all 2 files"));
  expect(await screen.findByText("Committed locally. Push to put it on GitHub.")).toBeInTheDocument();
  expect(screen.getByLabelText("3 Push")).toHaveTextContent("1 commit not on GitHub yet.");
  expect(screen.getByLabelText("2 Commit")).toHaveTextContent("nothing to commit.");
  expect(JSON.parse(calls.find((c) => c.key === "POST /api/effects/fx/git/commit")!.body!)).toEqual({ message: "Brighter" });
  fireEvent.click(screen.getByText("Push to GitHub"));
  expect(await screen.findByText("Pushed to github.com/someone/effects.")).toBeInTheDocument();
  expect(screen.getByLabelText("3 Push")).toHaveTextContent("Nothing to push: GitHub has every commit.");
  expect(notify).not.toHaveBeenCalled();
});

test("says why it can't commit or push", async () => {
  stub({ changes: [], can_commit: false, can_push: false });
  render(<GitPanel folder="fx" version={0} notify={() => {}} />);
  expect(await screen.findByLabelText("2 Commit")).toHaveTextContent("off here (WLEDSTUDIO_EFFECTS_GIT)");
  expect(screen.getByLabelText("3 Push")).toHaveTextContent("needs a key");
  expect(screen.queryByText("Push to GitHub")).toBeNull();
});

test("a failed push is reported in the panel", async () => {
  stub({ changes: [], ahead: 1, behind: 2 });
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ detail: "the remote changed the same lines" }), { status: 409 });
    return new Response(JSON.stringify({ ...base, changes: [], ahead: 1, behind: 2 }));
  });
  render(<GitPanel folder="fx" version={0} notify={() => {}} />);
  expect(await screen.findByText("2 commits on GitHub not here yet.")).toBeInTheDocument();
  fireEvent.click(await screen.findByText("Push to GitHub"));
  expect(await screen.findByRole("alert")).toHaveTextContent("the remote changed the same lines");
});
