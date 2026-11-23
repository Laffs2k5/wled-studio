// SPDX-License-Identifier: EUPL-1.2
// Loads the WebAssembly effect preview (preview/ in this repo, built into /preview/).
import { parseMeta } from "./fxmeta";
import type { Effect, Segment } from "./types";

interface PreviewModule {
  _preview_setup(len: number): void;
  _preview_effect_count(): number;
  _preview_effect_name(id: number): number;
  _preview_effect_metadata(id: number): number;
  _preview_select(id: number): number;
  _preview_set(key: number, value: number): void;
  _preview_length(): number;
  _preview_frame(now: number): number;
  /** The preview's "mic": a volume 0-255, or < 0 for none (sound effects then simulate). Builds
   * before 2026-11-23 don't have it. */
  _preview_audio?(level: number): void;
  UTF8ToString(ptr: number): string;
  HEAPU32: Uint32Array;
}

export const KEYS: Record<string, number> = { sx: 0, ix: 1, c1: 2, c2: 3, c3: 4, o1: 5, o2: 6, o3: 7, pal: 8, si: 12 };

export class Preview {
  constructor(private m: PreviewModule) {}

  static async load(url = "/preview/preview.mjs", length = 60): Promise<Preview> {
    const mod = await import(/* @vite-ignore */ url);
    const p = new Preview(await mod.default());
    p.m._preview_setup(length);
    return p;
  }

  effects(): Effect[] {
    const out: Effect[] = [];
    for (let id = 0; id < this.m._preview_effect_count(); id++) {
      const name = this.m.UTF8ToString(this.m._preview_effect_name(id));
      if (name.includes("RSVD")) continue;
      out.push(parseMeta(id, name, this.m.UTF8ToString(this.m._preview_effect_metadata(id))));
    }
    return out;
  }

  select(id: number) { return this.m._preview_select(id); }

  /** Change the strip length (e.g. to a device's LED count). */
  resize(length: number) { this.m._preview_setup(length); }

  length() { return this.m._preview_length(); }

  /** Apply a segment patch (the same shape the live controls produce). */
  set(patch: Partial<Segment>) {
    for (const [k, v] of Object.entries(patch)) {
      if (k in KEYS) this.m._preview_set(KEYS[k], Number(v));
      if (k === "col" && Array.isArray(v)) {
        (v as number[][]).forEach((c, i) => {
          const [r = 0, g = 0, b = 0, w = 0] = c ?? [];
          this.m._preview_set(9 + i, ((w << 24) | (r << 16) | (g << 8) | b) >>> 0);
        });
      }
    }
  }

  /** Whether this build can be fed sound (preview_audio). */
  hasSound() { return typeof this.m._preview_audio === "function"; }

  /** Feed sound to sound effects: a level 0-255, or null for WLED's simulated beat. */
  sound(level: number | null) { this.m._preview_audio?.(level === null ? -1 : level); }

  frame(now: number): Uint32Array {
    const ptr = this.m._preview_frame(now) >>> 2;
    return this.m.HEAPU32.slice(ptr, ptr + this.m._preview_length());
  }
}

/** Pixels (0xWWRRGGBB) -> a stream message: 4 (RGBW), then R, G, B, W per pixel. */
export function frameMessage(px: Uint32Array): Uint8Array {
  const out = new Uint8Array(1 + px.length * 4);
  out[0] = 4;
  px.forEach((c, i) => {
    out[1 + i * 4] = (c >> 16) & 255;
    out[2 + i * 4] = (c >> 8) & 255;
    out[3 + i * 4] = c & 255;
    out[4 + i * 4] = (c >>> 24) & 255;
  });
  return out;
}
