# Status and roadmap

Updated 2026-11-23. Milestones follow the plan's order: app first, firmware spikes alongside.

## Done

### Look studio
- **Devices and the profile:** each effect's own controls from its metadata; live control through
  a whitelisted schema; token login in the UI.
- **The library:** looks by name, with each effect's metadata as it was when saved; capture and
  show; history of every change.
  - **Import** keeps every field WLED saves in a preset (and an `id` only where there was one), so
    an import followed by a write leaves unchanged presets unchanged.
  - **Writing** `presets.json`: backup, drift check, PIN, read-back verification.
- **The segment layout, live:** add and remove segments; bounds by LED or by wall; on, reverse,
  mirror, grouping, spacing, offset; opacity and WLED 16's 17 blend modes. **Looks own their
  layout** as WLED's presets do: showing one deletes the segments it doesn't use.
- **Segment editing comforts:** raise and lower a segment in the stack (WLED draws in id order);
  duplicate one on top; names; freeze; sound simulation for sound effects; a **segment map** that
  shows where every segment is, selects one with a click and sets its LEDs by dragging; and looks
  saved **without the layout**, which change only the segments they name, like WLED presets saved
  without bounds.
- **Editing a saved look without showing it:** "Edit" in the look list opens the stored look as
  this device's segments, with the same tools as live editing and an effect picker; saving goes
  through the same path as capture, and nothing is sent to the strip. An imported look saved
  unchanged keeps its preset unchanged.
- **The room model:** the strip's shape as walls in LED order, and **named zones** (a door, a desk:
  LED ranges) that looks follow like walls. The live view and the effect
  preview are drawn in it. **Segments named by wall or zone** follow it when its boundaries are
  corrected.
  **Room-aware effects** get each LED's position in `room_map.h`.
- **The mic per look,** by a rule: a look made for sound switches the mic on, any other look
  switches it off.
- **Playlists:** looks by name, durations, shuffle, an end look; unchanged playlists aren't
  rewritten.
- **Custom palettes:** a gradient editor; kept by name; uploaded as `palette<i>.json` with stable
  indexes per device, before the presets that use them.
- **Live view** of the device, relayed by the backend: one device connection shared by all viewers.
- **The change check:** each look and playlist shows its status on the device with the reasons in
  words (a control the look sets is gone, now sound-reactive, 1D → 2D, fewer colour slots, …); a
  playlist takes the worst status of its looks. **Accept** takes the device's version as the new
  reference.
- **Editing sessions:** "Start editing session" remembers what the device shows. "Done" puts it
  back: segments, effects, brightness and the mic; segments added meanwhile are deleted, and a
  running playlist is started again. "Keep my changes" ends the session without touching the
  device.

### Effect studio and firmware
- **Effect studio:** sound for sound effects in the preview (WLED's simulated beat with its four
  styles, or a fixed sound level, through the builder's `preview_audio`); a code editor for `./effects`; new effects from a template with a fixed effect
  id; compiled unchanged to WebAssembly through the builder's job service and animated in the
  browser with each effect's own controls; the preview **streamed to the strip** (DDP).
- **Firmware builds from the app:** gate jobs on wled-studio-builder's job service. The vendor's
  stock image is checked first, then only your code may differ.
- **Preflight before flashing:** for a passed gate job, the Firmware view checks the library
  against the image's effect list (from wled-studio-builder's `effects.json`) for a chosen device:
  each look's and playlist's status today and with that image, with what would change.
- **The firmware profile end to end** (CI, `firmware-e2e`): from the published images, the builder
  behind its egress allowlist, which refuses direct egress, other hosts, and IP addresses that pass
  only on their reverse DNS. A real preview job and a real gate build are started through the app's
  API, and both pass.

### Quality
- **Security baseline** ([security.md](security.md)).
- **Tests:**
  - backend: pytest, 155 tests, 94 % coverage;
  - frontend: Vitest, 67 tests, 94 % of statements;
  - browser tests (Playwright, Chromium) and a smoke test against the containers with the fake
    device;
  - the firmware profile end to end.
- **Packaging:** Dockerfile, `compose.yaml` with demo and firmware profiles; CI builds, tests and
  publishes to ghcr.io.

## Next (in order)

1. ~~A real device~~ (done 2026-11-23, on a WLED 16 controller): presets, the change check, live
   control, segment layouts, editing sessions and the look editor (one bug found and fixed: the
   editor saved display defaults); **custom palette uploads** (written and loaded at once); and
   **DDP streaming** (WLED in DDP live mode; a known block read back from its live view at exactly
   the LEDs sent, RGBW layout right). Notes from it:
   - WLED doesn't unload a custom palette when its file is deleted (`/edit?func=delete`); it stays
     in memory until the next upload or reboot. A future "delete palette on the device" must say so;
   - WLED's live view reads zeros while the strip is off, even during a stream.
2. **Flashing** a gate-passed image over the air, with a backup first and `/update?revert` as the
   way back; a spare board first.
3. **Exact colours in the preview:** WLED's own colour and palette helpers from the checkout,
   instead of the stand-ins.
4. **Bulk tools** for the library: folders, reorder, copying between devices. (Renaming, with
   playlists following, and where a look is used: done 2026-11-23.)

## Decided design

- **Preset banks for a remote stay outside the app:** the home-automation system switches banks; the
  app builds the looks and writes them to the bank slots. A grid view of those slots may come later.
- **Editing sessions and home automation:** the user flags "editing" in the home-automation system
  by hand; the app holds no token for it.
- **Access:** on the LAN with the bearer token; a reverse proxy with client certificates (mTLS)
  before flashing from the app is enabled; never exposed to the internet.

## Waiting on

- **Hardware:** a spare ESP32 (ordered) for the first flash of a self-built image.
- **A real device for writes** (Next, 1).
