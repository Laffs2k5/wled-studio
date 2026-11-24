// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { effects, type GitState } from "../api";

const STATUS: Record<string, string> = { M: "changed", A: "added", D: "deleted", R: "renamed", "??": "new" };

/** An effect folder that is a git clone: its changes, committing them, pushing to GitHub. */
export function GitPanel({ folder, version, notify }: {
  folder: string;
  version: number;              // bumped by the editor after a save, to refresh
  notify: (msg: string, error?: boolean) => void;
}) {
  const [st, setSt] = useState<GitState | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => effects.git(folder).then(setSt).catch(() => setSt(null)), [folder]);
  useEffect(() => { setDiff(null); refresh(); }, [refresh, version]);

  if (!st || !st.repo) return null;
  const changes = st.changes ?? [];
  const ahead = st.ahead ?? 0;

  async function run(what: string, f: () => Promise<GitState>, done: (s: GitState) => string) {
    setBusy(what);
    try {
      const s = await f();
      setSt(s);
      setDiff(null);
      notify(done(s));
    } catch (e) {
      notify((e as Error).message, true);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="git-panel" aria-label="Version control">
      <p className="small">
        <strong>{folder}</strong> is a git clone{st.remote ? <> of {st.remote}</> : null}, on {st.branch ?? "no branch"}.{" "}
        {changes.length === 0 ? "No changes." : `${changes.length} ${changes.length === 1 ? "change" : "changes"}.`}{" "}
        {ahead > 0 && <>{ahead} {ahead === 1 ? "commit" : "commits"} not pushed. </>}
        {st.last && <span className="muted">Last: {st.last.subject} ({st.last.sha})</span>}
      </p>
      {changes.length > 0 && (
        <ul className="small git-changes">
          {changes.map((c) => <li key={c.path}><span className="muted">{STATUS[c.status] ?? c.status}</span> {c.path}</li>)}
        </ul>
      )}
      <div className="row">
        {changes.length > 0 && (
          <button onClick={() => diff === null
            ? effects.gitDiff(folder).then((d) => setDiff(d.diff + (d.new_files.length ? `\nNew files: ${d.new_files.join(", ")}\n` : "")))
              .catch((e) => notify(e.message, true))
            : setDiff(null)}>{diff === null ? "Show changes" : "Hide changes"}</button>
        )}
        {st.can_commit && changes.length > 0 && (
          <form className="row" onSubmit={(e) => {
            e.preventDefault();
            run("commit", () => effects.commit(folder, message.trim()), () => { setMessage(""); return "Committed"; });
          }}>
            <input value={message} maxLength={500} required placeholder="What changed" aria-label="Commit message"
              onChange={(e) => setMessage(e.target.value)} />
            <button disabled={busy !== null || !message.trim()}>{busy === "commit" ? "Committing…" : "Commit"}</button>
          </form>
        )}
        {st.can_push && (
          <button className="primary" disabled={busy !== null || ahead === 0 || changes.length > 0}
            title={changes.length > 0 ? "Commit your changes first" : ahead === 0 ? "Nothing to push" : `Push to ${st.remote}`}
            onClick={() => run("push", () => effects.push(folder), () => `Pushed to ${st.remote}`)}>
            {busy === "push" ? "Pushing…" : "Push"}
          </button>
        )}
        {st.can_commit && (
          <button disabled={busy !== null || changes.length > 0} title="Take new commits from the remote"
            onClick={() => run("pull", () => effects.pull(folder), (s) => `Up to date: ${s.last?.subject ?? ""}`)}>
            {busy === "pull" ? "Pulling…" : "Pull"}
          </button>
        )}
      </div>
      {!st.can_commit && <p className="muted small">Committing is off here (WLEDSTUDIO_EFFECTS_GIT).</p>}
      {st.can_commit && !st.can_push && <p className="muted small">Pushing needs a key (WLEDSTUDIO_EFFECTS_GIT_KEY) and a GitHub remote.</p>}
      {diff !== null && <pre className="git-diff small">{diff || "(no changes to tracked files)"}</pre>}
    </div>
  );
}
