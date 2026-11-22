// SPDX-License-Identifier: EUPL-1.2
import type { DeviceState, Effect, Profile } from "../types";

export const comet: Effect = {
  id: 8, name: "Comet", palette: true, dimensions: [1], audio: [], defaults: { sx: 128 }, defined: true,
  colours: ["Fx", "Bg"],
  controls: [
    { key: "sx", label: "Speed", kind: "slider", min: 0, max: 255, default: 128 },
    { key: "ix", label: "Tail", kind: "slider", min: 0, max: 255, default: null },
    { key: "o1", label: "Reverse", kind: "checkbox", min: 0, max: 1, default: null },
  ],
};

export const meter: Effect = {
  id: 5, name: "Pulse Meter", palette: true, dimensions: [1], audio: ["volume"], defaults: {}, defined: true,
  colours: ["Fx"], controls: [{ key: "sx", label: "Gain", kind: "slider", min: 0, max: 255, default: null }],
};

export const waves: Effect = {
  id: 7, name: "Panel Waves", palette: true, dimensions: [2], audio: [], defaults: {}, defined: true,
  colours: ["Fx"], controls: [],
};

export const solid: Effect = {
  id: 0, name: "Solid", palette: false, dimensions: [], audio: [], defaults: {}, defined: true, colours: [], controls: [],
};

export const profile: Profile = {
  device: { id: "desk", name: "Desk" },
  info: { ver: "16.0.1", product: "FakeDevice" },
  leds: { count: 60, rgbw: true, maxseg: 32, matrix: null },
  usermods: ["AudioReactive"],
  effects: [solid, meter, waves, comet],
  palettes: [{ id: 0, name: "Default" }, { id: 3, name: "Sunset Haze" }],
  fingerprint: "f".repeat(64),
};

export const state: DeviceState = {
  on: true, bri: 128, AudioReactive: { on: false },
  seg: [{ id: 0, start: 0, stop: 60, on: true, bri: 255, fx: 8, pal: 0, col: [[255, 0, 0, 10], [0, 0, 0, 0]],
    sx: 100, ix: 50, c1: 0, c2: 0, c3: 0, o1: false, o2: false, o3: false }],
};
