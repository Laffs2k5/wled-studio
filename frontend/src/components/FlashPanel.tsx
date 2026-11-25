// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { api, firmware, type FlashNotice, type FlashPlan, type FlashRun, type PreviousFirmware } from "../api";
import { when } from "../time";
import { NoticeDialog } from "./NoticeDialog";
import { ChangeDevice } from "./ChangeDevice";

const STEP_LABELS: Record<string, string> = {
  backup: "Back up the device's presets and settings",
  image: "Check the image against the gate's",
  upload: "Upload it to the device",
  revert: "Boot the previous firmware",
  restart: "The device restarts",
  checks: "Check the device against the backup",
};
/** Every step of a flash and a revert, in order: listed from the start, pending until they run. */
const STEPS: Record<FlashRun["kind"], string[]> = {
  flash: ["backup", "image", "upload", "restart", "checks"],
  revert: ["backup", "revert", "restart"],
};
const MARK = { ok: "✓", warn: "⚠", block: "✗", failed: "✗", running: "…", pending: "○" } as const;

/** A finished flash or revert in plain words: the verdict, and what to do about it. */
export function runVerdict(run: FlashRun, deviceName: string): { level: "ok" | "warn" | "bad"; text: string } {
  const r = run.result ?? {};
  const runs = `WLED ${r.ver ?? "?"}${typeof r.effects === "number" ? ` with ${r.effects} effects` : ""}`;
  const failed = run.steps.find((s) => s.state === "failed");
  if (run.kind === "revert") {
    return run.state === "failed"
      ? { level: "bad", text: `Couldn't go back${failed?.detail ? `: ${failed.detail}` : ""}. Look at ${deviceName}.` }
      : { level: "ok", text: `Back on the previous firmware: ${deviceName} runs ${runs}.` };
  }
  if (run.state === "done") return { level: "ok", text: `Flashed and running: ${deviceName} runs ${runs}.` };
  if (run.state === "warnings") {
    if (r.image_running === false) {
      return { level: "warn", text: `Flashed, but ${deviceName} doesn't report the new effects. It may still be running the old `
        + "firmware. Look at the strip; go back to the previous firmware if it isn't right." };
    }
    const what = [r.presets_changed && "its presets changed", r.cfg_changed && "its settings changed",
      r.heap_low && `free memory is lower than before (${r.heap_low.now.toLocaleString()} bytes, was ${r.heap_low.before.toLocaleString()})`]
      .filter(Boolean).join("; ");
    return { level: "warn", text: `Flashed and running ${runs}, but ${what || "a check after the restart warned"}. `
      + "Look at the strip; go back to the previous firmware if it isn't right." };
  }
  // failed: what it means depends on how far it got
  const why = failed?.detail ? ` (${failed.detail})` : "";
  if (!failed || failed.name === "backup" || failed.name === "image") {
    return { level: "bad", text: `Not flashed${why}. ${deviceName} wasn't touched and runs its old firmware.` };
  }
  if (failed.name === "upload") {
    return { level: "bad", text: `Not flashed: the upload didn't go through${why}. ${deviceName} still runs its old firmware.` };
  }
  return { level: "bad", text: `Uploaded, but ${deviceName} didn't come back as expected${why}. Give it a minute and look `
    + "at it; if it doesn't start, go back to the previous firmware, or recover it over USB." };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const few = (xs: string[], n = 5) => xs.slice(0, n).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");

/** The plan's verdict, as the first thing to read. */
export function verdict(plan: FlashPlan): string {
  const blocks = plan.checks.filter((c) => c.level === "block").length;
  const warns = plan.checks.filter((c) => c.level === "warn").length;
  if (!plan.can_flash) return `Cannot flash: ${count(Math.max(blocks, 1), "problem", "problems")}`;
  return warns ? `Ready to flash, with ${count(warns, "thing", "things")} to look at` : "Ready to flash";
}

/** The last flash or revert per device, kept while the page is open: leaving the Firmware view, or
 * picking a virtual device for a while, doesn't lose a run or its result. */
const lastRuns = new Map<string, FlashRun>();
export const forgetRuns = () => lastRuns.clear();

/** Flash a gate-passed image to a device: the plan, a typed confirmation, the run; and the way back. */
export function FlashPanel({ job, device, deviceName, notify, onShowLooks, onOpenLooks }: {
  job: string; device: string; deviceName: string; notify: (msg: string, error?: boolean) => void;
  /** Show which looks change with this image (the library check above). */
  onShowLooks?: () => void;
  /** After a flash: go to Looks & effects, where the new effects are. */
  onOpenLooks?: () => void;
}) {
  const [plan, setPlan] = useState<FlashPlan | null>(null);
  const [pinForm, setPinForm] = useState(false);
  const [pin, setPin] = useState("");
  const replan = () => firmware.flashPlan(job, device).then(setPlan).catch((e) => notify((e as Error).message, true));
  const [typed, setTyped] = useState("");
  // the last flash or revert per device: a run belongs to its device, and isn't shown under another
  const [runs, setRuns] = useState<Record<string, FlashRun>>(() => Object.fromEntries(lastRuns));
  const run = runs[device] ?? null;
  const setRun = (r: FlashRun) => { lastRuns.set(r.device, r); setRuns((m) => ({ ...m, [r.device]: r })); };
  const [previous, setPrevious] = useState<PreviousFirmware | null>(null);
  const [revertTyped, setRevertTyped] = useState("");
  // the notice: loaded when needed; `pending` is the flash or revert waiting for it to be accepted
  const [notice, setNotice] = useState<FlashNotice | null>(null);
  const [pending, setPending] = useState<{ action: string; go: (version: string) => Promise<FlashRun> } | null>(null);

  useEffect(() => { firmware.notice().then(setNotice).catch(() => setNotice(null)); }, []);

  useEffect(() => { setPlan(null); setTyped(""); setRevertTyped(""); setPinForm(false); }, [job, device]);

  // what going back would boot: read again for each device, and after each finished run
  const runDone = run && run.state !== "running" ? run.id : null;
  useEffect(() => {
    setPrevious(null);
    firmware.previous(device).then(setPrevious).catch(() => setPrevious(null));
  }, [device, runDone]);

  // follow a running flash or revert
  useEffect(() => {
    if (!run || run.state !== "running") return;
    const t = setTimeout(() => firmware.run(run.id).then((r) => {
      setRun(r);
      if (r.state !== "running") { const v = runVerdict(r, deviceName); notify(v.text, v.level === "bad"); }
    }).catch((e) => notify((e as Error).message, true)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, notify]);

  const running = run?.state === "running";
  const afterFlash = Boolean(run && run.kind === "flash" && !running
    && run.steps.some((s) => s.name === "upload" && s.state === "ok"));
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
      {run && (() => {
        const done = run.steps.length;
        const failedAt = run.steps.findIndex((s) => s.state === "failed");
        const names = STEPS[run.kind] ?? run.steps.map((s) => s.name);
        const v = running ? null : runVerdict(run, deviceName);
        return (
          <div className="run" aria-label="Flash progress">
            <h3>{run.kind === "flash" ? `Flashing ${deviceName}` : `Going back to the previous firmware on ${deviceName}`}
              {running ? "…" : ""}</h3>
            {running && <p className="warn do-not">Do not power off or unplug {deviceName} until this has finished.</p>}
            <ol>
              {names.map((name, i) => {
                const s = run.steps[i];
                const state = s?.state ?? (running && i === done && failedAt < 0 ? "running" : "pending");
                return (
                  <li key={name} className={state === "failed" ? "bad" : state}>
                    {MARK[state]} {STEP_LABELS[name] ?? name}{s?.detail ? `: ${s.detail}` : ""}
                    {!s && !running ? <span className="muted small">: not run</span> : null}
                  </li>
                );
              })}
            </ol>
            {v && <p className={`verdict ${v.level}`}>{v.text}</p>}
            {v && run.kind === "flash" && run.state !== "failed" && run.result?.image_running !== false && (
              <p className="small next-step">
                Next: your new effects are in {deviceName}'s effect list now.{" "}
                {onOpenLooks && <><button className="link" onClick={onOpenLooks}>Open Looks &amp; effects</button> to use them, and </>}
                check what would change there before writing presets.
              </p>
            )}
          </div>
        );
      })()}
      {plan?.running.arch !== "virtual" && (
        // after a flash that reached the device, the way back is part of the result; otherwise folded away
        <details key={afterFlash ? "result" : "folded"} open={afterFlash} className={`revert${afterFlash ? " prominent" : ""}`}>
          <summary>Go back to the previous firmware</summary>
          <p className="small">
            {previous?.known
              ? <>{deviceName}'s other firmware slot holds WLED {previous.ver}{previous.release ? ` (${previous.release})` : ""}: what it
                  ran before this app {previous.kind === "flash" ? "flashed" : "switched"} it{previous.when ? ` ${when(previous.when)}` : ""}.</>
              : <>What {deviceName}'s other firmware slot holds isn't known: the app knows only after it has flashed the device.</>}
            {" "}WLED keeps the previous firmware there; going back boots it again (WLED's /update?revert), with a backup first.
          </p>
          <div className="row">
            <input aria-label="Type the device's name to go back" placeholder={`type ${deviceName} to go back`} value={revertTyped}
              onChange={(e) => setRevertTyped(e.target.value)} />
            <button className="danger" disabled={revertTyped !== deviceName || running}
              onClick={() => withNotice("go back", (v) => firmware.revert(device, revertTyped, v))}>Go back on {deviceName}</button>
          </div>
        </details>
      )}
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
