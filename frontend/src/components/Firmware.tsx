// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useRef, useState } from "react";
import { FlashPanel } from "./FlashPanel";
import { BuildChecks } from "./BuildChecks";
import { api, firmware, type FirmwareJob, type FirmwareTarget, type Preflight } from "../api";
import { buildResult, buildTitle, gateLines, releaseOf } from "../gate";
import { when } from "../time";
import type { Device } from "../types";
import { PreflightReport } from "./Preflight";
import { ChangeDevice } from "./ChangeDevice";
import { remembered } from "../remember";
import { boardName, matchingTarget, targetFit, targetKey, targetName, type Fit } from "../targets";

/** The last target chosen, per device ("" without one), and the folders ticked: remembered here. */
export const firmwareTarget = remembered<Record<string, string>>("wledstudio.firmware.target", {});
export const firmwareFolders = remembered<string[]>("wledstudio.firmware.folders", []);

const FIT_NOTE: Record<Fit, string> = { match: "matches", "other-release": "same board, other release", "other-board": "different board" };

/** Build firmware with your own effects, through the gate (wled-studio-builder). */
export function Firmware({ notify, devices = [], device = null, request = null, onOpenLooks, openJob, onOpenJob }: {
  notify: (msg: string, error?: boolean) => void;
  /** The devices, and the one picked in the header: the library is checked, and images flashed, for it. */
  devices?: Device[];
  device?: string | null;
  /** From the Effect studio: build with these folders, for the target that matches the device. */
  request?: { folders: string[]; seq: number } | null;
  /** After a flash: go to Looks & effects. */
  onOpenLooks?: () => void;
  openJob?: string | null;
  onOpenJob?: (id: string) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [targets, setTargets] = useState<FirmwareTarget[]>([]);
  const [usermods, setUsermods] = useState<string[]>([]);
  const [jobs, setJobs] = useState<FirmwareJob[]>([]);
  const [target, setTargetState] = useState("");
  const [chosen, setChosenState] = useState<string[]>(() => firmwareFolders.get());
  const setChosen = (next: string[]) => { setChosenState(next); firmwareFolders.set(next); };
  const setTarget = (key: string) => {
    setTargetState(key);
    firmwareTarget.set({ ...firmwareTarget.get(), [device ?? ""]: key });
  };
  // what the header's device runs (/json/info): undefined while reading, null if it can't be read
  const [info, setInfo] = useState<Record<string, string | number | null> | null | undefined>(undefined);
  const [open, setOpen] = useState<FirmwareJob | null>(null);
  const [log, setLog] = useState("");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [repeating, setRepeating] = useState<string | null>(null);
  const dev = devices.find((d) => d.id === device);

  const preflightBox = useRef<HTMLDivElement>(null);
  const checkLibrary = (job: string, dev: string) => firmware.preflight(job, dev).then(setPreflight)
    .catch((e) => notify((e as Error).message, true));
  const reloadJobs = useCallback(() => firmware.jobs().then(setJobs).catch((e) => notify(e.message, true)), [notify]);

  useEffect(() => {
    firmware.status().then((s) => {
      setEnabled(s.enabled);
      if (!s.enabled) return;
      firmware.targets().then(setTargets);
      firmware.usermods().then((u) => { setUsermods(u); setChosenState((c) => c.filter((x) => u.includes(x))); });
      reloadJobs();
    }).catch((e) => { setEnabled(false); notify(e.message, true); });
  }, [notify, reloadJobs]);

  useEffect(() => {
    setInfo(undefined);
    if (!device) { setInfo(null); return; }
    let stop = false;
    api.profile(device).then((p) => { if (!stop) setInfo(p.info); }).catch(() => { if (!stop) setInfo(null); });
    return () => { stop = true; };
  }, [device]);

  // from the Effect studio: its folders ticked, and the matching target before the last choice
  const preferMatch = useRef(false);
  useEffect(() => {
    if (!request) return;
    setChosen(request.folders);
    preferMatch.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.seq]);

  // the target: the one last chosen for this device, else the one that matches it, else the first
  useEffect(() => {
    if (!targets.length || info === undefined) return;
    const keys = targets.map(targetKey);
    const last = firmwareTarget.get()[device ?? ""];
    const match = matchingTarget(targets, info);
    const preferred = preferMatch.current && match ? targetKey(match) : last;
    preferMatch.current = false;
    setTargetState(preferred && keys.includes(preferred) ? preferred : match ? targetKey(match) : keys[0]);
  }, [targets, info, device, request?.seq]);

  // follow the open job while it runs
  useEffect(() => {
    if (!open) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await firmware.job(open.id);
        const l = await firmware.log(open.id);
        if (stop) return;
        setOpen(j);
        setLog(l);
        if (j.state === "queued" || j.state === "running") setTimeout(tick, 3000);
        else reloadJobs();
      } catch (e) {
        notify((e as Error).message, true);
      }
    };
    tick();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id]);

  useEffect(() => {
    if (!openJob) return;
    let stop = false;
    firmware.job(openJob).then((job) => { if (!stop) setOpen(job); })
      .catch((e) => notify((e as Error).message, true));
    return () => { stop = true; };
  }, [openJob, notify]);

  useEffect(() => {
    setPreflight(null);
    if (!open || open.state !== "passed" || open.kind === "preview" || !device) return;
    let stop = false;
    firmware.preflight(open.id, device)
      .then((result) => { if (!stop) setPreflight(result); })
      .catch((e) => notify((e as Error).message, true));
    return () => { stop = true; };
  }, [open?.id, open?.state, open?.kind, device, notify]);

  if (enabled === null) return <p className="muted pad">Loading…</p>;
  if (!enabled) {
    return (
      <section className="firmware">
        <h2>Firmware</h2>
        {!device && <p className="first-run-note">Building needs no device; flashing does.</p>}
        <p>No firmware builder is configured. Start one with <code>docker compose --profile firmware up</code>; see the README.</p>
      </section>
    );
  }

  const [pins, tgt] = target.split("|");
  const current = targets.find((t) => t.pins === pins && t.target === tgt);
  // firmware builds only: the studio's preview compiles are its own business
  const builds = jobs.filter((j) => j.kind !== "preview");
  const fitOf = (t: typeof targets[number]) => (dev && !dev.virtual ? targetFit(t, info) : null);
  const fit = current ? fitOf(current) : null;
  const match = dev && !dev.virtual ? matchingTarget(targets, info) : undefined;
  const repeat = (job: FirmwareJob) => {
    setRepeating(job.id);
    firmware.submit(job.pins, job.target, job.usermods).then((next) => {
      setOpen(next);
      onOpenJob?.(next.id);
      reloadJobs();
      notify(`Repeated “${buildTitle(job)}” with the same board, release and effects`);
    }).catch((e) => notify((e as Error).message, true)).finally(() => setRepeating(null));
  };
  return (
    <section className="firmware">
      <h2>Build firmware with your effects</h2>
      {!device && <p className="first-run-note">Building needs no device; flashing does.</p>}
      <p className="muted small">
        Builds WLED for your board with your effects added. Before it may be flashed, the build must pass four
        safety checks; they're listed when it starts. A build takes a few minutes.
      </p>
      <form className="build-form" onSubmit={(e) => {
        e.preventDefault();
        firmware.submit(pins, tgt, chosen).then((j) => { setOpen(j); onOpenJob?.(j.id); reloadJobs(); notify("Build queued"); })
          .catch((er) => notify(er.message, true));
      }}>
        <label className="field">
          Board and WLED release
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((t) => {
              const f = fitOf(t);
              return (
                <option key={targetKey(t)} value={targetKey(t)}>
                  {targetName(t)}{f ? ` (${FIT_NOTE[f]}${f === "match" ? ` ${dev!.name}` : ""})` : ""}
                  {t.verified.length ? "" : " (not verified yet)"}
                </option>
              );
            })}
          </select>
        </label>
        {dev && current && (dev.virtual ? (
          <p className="muted small">{dev.name} is a virtual device and can't be flashed: pick the board you'll flash.</p>
        ) : info === undefined ? null : fit === "match" ? (
          <p className="ok small">Matches {dev.name} ({boardName(info)}).</p>
        ) : fit === null ? (
          <p className="muted small">{dev.name} doesn't say which board it is, so nothing is preselected.</p>
        ) : (
          <p className="warn small">
            Not {dev.name}'s {fit === "other-release" ? "release" : "board"}: it runs {boardName(info)}.{" "}
            {match ? <>The one that matches is {targetName(match)}.</> : "None of the builder's targets matches it."}{" "}
            An image built for another board or release doesn't belong on it.
          </p>
        ))}
        <fieldset className="choice">
          <legend>Your effect folders to include</legend>
          <div className="row">
            {usermods.map((u) => (
              <label key={u} className="small">
                <input type="checkbox" checked={chosen.includes(u)}
                  onChange={(e) => setChosen(e.target.checked ? [...chosen, u] : chosen.filter((x) => x !== u))} /> {u}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <button className="primary" disabled={!chosen.length || !current}>Build</button>
        </div>
      </form>
      {current && !current.verified.length && <p className="warn small">This target has no verified result yet, so its gate will fail.</p>}
      {builds.length > 0 && (
        <>
          <h2>Your builds</h2>
          <table className="jobs" aria-label="Your builds">
            <thead><tr><th>When</th><th>Board and release</th><th>Effects</th><th>Result</th><th>Again</th></tr></thead>
            <tbody>
              {builds.map((j) => (
                <tr key={j.id} className={`state-${j.state}${open?.id === j.id ? " open" : ""}`} tabIndex={0}
                  aria-selected={open?.id === j.id} title="Open this build"
                  onClick={() => { setOpen(j); onOpenJob?.(j.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault(); setOpen(j); onOpenJob?.(j.id);
                  } }}>
                  <td>{when(j.created)}</td><td>{j.target} · {releaseOf(j.pins)}</td>
                  <td>{j.usermods.join(", ")}</td>
                  <td title={j.state === "failed" ? gateLines({ passed: false, checks: j.report?.checks ?? j.checks, error: j.error })
                    .find((c) => !c.ok)?.text ?? j.error ?? undefined : undefined}>{buildResult(j)}</td>
                  <td><button className="small" disabled={repeating === j.id}
                    onClick={(event) => { event.stopPropagation(); repeat(j); }}>
                    {repeating === j.id ? "Queuing…" : "Same again"}
                  </button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {open && (
        <div className="job">
          <h2>{buildTitle(open)}</h2>
          <ol className="firmware-steps" aria-label="Firmware steps">
            <li>
              <h2><span>1</span> Built and checked</h2>
              <BuildChecks job={open} log={log} />
            </li>
            {open.state === "passed" && open.kind !== "preview" && (
              <li>
                <div className="preflight" ref={preflightBox}>
                  <h2><span>2</span> What it does to your looks
                    {dev && <> on {dev.name} <ChangeDevice /></>}</h2>
                  {!dev ? (
                    <p className="muted small">Pick a device in the header to check your looks against this image.</p>
                  ) : preflight && preflight.job === open.id && preflight.device === dev.id ? (
                    <PreflightReport preflight={preflight} />
                  ) : (
                    <p className="muted small">Checking the library automatically…</p>
                  )}
                </div>
              </li>
            )}
            {open.state === "passed" && open.kind !== "preview" && dev && (
              <li>
                {dev.virtual ? (
                  <p className="muted flash">
                    {dev.name} is a virtual device: a software copy of WLED for testing, with no
                    LEDs. It runs the firmware it was built from, and can't be flashed or reverted. <ChangeDevice />
                  </p>
                ) : (
                  <FlashPanel job={open.id} device={dev.id} deviceName={dev.name} deviceAddress={dev.host}
                    notify={notify} automatic onOpenLooks={onOpenLooks} onShowLooks={async () => {
                      await checkLibrary(open.id, dev.id);
                      preflightBox.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
                    }} />
                )}
              </li>
            )}
          </ol>
        </div>
      )}
    </section>
  );
}
