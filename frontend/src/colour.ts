// SPDX-License-Identifier: EUPL-1.2
import type { Colour } from "./types";

export function toHex(c: Colour | undefined): string {
  const [r, g, b] = c ?? [0, 0, 0];
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string, w?: number): Colour {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a colour: ${hex}`);
  const rgb = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return w === undefined ? rgb : [...rgb, w];
}
