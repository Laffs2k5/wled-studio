// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { api, firmware, type FlashNotice, type FlashPlan, type FlashRun } from "../api";
import { NoticeDialog } from "./NoticeDialog";
import { ChangeDevice } from "./ChangeDevice";

const STEP_LABELS: Record<string, string> = {
  backup: "Backup (presets, config, info, effects)",
  image: "The image, checked against the gate",
  upload: "Upload to the device",
  revert: "Revert to the previous image",
  restart: "Device restarts",
  checks: "Checks against the backup",
};
const MARK = { ok: "✓", warn: "⚠", block: "✗", failed: "✗", running: "…" } as const;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const few = (xs: string[], n = 5) => xs.slice(0, n).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");

/** The plan's verdict, as the first thing to read. */
export function verdict(plan: FlashPlan): string {
  const blocks = plan.checks.filter((c) => c.level === "block").length;
  const warns = plan.checks.filter((c) => c.level === "warn").length;
  if (!plan.can_flash) return `Cannot flash: ${count(Math.max(blocks, 1), "problem", "problems")}`;
  return warns ? `Ready to flash, with ${count(warns, "thing", "things")} to look at` : "Ready to flash";
}

/** Flash a gate-passed image to a device: the plan, a typed confirmation, the run; and the way back. */
export function FlashPanel({ job, device, deviceName, notify, onShowLooks }: {
  job: string; device: string; deviceName: string; notify: (msg: string, error?: boolean) => void;
  /** Show which looks change with this image (the library check above). */
  onShowLooks?: () => void;
}) {
  const [plan, setPlan] = useState<FlashPlan | null>(null);
  const [pinForm, setPinForm] = useState(false);
  const [pin, setPin] = useState("");
  const replan = () => firmware.flashPlan(job, device).then(setPlan).catch((e) => notify((e as Error).message, true));
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
      <h2>Flash it to {deviceName} <ChangeDevice /></h2>
      <button disabled={running} onClick={replan}>{plan ? "Check again" : "Plan the flash"}</button>
      {plan && (
        <div className="flash-plan">
          <p className={`verdict ${plan.can_flash ? (plan.checks.some((c) => c.level === "warn") ? "warn" : "ok") : "bad"}`}>
            {verdict(plan)}
          </p>
          {plan.checks.some((c) => c.level === "block") && (
            <ul className="flash-checks" aria-label="Problems">
              {plan.checks.filter((c) => c.level === "block").map((c) => <li key={c.id} className="bad">{MARK.block} {c.text}</li>)}
            </ul>
          )}
          {plan.checks.some((c) => c.level === "warn") && (
            <ul className="flash-checks" aria-label="To look at">
              {plan.checks.filter((c) => c.level === "warn").map((c) => (
                <li key={c.id} className="warn">
                  {MARK.warn} {c.text}{" "}
                  {c.id === "pin" && <button className="link" onClick={() => setPinForm(!pinForm)}>Store the PIN</button>}
                  {c.id === "library" && onShowLooks && <button className="link" onClick={onShowLooks}>See which looks</button>}
                  {c.id === "pin" && pinForm && (
                    <form className="row" onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await api.setPin(device, pin);
                        notify(`PIN for ${deviceName} saved in the app`);
                        setPin(""); setPinForm(false);
                        replan();
                      } catch (er) { notify((er as Error).message, true); }
                    }}>
                      <input type="password" autoComplete="off" maxLength={16} required value={pin} aria-label={`${deviceName}'s settings PIN`}
                        onChange={(e) => setPin(e.target.value)} />
                      <button className="primary">Save PIN</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details className="passed">
            <summary className="small">{count(plan.checks.filter((c) => c.level === "ok").length, "check", "checks")} passed</summary>
            <ul className="flash-checks" aria-label="Checks passed">
              {plan.checks.filter((c) => c.level === "ok").map((c) => <li key={c.id} className="ok">{MARK.ok} {c.text}</li>)}
            </ul>
            <p className="small muted">
              The image: {plan.image.size?.toLocaleString() ?? "?"} bytes, sha256 {plan.image.sha256?.slice(0, 12) ?? "?"}….
              Free heap now: {plan.running.freeheap?.toLocaleString() ?? "?"} bytes.
            </p>
          </details>
          <p className="small before-after">
            <strong>Now on {plan.name}:</strong> WLED {plan.running.ver ?? "?"}{plan.running.release ? ` (${plan.running.release})` : ""}.{" "}
            <strong>After:</strong> {plan.image.target ?? "this build"}{plan.image.release ? ` · ${plan.image.release}` : ""}
            {plan.image.usermods?.length ? ` with ${plan.image.usermods.join(", ")}` : ""}
            {plan.image.new_effects?.length ? `, which adds ${few(plan.image.new_effects)}` : ""}.
          </p>
          {plan.can_flash && (
            <p className="small muted">
              What happens: the device's presets and settings are backed up first; then the image is uploaded and the
              device restarts, so the strip goes dark for a moment. It takes about a minute. If it isn't right afterwards,
              you can go back to the previous firmware.
            </p>
          )}
          {plan.can_flash ? (
            <div className="row">
              <input aria-label="Type the device's name to flash" placeholder={`type ${plan.name} to flash`} value={typed}
                onChange={(e) => setTyped(e.target.value)} />
              <button className="danger" disabled={typed !== plan.name || running || plan.busy}
                onClick={() => withNotice("flash", (v) => firmware.flash(job, device, typed, v))}>Flash {plan.name}</button>
            </div>
          ) : <p className="bad small">Fix the problems above, then check again.</p>}
        </div>
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
      {plan?.running.arch !== "virtual" && <details className="revert">
        <summary>The way back: revert {deviceName} to its previous image</summary>
        <p className="small muted">WLED keeps the previous image in its other slot; this boots it again (WLED's /update?revert).</p>
        <div className="row">
          <input aria-label="Type the device's name to revert" placeholder={`type ${deviceName} to revert`} value={revertTyped}
            onChange={(e) => setRevertTyped(e.target.value)} />
          <button className="danger" disabled={revertTyped !== deviceName || running}
            onClick={() => withNotice("revert", (v) => firmware.revert(device, revertTyped, v))}>Revert {deviceName}</button>
        </div>
      </details>}
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
