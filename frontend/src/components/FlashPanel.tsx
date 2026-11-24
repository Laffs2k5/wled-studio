// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { firmware, type FlashPlan, type FlashRun } from "../api";

const STEP_LABELS: Record<string, string> = {
  backup: "Backup (presets, config, info, effects)",
  image: "The image, checked against the gate",
  upload: "Upload to the device",
  revert: "Revert to the previous image",
  restart: "Device restarts",
  checks: "Checks against the backup",
};
const MARK = { ok: "✓", warn: "⚠", block: "✗", failed: "✗", running: "…" } as const;

/** Flash a gate-passed image to a device: the plan, a typed confirmation, the run; and the way back. */
export function FlashPanel({ job, device, deviceName, notify }: {
  job: string; device: string; deviceName: string; notify: (msg: string, error?: boolean) => void;
}) {
  const [plan, setPlan] = useState<FlashPlan | null>(null);
  const [typed, setTyped] = useState("");
  const [run, setRun] = useState<FlashRun | null>(null);
  const [revertTyped, setRevertTyped] = useState("");

  useEffect(() => { setPlan(null); setTyped(""); setRevertTyped(""); }, [job, device]);

  // follow a running flash or revert
  useEffect(() => {
    if (!run || run.state !== "running") return;
    const t = setTimeout(() => firmware.run(run.id).then((r) => {
      setRun(r);
      if (r.state !== "running") notify(`${r.kind === "flash" ? "Flash" : "Revert"}: ${r.state}`, r.state === "failed");
    }).catch((e) => notify((e as Error).message, true)), 1000);
    return () => clearTimeout(t);
  }, [run, notify]);

  const running = run?.state === "running";
  const start = (p: Promise<FlashRun>) => p.then((r) => { setRun(r); setPlan(null); setTyped(""); setRevertTyped(""); })
    .catch((e) => notify((e as Error).message, true));

  return (
    <div className="flash">
      <h2>Flash it to {deviceName}</h2>
      <button disabled={running} onClick={() => firmware.flashPlan(job, device).then(setPlan).catch((e) => notify((e as Error).message, true))}>
        Plan the flash
      </button>
      {plan && (
        <>
          <ul className="flash-checks" aria-label="Flash checks">
            {plan.checks.map((c) => <li key={c.id} className={c.level === "block" ? "bad" : c.level}>{MARK[c.level]} {c.text}</li>)}
          </ul>
          <p className="small muted">
            Running now: {plan.running.ver ?? "?"} ({plan.running.release ?? "?"}), free heap {plan.running.freeheap?.toLocaleString() ?? "?"} bytes.
            The image: {plan.image.size?.toLocaleString() ?? "?"} bytes, sha256 {plan.image.sha256?.slice(0, 12) ?? "?"}….
          </p>
          {plan.can_flash ? (
            <div className="row">
              <input aria-label="Type the device's name to flash" placeholder={`type ${plan.name} to flash`} value={typed}
                onChange={(e) => setTyped(e.target.value)} />
              <button className="danger" disabled={typed !== plan.name || running || plan.busy}
                onClick={() => start(firmware.flash(job, device, typed))}>Flash {plan.name}</button>
            </div>
          ) : <p className="bad small">Not flashable until the ✗ above are fixed.</p>}
        </>
      )}
      {run && (
        <div className="run" aria-label="Flash progress">
          <h3>{run.kind === "flash" ? "Flash" : "Revert"}: {run.state}</h3>
          <ol>
            {run.steps.map((s, i) => (
              <li key={i} className={s.state === "failed" ? "bad" : s.state}>
                {MARK[s.state]} {STEP_LABELS[s.name] ?? s.name}{s.detail ? `: ${s.detail}` : ""}
              </li>
            ))}
          </ol>
          {run.state === "warnings" && <p className="warn small">Flashed, with warnings: look at the strip, and revert below if it isn't right.</p>}
          {run.state === "failed" && <p className="bad small">It didn't finish. The device keeps the image it had unless the upload completed; revert below if needed.</p>}
        </div>
      )}
      <details className="revert">
        <summary>The way back: revert {deviceName} to its previous image</summary>
        <p className="small muted">WLED keeps the previous image in its other slot; this boots it again (WLED's /update?revert).</p>
        <div className="row">
          <input aria-label="Type the device's name to revert" placeholder={`type ${deviceName} to revert`} value={revertTyped}
            onChange={(e) => setRevertTyped(e.target.value)} />
          <button className="danger" disabled={revertTyped !== deviceName || running}
            onClick={() => start(firmware.revert(device, revertTyped))}>Revert {deviceName}</button>
        </div>
      </details>
    </div>
  );
}
