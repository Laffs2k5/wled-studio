// SPDX-License-Identifier: EUPL-1.2
import type { CheckItem } from "../types";

/** A look's or playlist's change-check status on the device, with the reasons; nothing when ok. */
export function StatusBadge({ item }: { item?: CheckItem }) {
  if (!item || item.status === "ok") return null;
  const why = item.notes.join("\n");
  return (
    <span className={`badge check-${item.status}`} title={why} aria-label={`${item.status}: ${item.notes.join("; ")}`}>
      {item.status}
    </span>
  );
}

/** Statuses a new snapshot clears: the effect is still there, only its id or metadata moved. */
export const ACCEPTABLE = new Set(["remapped", "check", "review"]);
