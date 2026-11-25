// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useRef } from "react";
import type { FirmwareJob } from "../api";
import { GATE_STEPS, gateLines, gatePhase } from "../gate";
import { elapsed, useElapsed } from "../time";

type Step = "pending" | "running" | "past" | "stopped" | "skipped";
const MARK: Record<Step, string> = { pending: "○", running: "…", past: "●", stopped: "✗", skipped: "○" };
const NOTE: Record<Step, string> = {
  pending: "", running: "running now", past: "built; its result comes when the build ends",
  stopped: "the build stopped here", skipped: "not run",
};

/** A firmware build as a checklist: the gate's four checks, pending from the moment it starts, then
 * ticked or crossed from the report; the time so far; and the log behind a disclosure. */
export function BuildChecks({ job, log }: { job: FirmwareJob; log: string }) {
  const active = job.state === "queued" || job.state === "running";
  const secs = useElapsed(active ? (job.started ?? job.created) : null);
  const lines = job.report?.checks && Object.keys(job.report.checks).length ? gateLines(job.report) : null;
  const pre = useRef<HTMLPreElement>(null);
  const toEnd = () => { if (pre.current) pre.current.scrollTop = pre.current.scrollHeight; };
  useEffect(toEnd, [log]);

  // before the report: where the log says the build is (or stopped)
  const phase = job.state === "queued" ? -1 : gatePhase(log);
  const stepState = (i: number): Step => {
    const current = i === phase || (phase === 1 && i === 2);   // checks 2 and 3 come from one build
    if (active) return current ? "running" : i < phase ? "past" : "pending";
    return current ? "stopped" : i < phase ? "past" : "skipped";
  };
  const took = job.started && job.finished ? job.finished - job.started : null;

  return (
    <>
      {active ? (
        <p className="small build-time" aria-live="polite">
          {job.state === "queued" ? "Waiting for the builder to start it" : "Running"}, {elapsed(secs ?? 0)} (usually 2–5 min).
        </p>
      ) : took !== null ? <p className="small muted build-time">Took {elapsed(took)}.</p> : null}
      {lines ? (
        <ul className="gate-checks" aria-label="Gate checks">
          {lines.map((c, i) => (
            <li key={i} className={c.ok ? "ok" : "bad"}>
              {c.ok ? "✓" : "✗"} {c.text}
              {c.meaning && <span className="small muted meaning">{c.meaning}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <ol className="gate-checks pending" aria-label="Gate checks">
          {GATE_STEPS.map((s, i) => {
            const st = stepState(i);
            return (
              <li key={s.key} className={`step-${st}`}>
                {MARK[st]} {s.text}{NOTE[st] && <span className="small muted">: {NOTE[st]}</span>}
                <span className="small muted meaning">{s.explain}</span>
              </li>
            );
          })}
        </ol>
      )}
      {job.state === "failed" && !lines && (
        <p className="warn small">The build stopped before its checks had a result: the build log says why.</p>
      )}
      {job.report?.error && <p className="warn">{job.report.error}</p>}
      <details className="build-log" open={job.state === "failed" && !lines} onToggle={toEnd}>
        <summary className="small">Show build log</summary>
        <pre ref={pre} className="log" aria-label="Build log">{log.slice(-8000)}</pre>
      </details>
    </>
  );
}
