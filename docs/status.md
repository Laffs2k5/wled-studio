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
- **Firmware builds from the app:** a Firmware view that runs gate jobs on wled-studio-builder's
  job service (`docker compose --profile firmware`): your usermods from `./effects`, the vendor's
  stock image checked first, then only your code may differ. Flashing from the app isn't built
  (it waits for a spare board and the owner's go).
- **Effect studio, first slice:** effect usermods written for WLED, compiled unchanged to
  WebAssembly and animated in the browser with each effect's own controls:
  - the image ships the example effect's preview;
  - **"Compile and preview"** compiles your own effects from `./effects` through the builder's job
    service (`--profile firmware`; Emscripten is installed into its work volume on first use).

  Colours and fades are approximate. WLED's built-in effects aren't previewed; the device's live
  view is their preview. The compiler shim lives in wled-studio-builder (`preview/`).
- **Packaging:** Dockerfile, `compose.yaml` with a demo profile, CI that builds, tests and publishes
  to ghcr.io.

## Next (in order)

1. ~~Token login in the UI~~ (done 2026-11-23).
2. **Look editing in the library** beyond capture-and-show: per-segment fields, layers and blend
   modes. (Done 2026-11-23: the **mic per look**, by the rule: a look made for sound switches the mic
   on, any other look switches it off.)
3. ~~Playlists~~ (done 2026-11-23: looks by name, durations, shuffle, an end look; imported from and
   written to the device, unchanged playlists not rewritten).
4. ~~Custom palettes~~ (done 2026-11-23: a gradient editor; kept by name; uploaded as WLED's
   `palette<i>.json` with stable file indexes per device, before the presets that use them; WLED
   reloads them on upload, per its source. Not yet tried on a real device).
5. **Live preview** from the device's live view (one websocket client per device; the backend owns
   it and fans it out).
6. **Full change check UI:** a status per look, accept-review flow, preflight against a builder
   manifest.
7. **Room model:** pixel positions per LED for a room-shaped preview.
8. **The effect studio, next:**
   - a code editor (today effects are edited as files in `./effects`);
   - exact colours (WLED's helpers from the user's checkout);
   - streaming the preview to the strip over DDP.
9. **Flashing** a gate-passed image over the air, with a backup first and `/update?revert` as the
   way back; spare board first.

## Waiting on

- **Hardware:** a spare ESP32 (ordered) for the first flash of a self-built image. Nothing in this
  repo needs it yet.
- **Real-device testing of writes:** the owner's bench was read-only during the first build;
  everything that writes was tested against the fake device only.
