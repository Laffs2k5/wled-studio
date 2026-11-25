// SPDX-License-Identifier: EUPL-1.2
import type { CheckItem } from "../types";

// a quoted name as the backend writes it (Python's repr: '…', or "…" when it holds a ')
const NAME = `(?<q>['"])(?<name>.*)\\k<q>`;
const PLAIN: [RegExp, (m: RegExpMatchArray, where: string) => string][] = [
  [new RegExp(`^effect ${NAME} isn't on this device$`), (m, w) => `Uses effect “${m.groups?.name}”, which ${w} does not have.`],
  [new RegExp(`^palette ${NAME} isn't on this device$`), (m, w) => `Uses palette “${m.groups?.name}”, which ${w} does not have.`],
  [new RegExp(`^(wall|zone) ${NAME} isn't in this device's room model$`),
    (m, w) => `Uses ${m[1]} “${m.groups?.name}”, which isn't in the room shape of ${w}.`],
  [new RegExp(`^${NAME} is unavailable$`), (m, w) => `Plays “${m.groups?.name}”, which ${w} can't show.`],
  [new RegExp(`^${NAME} is review$`), (m, w) => `Plays “${m.groups?.name}”, whose effect has different controls on ${w}.`],
  [new RegExp(`^${NAME} is check$`), (m, w) => `Plays “${m.groups?.name}”, whose effect changed a little on ${w}.`],
  [new RegExp(`^${NAME} is remapped$`), (m, w) => `Plays “${m.groups?.name}”, whose effect has another number on ${w}.`],
];

// how an effect's controls changed since a look was saved (the backend's library.compare_meta)
const LAZY_NAME = `(?<q>['"])(?<name>.*?)\\k<q>`;
const CHANGED = new RegExp(`^${LAZY_NAME} changed: (?<rest>.*)$`);
const RENUMBERED = new RegExp(`^${LAZY_NAME}: id \\d+ -> \\d+$`);
const FOLLOWS = /^segment (?<seg>\d+) follows (?<kind>wall|zone) (?<q>['"])(?<area>.*)\k<q> to LEDs (?<a>\d+)-(?<b>\d+)$/;
const SLIDERS = new Set(["sx", "ix", "c1", "c2", "c3"]);
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** An effect's changes ("Smear (o2) is gone; ix relabelled: Blur -> Width") counted in words:
 * "1 slider renamed, 1 option removed". Reasons it doesn't know are kept as they are. */
export function summariseChanges(reasons: string[]): string[] {
  const tally = new Map<string, number>();
  const other: string[] = [];
  const add = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);
  const kind = (key: string) => (SLIDERS.has(key) ? "slider" : "option");
  for (const r of reasons) {
    let m: RegExpMatchArray | null;
    if ((m = r.match(/^.+ \((\w+)\) is gone(, not set by this look)?$/))) add(`${kind(m[1])}|removed`);
    else if ((m = r.match(/^(\w+) relabelled: /))) add(`${kind(m[1])}|renamed`);
    else if ((m = r.match(/^new control .+ \((\w+)\)$/))) add(`${kind(m[1])}|added`);
    else if (r === "now sound-reactive") other.push("it now reacts to sound");
    else if (r === "no longer sound-reactive") other.push("it no longer reacts to sound");
    else if (r.startsWith("sound input changed")) other.push("it reacts to other sound input");
    else if ((m = r.match(/^dimensions changed: (.+) -> (.+)$/))) other.push(`it is now ${m[2]} instead of ${m[1]}`);
    else if ((m = r.match(/^colour slots: (\d+) -> (\d+)$/))) other.push(`fewer colours (${m[2]} instead of ${m[1]})`);
    else if (r === "no longer uses a palette") other.push("it no longer uses a palette");
    else if (r.startsWith("metadata text changed")) other.push("default values changed");
    else other.push(r);
  }
  const counted = ["removed", "renamed", "added"].flatMap((what) => ["slider", "option"].flatMap((k) => {
    const n = tally.get(`${k}|${what}`);
    return n ? [`${count(n, k)} ${what}`] : [];
  }));
  return [...counted, ...other];
}

/** A check's notes in plain words, one sentence each: why a look can't be shown on `where` (a device's
 * name, or "this firmware"), or how its effect changed there since the look was saved. */
export function explain(item: CheckItem | undefined, where = "this device"): string {
  const on = where === "this firmware" ? "in this firmware" : `on ${where}`;
  return (item?.notes ?? []).map((n) => {
    for (const [re, say] of PLAIN) {
      const m = n.match(re);
      if (m) return say(m, where);
    }
    let m = n.match(CHANGED);
    if (m?.groups) {
      const what = summariseChanges(m.groups.rest.split("; ")).join(", ");
      return item?.status === "review"
        ? `The effect “${m.groups.name}” ${on} has different controls than when this look was saved (${what}). The look may not look the same.`
        : `The effect “${m.groups.name}” ${on} changed a little since this look was saved (${what}). The look should look the same.`;
    }
    if ((m = n.match(RENUMBERED))?.groups) {
      return `The effect “${m.groups.name}” has another number ${on} than when this look was saved. The app finds it by name, so the look is the same.`;
    }
    if ((m = n.match(FOLLOWS))?.groups) {
      return `Segment ${m.groups.seg} follows ${m.groups.kind} “${m.groups.area}” (LEDs ${m.groups.a}–${m.groups.b}).`;
    }
    return n;
  }).join("\n");
}

/** A check's notes in plain words, with the backend's own wording behind "Details" when it differs. */
export function Notes({ item, where }: { item: CheckItem; where?: string }) {
  const plain = explain(item, where);
  const raw = item.notes.join("\n");
  if (!plain) return null;
  return (
    <>
      {plain.split("\n").map((line, i) => <span key={i} className="note-line">{line}</span>)}
      {plain !== raw && (
        <details className="raw-notes small muted"><summary>Details</summary>{item.notes.map((n, i) => <div key={i}>{n}</div>)}</details>
      )}
    </>
  );
}

/** The effects a check's change notes are about. */
export function changedEffects(item: CheckItem | undefined): string[] {
  return (item?.notes ?? []).flatMap((n) => {
    const m = n.match(CHANGED) ?? n.match(RENUMBERED);
    return m?.groups ? [m.groups.name] : [];
  });
}

/** The badge's word for each status the change check gives. */
export const STATUS_WORD: Record<string, string> = {
  review: "effect changed", check: "effect updated", remapped: "effect renumbered",
};

/** A look's or playlist's change-check status on the device, with the reasons; nothing when ok.
 * `where` names the device (or the firmware) in the reasons; `image`: the status is with a built
 * image's effects, not the device's. */
export function StatusBadge({ item, where, image = false }: { item?: CheckItem; where?: string; image?: boolean }) {
  if (!item || item.status === "ok") return null;
  const text = item.status === "unavailable" ? (image ? "not in this firmware" : "not on this device") : STATUS_WORD[item.status] ?? item.status;
  const why = explain(item, where ?? (image ? "this firmware" : "this device"));
  return (
    <span className={`badge check-${item.status}`} title={why} aria-label={`${text}: ${why.split("\n").join("; ")}`}>
      {text}
    </span>
  );
}

/** Statuses a new snapshot clears: the effect is still there, only its id or metadata moved. */
export const ACCEPTABLE = new Set(["remapped", "check", "review"]);
