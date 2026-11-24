// SPDX-License-Identifier: EUPL-1.2
import type { FirmwareJob } from "./api";

/** One of the gate's checks, as the user reads it: the outcome, why it failed, what it means. */
export interface GateLine { ok: boolean; text: string; meaning: string }

type Report = NonNullable<FirmwareJob["report"]>;

const CANT = "This image can't be flashed.";
const few = (xs: string[], n = 3) => xs.slice(0, n).join(", ") + (xs.length > n ? `, and ${xs.length - n} more` : "");
const because = (reason: string) => (reason ? `: ${reason}` : "");

/** The stock check's reasons (the builder's "check" list), with the build machine named plainly. */
function stockReason(r: Report): string {
  return (r.stock?.check ?? []).map((c) => c.replace(/^no verified result for toolchain host '(.+)' yet$/,
    "no verified result for this build machine ($1) yet")).join("; ");
}

const LINES: Record<string, (ok: boolean, r: Report) => GateLine> = {
  stock_matches_verified: (ok, r) => ok
    ? { ok, text: "The rebuilt vendor image matches the verified one",
        meaning: "This build machine makes the vendor's firmware exactly, so anything new in your image comes from your effects." }
    : { ok, text: `The rebuilt vendor image doesn't match the verified one${because(stockReason(r))}`,
        meaning: `${CANT} Nothing is wrong with your effect code: the vendor's own firmware didn't come out as verified here.` },
  only_usermod_objects_changed: (ok, r) => {
    if (ok) return { ok, text: "Only your effect code was added", meaning: "Everything else in the image is the vendor's code, unchanged." };
    const unexpected = r.objects?.unexpected ?? [];
    const reason = unexpected.length ? `${unexpected.length} other file${unexpected.length === 1 ? "" : "s"} differ (${few(unexpected)})`
      : r.objects && !(r.objects.added_from_usermods ?? r.objects.added).length ? "your effects added no code" : "";
    return { ok, text: `Something besides your effect code changed${because(reason)}`,
      meaning: `${CANT} It must be the vendor's firmware with only your effects added.` };
  },
  fits_app_slot: (ok, r) => {
    const size = r.custom?.firmware_size, slot = r.app_slot_bytes;
    const pct = size && slot ? Math.round((size / slot) * 100) : null;
    return ok
      ? { ok, text: `Fits the firmware slot${pct !== null ? ` (${pct} % used)` : ""}`,
          meaning: "The device has room for it, with a safety margin left free." }
      : { ok, text: `Too big for the firmware slot${pct !== null ? ` (${pct} % of it, past the safety margin)` : ""}`,
          meaning: `${CANT} Build it with fewer effects.` };
  },
  virtual_twin: (ok, r) => {
    const v = r.virtual;
    if (ok) {
      return { ok, text: `All ${v?.effects_run ? `${v.effects_run} ` : ""}effects ran in the virtual twin without crashing`,
        meaning: "The virtual twin is this image's own WLED code, run on the build machine with no device at stake." };
    }
    const reason = v?.crashed?.length ? `${few(v.crashed)} crashed` : v?.error ?? "";
    return { ok, text: `An effect failed in the virtual twin${because(reason)}`,
      meaning: `${CANT} An effect that crashes in the twin would likely crash the device too.` };
  },
};

/** The gate report's checks in plain words, in the builder's order. */
export function gateLines(report: Report | undefined): GateLine[] {
  return Object.entries(report?.checks ?? {}).map(([key, ok]) => LINES[key]?.(ok, report!) ?? (ok
    ? { ok, text: "A further check by the builder passed", meaning: "" }
    : { ok, text: "A further check by the builder failed", meaning: `${CANT} The build log says why.` }));
}
