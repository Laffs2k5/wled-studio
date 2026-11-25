// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { PushResult } from "../types";
import { groupPlan, WritePlan } from "./WritePlan";

/** How long after the last library change the device is checked (a dry run: nothing is written). */
export const CHECK_DELAY_MS = 600;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A time from the backend (ISO 8601): the clock time today, else the date too. */
export function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString()} ${time}`;
}

interface Props {
  deviceId: string;
  deviceName: string;
  notify: (msg: string, error?: boolean) => void;
  /** Bumped after every library change: the device is checked again shortly after (debounced). */
  version: number;
  /** Bumped to open the plan from elsewhere (the look editor's "Check and write"). */
  openRequest?: number;
}

/** The one route to the device: a bar at the bottom of the view that says whether the device's
 * presets match the library, and opens the write plan. It checks when the view opens, after
 * library changes and on "Check again"; it never polls. */
export function WriteBar({ deviceId, deviceName, notify, version, openRequest = 0 }: Props) {
  const [plan, setPlan] = useState<PushResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  const check = useCallback(async () => {
    const n = ++seq.current;
    setChecking(true);
    try {
      const p = await api.push(deviceId, { dry_run: true });
      if (n !== seq.current) return;
      setPlan(p);
      setError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setError((e as Error).message);
    } finally {
      if (n === seq.current) setChecking(false);
    }
  }, [deviceId]);

  useEffect(() => {
    const t = setTimeout(check, CHECK_DELAY_MS);
    return () => clearTimeout(t);
  }, [check, version]);
  useEffect(() => () => { seq.current++; }, []);   // a late answer after unmounting is dropped
  useEffect(() => { if (openRequest) setOpen(true); }, [openRequest]);

  let text: string;
  let state: "pending" | "differ" | "same" | "blocked" | "error";
  let action: string | null = null;
  if (error && !checking) {
    state = "error";
    text = `Couldn't check ${deviceName}: ${error}`;
  } else if (!plan) {
    state = "pending";
    text = `Checking ${deviceName} against the library…`;
  } else {
    const g = groupPlan(plan);
    const n = plan.changed_ids.length;
    const pals = plan.palettes?.length ?? 0;
    if (g.duplicates.length) {
      state = "blocked";
      text = `${deviceName}: ${g.duplicates.length === 1 ? `two looks want preset ${g.duplicates[0].preset_id}`
        : `looks share preset ids ${g.duplicates.map((d) => d.preset_id).join(", ")}`}; nothing can be written until each has its own`;
      action = "Review";
    } else if (n || pals) {
      state = "differ";
      text = `${deviceName}: ${n ? `${plural(n, "preset")} ${n === 1 ? "differs" : "differ"} from the library` : "presets match"}`
        + (pals ? `, ${plural(pals, "palette")} to upload` : "")
        + (g.decide.length ? `; ${plural(g.decide.length, "look")} waiting for your decision` : "");
      action = "Review and write";
    } else if (g.decide.length) {
      state = "differ";
      text = `${deviceName} is up to date, except ${plural(g.decide.length, "look")} whose effect changed`;
      action = "Review";
    } else {
      state = "same";
      text = `${deviceName} is up to date` + (plan.last_write ? ` (written ${when(plan.last_write)})` : "");
    }
    if (plan.drift) text += ". Its presets were changed outside this app since the last write.";
  }

  return (
    <div className={`write-dock ${state}`} aria-label="Write to device">
      {open && plan && (
        <WritePlan deviceId={deviceId} deviceName={deviceName} plan={plan} notify={notify}
          onWritten={(r) => { if (r.done) setOpen(false); check(); }} />
      )}
      <div className="row write-bar">
        <span className="grow" aria-live="polite">{text}{checking && plan ? " · checking…" : ""}</span>
        {action && (
          <button className={open ? "" : "primary"} disabled={!plan} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide the plan" : action}
          </button>
        )}
        {!action && open && <button onClick={() => setOpen(false)}>Hide the plan</button>}
        <button disabled={checking} onClick={check} title="Compare the device's presets with the library again (reads only)">
          Check again
        </button>
      </div>
    </div>
  );
}
