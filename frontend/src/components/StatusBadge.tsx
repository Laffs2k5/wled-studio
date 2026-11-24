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
];

/** A check's notes in plain words: why a look can't be shown on `where` (a device's name, or "this image"). */
export function explain(item: CheckItem | undefined, where = "this device"): string {
  return (item?.notes ?? []).map((n) => {
    for (const [re, say] of PLAIN) {
      const m = n.match(re);
      if (m) return say(m, where);
    }
    return n;
  }).join("\n");
}

/** A look's or playlist's change-check status on the device, with the reasons; nothing when ok.
 * `where` names the device (or the image) in the reasons; `image`: the status is with a built
 * image's effects, not the device's. */
export function StatusBadge({ item, where, image = false }: { item?: CheckItem; where?: string; image?: boolean }) {
  if (!item || item.status === "ok") return null;
  const text = item.status === "unavailable" ? (image ? "not in this image" : "not on this device") : item.status;
  const why = explain(item, where ?? (image ? "this image" : "this device"));
  return (
    <span className={`badge check-${item.status}`} title={why} aria-label={`${text}: ${why.split("\n").join("; ")}`}>
      {text}
    </span>
  );
}

/** Statuses a new snapshot clears: the effect is still there, only its id or metadata moved. */
export const ACCEPTABLE = new Set(["remapped", "check", "review"]);
