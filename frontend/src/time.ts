// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";

/** Seconds as m:ss ("0:07", "3:25"). */
export function elapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A moment (Unix seconds) as people say it: "today 23:54", "yesterday 08:10", "24 Nov 23:54". */
export function when(unix: number, now = new Date()): string {
  const d = new Date(unix * 1000);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (days === 0) return `today ${clock(d)}`;
  if (days === 1) return `yesterday ${clock(d)}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${clock(d)}`;
}

/** A time of day (Unix seconds) as "23:54". */
export const timeOfDay = (unix: number) => clock(new Date(unix * 1000));

/** Seconds since `since` (Unix seconds), counting up once a second; null when `since` is null. */
export function useElapsed(since: number | null): number | null {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now() / 1000);
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? null : Math.max(0, now - since);
}
