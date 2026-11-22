# Status and roadmap

Updated 2026-11-23. Milestones follow the plan's order: app first, firmware spikes alongside.

## Done

- **M1, the thin slice (look studio):**
  - devices; profile with each effect's own controls;
  - live control through a whitelisted schema;
  - import presets into a library keyed by name; capture and show looks;
  - write `presets.json` with backup, drift check, PIN handling and read-back verification.
- **Security baseline** (docs/security.md).
- **Tests:** backend 90 (92 % coverage), frontend 19 (93 % of statements), plus an end-to-end smoke
  test against the containers with the fake device.
- **Packaging:** Dockerfile, `compose.yaml` with a demo profile, CI that builds, tests and publishes
  to ghcr.io.

## Next (in order)

1. **Token login in the UI** (for LAN use with `WLEDSTUDIO_TOKEN`).
2. **Look editing in the library**, not only capture: per-segment fields, layers and blend modes,
   the mic per look (with the mic on/off rule).
3. **Playlists** (looks as entries; durations, transitions, repeat, shuffle).
4. **Custom palettes** (gradient editor, upload with the PIN).
5. **Live preview** from the device's live view (one websocket client per device; the backend owns
   it and fans it out).
6. **Full change check UI:** a status per look, accept-review flow, preflight against a builder
   manifest.
7. **Room model:** pixel positions per LED for a room-shaped preview.
8. **The effect studio:** the browser preview (WebAssembly shim) and DDP streaming, then build jobs
   through wled-studio-builder.

## Waiting on

- **Hardware:** a spare ESP32 (ordered) for the first flash of a self-built image. Nothing in this
  repo needs it yet.
- **Real-device testing of writes:** the owner's bench was read-only during the first build;
  everything that writes was tested against the fake device only.
