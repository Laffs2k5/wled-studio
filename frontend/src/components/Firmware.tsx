// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { firmware, type FirmwareJob, type FirmwareTarget } from "../api";

const CHECK_LABELS: Record<string, string> = {
  stock_matches_verified: "Stock build matches the verified result",
  only_usermod_objects_changed: "Only your usermods' code was added",
  fits_app_slot: "Fits the firmware slot, with margin",
};

/** Build firmware with your own effects, through the gate (wled-studio-builder). */
export function Firmware({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [targets, setTargets] = useState<FirmwareTarget[]>([]);
  const [usermods, setUsermods] = useState<string[]>([]);
  const [jobs, setJobs] = useState<FirmwareJob[]>([]);
  const [target, setTarget] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [open, setOpen] = useState<FirmwareJob | null>(null);
  const [log, setLog] = useState("");

  const reloadJobs = useCallback(() => firmware.jobs().then(setJobs).catch((e) => notify(e.message, true)), [notify]);

  useEffect(() => {
    firmware.status().then((s) => {
      setEnabled(s.enabled);
      if (!s.enabled) return;
      firmware.targets().then((t) => { setTargets(t); if (t[0]) setTarget(`${t[0].pins}|${t[0].target}`); });
      firmware.usermods().then(setUsermods);
      reloadJobs();
    }).catch((e) => { setEnabled(false); notify(e.message, true); });
  }, [notify, reloadJobs]);

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

  if (enabled === null) return <p className="muted">Loading…</p>;
  if (!enabled) {
    return (
      <section className="firmware">
        <h2>Firmware</h2>
        <p>No firmware builder is configured. Start one with <code>docker compose --profile firmware up</code>; see the README.</p>
      </section>
    );
  }

  const [pins, tgt] = target.split("|");
  const current = targets.find((t) => t.pins === pins && t.target === tgt);
  return (
    <section className="firmware">
      <h2>Build firmware with your effects</h2>
      <p className="muted small">
        Each build runs the gate: the vendor's stock image is rebuilt and checked first, then rebuilt with your
        usermods; only images whose sole change is your code pass.
      </p>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        firmware.submit(pins, tgt, chosen).then((j) => { setOpen(j); reloadJobs(); notify("Build queued"); })
          .catch((er) => notify(er.message, true));
      }}>
        <select value={target} aria-label="Target" onChange={(e) => setTarget(e.target.value)}>
          {targets.map((t) => (
            <option key={`${t.pins}|${t.target}`} value={`${t.pins}|${t.target}`}>
              {t.release} · {t.target}{t.verified.length ? "" : " (not verified yet)"}
            </option>
          ))}
        </select>
        {usermods.map((u) => (
          <label key={u} className="small">
            <input type="checkbox" checked={chosen.includes(u)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, u] : chosen.filter((x) => x !== u))} /> {u}
          </label>
        ))}
        <button className="primary" disabled={!chosen.length || !current}>Build</button>
      </form>
      {current && !current.verified.length && <p className="warn small">This target has no verified result yet, so its gate will fail.</p>}
      <table className="jobs">
        <thead><tr><th>Started</th><th>Target</th><th>Usermods</th><th>State</th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className={`state-${j.state}`} onClick={() => setOpen(j)}>
              <td>{new Date(j.created * 1000).toLocaleString()}</td><td>{j.target}</td>
              <td>{j.usermods.join(", ")}</td><td>{j.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <div className="job">
          <h2>Build {open.id.slice(0, 8)}: {open.state}</h2>
          {open.report?.checks && (
            <ul>
              {Object.entries(open.report.checks).map(([k, v]) => (
                <li key={k} className={v ? "ok" : "bad"}>{v ? "✓" : "✗"} {CHECK_LABELS[k] ?? k}</li>
              ))}
            </ul>
          )}
          {open.report?.error && <p className="warn">{open.report.error}</p>}
          <pre className="log" aria-label="Build log">{log.slice(-8000)}</pre>
        </div>
      )}
    </section>
  );
}
