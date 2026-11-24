// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { firmware, type FlashNotice, type FlashPlan, type FlashRun } from "../api";
import { NoticeDialog } from "./NoticeDialog";

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
  // the notice: loaded when needed; `pending` is the flash or revert waiting for it to be accepted
  const [notice, setNotice] = useState<FlashNotice | null>(null);
  const [pending, setPending] = useState<{ action: string; go: (version: string) => Promise<FlashRun> } | null>(null);

  useEffect(() => { firmware.notice().then(setNotice).catch(() => setNotice(null)); }, []);

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
  // every flash and revert passes the notice: shown unless accepted with "don't show this again"
  const withNotice = async (action: string, go: (version: string) => Promise<FlashRun>) => {
    try {
      const n = await firmware.notice();
      setNotice(n);
      if (n.remembered) start(go(n.version));
      else setPending({ action, go });
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const accept = async (remember: boolean) => {
    if (!notice || !pending) return;
    const { go } = pending;
    setPending(null);
    try {
      await firmware.acceptNotice(notice.version, remember);
      if (remember) setNotice({ ...notice, remembered: true, accepted: new Date().toISOString() });
      start(go(notice.version));
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

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
                onClick={() => withNotice("flash", (v) => firmware.flash(job, device, typed, v))}>Flash {plan.name}</button>
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
            onClick={() => withNotice("revert", (v) => firmware.revert(device, revertTyped, v))}>Revert {deviceName}</button>
        </div>
      </details>
      {notice?.remembered && (
        <p className="small muted">
          You accepted the flashing notice ({notice.version}) and chose not to see it again.{" "}
          <button className="link" onClick={() => firmware.forgetNotice().then(() => setNotice({ ...notice, remembered: false }))
            .catch((e) => notify((e as Error).message, true))}>Show it before every flash again</button>
        </p>
      )}
      {pending && notice && (
        <NoticeDialog notice={notice} action={pending.action} onAccept={accept} onCancel={() => setPending(null)} />
      )}
    </div>
  );
}
