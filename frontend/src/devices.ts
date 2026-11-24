// SPDX-License-Identifier: EUPL-1.2
import type { Device } from "./types";

/** What marks a virtual WLED (WLED's code in a container) wherever devices are listed or picked. */
export const VIRTUAL = "virtual (no LEDs)";

/** A device's name for lists and pickers, marked when it's virtual. */
export const deviceLabel = (d: Device) => (d.virtual ? `${d.name} · ${VIRTUAL}` : d.name);
