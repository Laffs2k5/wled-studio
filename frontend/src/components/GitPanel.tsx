// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { effects, type GitState } from "../api";

const STATUS: Record<string, string> = { M: "changed", A: "added", D: "deleted", R: "renamed", "??": "new" };
const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;
const commits = (n: number) => `${n} ${n === 1 ? "commit" : "commits"}`;

/** An effect folder that is a git clone, as three steps: its changes, committing them, pushing them to GitHub. */
export function GitPanel({ folder, version, notify }: {
  folder: string;
  version: number;              // bumped by the editor after a save (or a generated file), to refresh
  notify: (msg: string, error?: boolean) => void;
}) {
  const [st, setSt] = useState<GitState | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // the last action's result, until the next one
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => effects.git(folder).then(setSt).catch(() => setSt(null)), [folder]);
  useEffect(() => { setDiff(null); refresh(); }, [refresh, version]);
  useEffect(() => { setResult(null); }, [folder]);

  if (!st || !st.repo) return null;
  const changes = st.changes ?? [];
  const ahead = st.ahead ?? 0;
  const behind = st.behind ?? 0;

  async function run(what: string, f: () => Promise<GitState>, done: (s: GitState) => string) {
    setBusy(what);
    setResult(null);
    try {
      const s = await f();
      setSt(s);
      setDiff(null);
      setResult({ ok: true, text: done(s) });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const pushReason = !st.can_push ? null : changes.length > 0 ? "Commit your changes first." : ahead === 0 ? "Nothing to push: GitHub has every commit." : null;
  const pullReason = changes.length > 0 ? "Commit your changes first." : null;

  return (
    <div className="git-panel" aria-label="Version control">
      <p className="small">
        <strong>{folder}</strong> is a git clone{st.remote ? <> of {st.remote}</> : null}, on {st.branch ?? "no branch"}.{" "}
        {st.last && <span className="muted">Last commit: {st.last.subject} ({st.last.sha})</span>}
      </p>
      <ol className="git-steps">
        <li aria-label="1 Changes">
          <strong>Changes:</strong>{" "}
          {changes.length === 0 ? "none since the last commit." : `${files(changes.length)} (${changes.map((c) => `${c.path} ${STATUS[c.status] ?? c.status}`).join(", ")})`}
          {changes.length > 0 && (
            <button className="small" onClick={() => diff === null
              ? effects.gitDiff(folder).then((d) => setDiff(d.diff + (d.new_files.length ? `\nNew files: ${d.new_files.join(", ")}\n` : "")))
                .catch((e) => notify(e.message, true))
              : setDiff(null)}>{diff === null ? "Show changes" : "Hide changes"}</button>
          )}
          {diff !== null && <pre className="git-diff small">{diff || "(no changes to tracked files)"}</pre>}
        </li>
        <li aria-label="2 Commit">
          <strong>Commit:</strong>{" "}
          {!st.can_commit ? <span className="muted">off here (WLEDSTUDIO_EFFECTS_GIT).</span>
            : changes.length === 0 ? <span className="muted">nothing to commit.</span> : (
              <form className="row" onSubmit={(e) => {
                e.preventDefault();
                run("commit", () => effects.commit(folder, message.trim()), () => {
                  setMessage("");
                  return st.can_push ? "Committed locally. Push to put it on GitHub." : "Committed locally.";
                });
              }}>
                <input value={message} maxLength={500} required placeholder="What changed…" aria-label="Commit message"
                  onChange={(e) => setMessage(e.target.value)} />
                <button disabled={busy !== null || !message.trim()}
                  title="Commits every file listed under Changes">{busy === "commit" ? "Committing…" : changes.length === 1 ? "Commit the 1 file" : `Commit all ${files(changes.length)}`}</button>
              </form>
            )}
        </li>
        <li aria-label="3 Push">
          <strong>Push:</strong>{" "}
          {!st.can_push ? <span className="muted">needs a key (WLEDSTUDIO_EFFECTS_GIT_KEY) and a GitHub remote.</span> : (<>
            {ahead > 0 && <>{commits(ahead)} not on GitHub yet. </>}
            {pushReason ? <span className="muted">{pushReason}</span> : (
              <button className="primary" disabled={busy !== null}
                onClick={() => run("push", () => effects.push(folder), () => `Pushed to ${st.remote}.`)}>
                {busy === "push" ? "Pushing…" : "Push to GitHub"}
              </button>
            )}
          </>)}
        </li>
      </ol>
      {st.can_commit && (
        <p className="row small">
          <button disabled={busy !== null || pullReason !== null}
            onClick={() => run("pull", () => effects.pull(folder), (s) => `Up to date with GitHub. Last commit: ${s.last?.subject ?? ""}.`)}>
            {busy === "pull" ? "Getting…" : "Get new commits from GitHub"}
          </button>
          <span className="muted">{pullReason ?? (behind > 0 ? `${commits(behind)} on GitHub not here yet.` : "Takes commits made elsewhere, with yours on top.")}</span>
        </p>
      )}
      {result && (
        <p className={`small action-result ${result.ok ? "done" : "error"}`} role={result.ok ? "status" : "alert"}>{result.text}</p>
      )}
    </div>
  );
}
