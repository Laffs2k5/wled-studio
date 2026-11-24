// SPDX-License-Identifier: EUPL-1.2
import type { Device } from "./types";

/** What marks a virtual WLED (WLED's code in a container) wherever devices are listed or picked. */
export const VIRTUAL = "virtual (no LEDs)";

/** A device's name for lists and pickers, marked when it's virtual. */
export const deviceLabel = (d: Device) => (d.virtual ? `${d.name} · ${VIRTUAL}` : d.name);

const DEVICE_KEY = "wledstudio.device";

/** The device picked in the header, remembered in this browser across reloads. */
export const rememberedDevice = {
  get: (): string | null => {
    try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
  },
  set: (id: string | null) => {
    try { id ? localStorage.setItem(DEVICE_KEY, id) : localStorage.removeItem(DEVICE_KEY); } catch { /* storage off */ }
  },
};

/** The header's device select: every view works on the device chosen there. */
export const DEVICE_SELECT_ID = "device-select";

export function focusDeviceSelect() {
  const el = document.getElementById(DEVICE_SELECT_ID);
  el?.scrollIntoView?.({ block: "nearest" });
  el?.focus();
}
