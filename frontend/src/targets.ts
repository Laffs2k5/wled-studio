// SPDX-License-Identifier: EUPL-1.2
// Which firmware build target fits a device.
//
// The builder names a target by its pins file's release ("quinled-16.0.1") and the vendor's
// build environment ("dig-next-2"). A device says what it runs in /json/info: `release` (the
// vendor's release name, "Dig-Next-2" on QuinLED's builds), `product`, and `ver` ("16.0.1").
// A target fits when the device's release name or product is the target's environment, ignoring
// case and punctuation, and the pins' release ends in the device's version. Nothing else is
// mapped: a vendor whose names differ needs a line here.
import type { FirmwareTarget } from "./api";

/** How a target relates to a device: built for it, for its board but another release, or for another board. */
export type Fit = "match" | "other-release" | "other-board";

type Info = Record<string, string | number | null | undefined>;

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The target's fit for a device, or null when the device doesn't say its board. */
export function targetFit(t: FirmwareTarget, info: Info | null | undefined): Fit | null {
  const boards = [info?.release, info?.product].map(norm).filter(Boolean);
  if (!boards.length) return null;
  if (!boards.includes(norm(t.target))) return "other-board";
  const ver = norm(info?.ver);
  return ver && norm(t.release).endsWith(`-${ver}`) ? "match" : "other-release";
}

/** The target built for this device's board and release, if the builder has one. */
export const matchingTarget = (targets: FirmwareTarget[], info: Info | null | undefined) =>
  targets.find((t) => targetFit(t, info) === "match");

export const targetKey = (t: Pick<FirmwareTarget, "pins" | "target">) => `${t.pins}|${t.target}`;

/** A target as the user reads it: "dig-next-2 · quinled-16.0.1". */
export const targetName = (t: Pick<FirmwareTarget, "release" | "target">) => `${t.target} · ${t.release}`;

/** What a device says it runs, for a sentence: "Dig-Next-2, WLED 16.0.1". */
export function boardName(info: Info | null | undefined): string {
  const board = info?.release || info?.product;
  return [board, info?.ver ? `WLED ${info.ver}` : ""].filter(Boolean).join(", ");
}
