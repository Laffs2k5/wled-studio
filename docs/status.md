# Status and roadmap

Updated 2026-11-26. Milestones follow the plan's order: app first, firmware spikes alongside.

## Done

### Five-view app
- **Design:** live control, effects, segment layout/map, editing-session recovery, one-step Undo and
  **Save as look…**. Automatic live history keeps eight previous states in the browser and restores
  one only after a current-state hash check. The device status card reports WLED version, LED count,
  room/set/trial/session status, linked virtual twins and persisted firmware history. Saving a preset
  look offers a direct hand-off to Presets on device.
- **Library:** looks, playlists and palettes in one shared folder tree; inline organisation, drag/drop
  into folders/playlists, library editor, the studio file (export/import of the library, grids, protected
  ids, rooms and sets), earlier library versions to restore, and cross-device comparison.
- **Presets on device:** one write owner for the device set, named remote grids and their "also use"
  references, bank trials, drift/duplicate handling, device-only preset deletion and verified backup
  restore (refused for protected ids unless ticked, for the boot preset and for presets a playlist
  plays; a slot grid's ids are protected by themselves), and a print-ready visual remote layout.
- **Effect code:** ordered Edit → Compile → Preview/stream → Git, two-column on desktop and stacked on
  phones. Preview sound can be simulated, fixed, or sampled from the opt-in browser microphone.
  Compiler errors are marked in CodeMirror; compile-after-save is remembered and opt-in.
- **Firmware:** board/release build, gate, library preflight, device plan, flash and result/go-back.
  Any previous build can be repeated with exactly the same target and effect folders. Firmware
  flashing remains explicitly off in normal and deployed configurations.

- **Device comparison:** a missing effect can be replaced with a nearest-name suggestion after an
  explicit confirmation that the shared look changes for every device.

### Design and Library
- **Devices and the profile:** each effect's own controls from its metadata; live control through
  a whitelisted schema; token login in the UI.
- **The library:** looks by name, with each effect's metadata as it was when saved; capture and
  show; history of every change, restorable (the newest 500 kept).
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
- **Editing sessions:** "Remember what the strip shows now" remembers what the device shows, and
  says so while it runs ("Trying things since 23:34. Before that, the strip showed preset 3
  “Evening”."). "Put the strip back as it was" restores segments, effects, brightness and the mic;
  segments added meanwhile are deleted, and a running playlist is started again. "Keep what it
  shows now" ends the session without touching the device. Saving looks is not affected.

### Effect code and firmware
- **Effect code:** sound for sound effects in the preview (WLED's simulated beat with its four
  styles, or a fixed sound level, through the builder's `preview_audio`); a code editor for `./effects` (CodeMirror 6: C++ and JSON highlighting, folding, bracket matching, search and replace, multiple cursors, Tab indents, indent guides, a light or dark theme following the system); new effects from a template with a fixed effect
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
  - backend: pytest, 233 tests, 91 % coverage;
  - frontend: Vitest, 245 tests, above 90 % of statements;
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
2. **Flashing:** built 2026-11-24 and exercised end to end on the spare WROVER 2026-11-26. From a passed gate job, the
   Firmware view plans a flash for a device and runs it:
   - **the plan** (reads only): flashing enabled behind the client-certificate proxy, the gate
     passed, the image within the app slot, WLED's OTA lock off, the boot preset using no effect
     new in the image (a crash at boot would trip WLED's boot-loop handler, which resets the
     config), the library's changes (the preflight), and whether the app has the PIN;
   - **the flash**, with the device's name typed to confirm: backup (presets, cfg.json, info, the
     effect list), the image downloaded and its sha256 checked against the gate's, the upload to
     WLED's `/update` (WLED's release check never skipped), the wait for the reboot, then checks
     against the backup (the effect list is the image's, presets and config unchanged, free heap);
   - **the way back:** `/update?revert` for any device but a virtual one, also with the name typed.

   Completed on the spare: USB recovery, Improv Wi-Fi setup, the custom 16.0.1 OTA, post-flash
   effect/config/preset checks, and `/update?revert` back to stock. Left: the controller only,
   after the owner's separate go.
   Tested against the fake device, which models WLED 16's `/update` and `?revert`. The proxy
   is set up where the app is deployed (docs/security.md).
3. ~~Exact colours in the preview~~ (done 2026-11-24): previews compiled by the builder run
   WLED's own colour and palette code (wled-studio-builder's `preview/wled_colors.py`, from a pins
   file's WLED commit), and Effect code then offers all of WLED's palettes by name. The
   image's bundled preview is built the same way. Not in the preview: gamma, auto-white and the
   brightness limiter, which WLED applies on the way to the LEDs.
4. **Bulk tools** for the library. Done: renaming with playlists following, and where a look is
   used (2026-11-23); **folders and order** (2026-11-24): looks and playlists in folders (move one
   or several, rename or dissolve a folder, collapse it), moved up and down within their folder,
   or sorted A–Z. Folders and order are the library's own; nothing of them is written to a device,
   and a look saved again keeps its folder and place. **Per-device sets** (2026-11-24): a device
   takes everything in the library (the default) or its own set of looks and playlists; a playlist
   in a set brings the looks it plays. Writes, the change check and the preflight cover only what
   goes on the device. Copying between devices is adding to another device's set. Taking a look
   out of a set leaves its preset on the device: writing never deletes presets.
5. ~~A real code editor~~ (done 2026-11-24; see Decided design).

6. **A virtual WLED in the browser** (agreed 2026-11-24; phases 1–3 done): WLED's own built-in effects,
   segments, layers and blend modes compiled to WebAssembly from the firmware's checkout (as the
   exact colours are), so Design can work with no device: a "virtual device" with the
   firmware's real effect list (the builder's `effects.json`), moving, with the simulated beat.
   **Spiked 2026-11-24: feasible.** WLED 16.0.1's own effect code (`FX.cpp`, `FX_fcn.cpp`, 2D,
   the particle system, colours, palettes) compiles unchanged against a small `wled.h` of ours,
   links with 26 symbols of glue (the core being a virtual bus that keeps the pixels), and runs:
   the image's 220 effects, Twinklefox and the rest moving as on a device, 0.02 ms a frame for
   280 LEDs, 201 kB. Details and what's left: wled-studio-builder `spikes/virtual-wled/README.md`.
   **Built (2026-11-24), phases 1 and 2 of 4:** wled-studio-builder `virtual/` builds the twin of
   any firmware (its checkout, its own flags, its usermods), and the gate has a fifth check,
   `virtual_twin`: the twin runs every effect, its effect list is the image's, and no effect
   crashes that doesn't crash stock. A failure fails the gate, so the image can't be flashed. In
   CI on wled-studio-effects' real gate: the build's 68 flags gave the engine's 13, and 165
   effects ran, none crashing. The stock twin's 220 effects equal the real controller's.
   **Phase 3 built (2026-11-24): the virtual device.** The twin now also compiles WLED's state
   code (presets, playlists, transitions, `json.cpp`'s state functions), and wled-studio-builder's
   `virtual/server` puts it behind WLED's HTTP JSON API and websocket: the app adds it like any
   device (`docker compose --profile virtual`, host `virtual-device:8080`). WLED's own code applies
   states, saves and recalls presets, runs playlists and checks the PIN; the server keeps the
   device's files between restarts. It reports `arch: "virtual"`, so the app marks it virtual and
   the flash plan blocks it. DDP on UDP 4048 feeds WLED's own realtime pixels, so Effect code
   streams to a twin and the live view shows what was sent. Not in it: WLED's config code, other
   realtime/network inputs and firmware updates. Phase 4 is complete for streaming and device
   recognition. A real device can be linked to an added virtual twin from Device settings, with
   dashboard shortcuts in both directions.

   **A virtual device is always one firmware** (owner, 2026-11-24): built from that firmware's
   exact sources and build settings, the ones the builder already uses to reproduce it.
   - **Official:** a vendor release as pinned (QuinLED's 16.0.1 for a Dig-Next-2): the effect list
     a controller running it has.
   - **Ours:** the same plus our usermods, as a gate job builds it: a twin of an image before it is
     flashed.
   - **Checked:** the virtual build's effect list must equal the firmware's (the builder's
     `effects.json` for that image); a mismatch means it isn't a faithful twin. Build flags matter
     as much as the commit: 2D, the particle-system effects and sound support are compiled in or
     out per board.
   - **Faithful in:** the effects' logic, segments, layers, blend modes, palettes and colours.
     **Not in:** the hardware side (LED timing, gamma, white handling, the power limiter),
     performance (the chip's frame rate, its memory), random sequences, and sound (simulated, as
     on a device without a mic). It answers "what does this look like and how does it move", not
     "will the controller cope".
   - Later: link a real device to its virtual twin, to work offline on the firmware it runs.

**Known bugs, found 2026-11-24:**
- ~~The code editor hid effect folders with hyphens in their names~~ (fixed 2026-11-24): existing
  folders follow the builder's rule (`[A-Za-z0-9_-]`); a new one must still be a C identifier.
- ~~Without a bundled preview the code editor was hidden until the first compile~~ (fixed
  2026-11-24).

## Decided design

- **The code editor is CodeMirror 6, not Monaco** (2026-11-24). Both are MIT and actively
  developed; Monaco is VS Code's own editor. Decided by the CSP and the size:
  - Monaco writes `<style>` elements without a nonce, so it would need `style-src 'unsafe-inline'`
    (microsoft/monaco-editor#271, open since 2016). It also starts workers from `blob:` URLs unless
    configured otherwise, weighs about 1.4 MB gzipped for C++ and JSON, and doesn't support mobile.
  - CodeMirror in a **shadow root** styles itself with constructed stylesheets, which the CSP
    allows unchanged. Checked with 0 CSP reports in Chromium, Firefox and WebKit. It takes about
    175 kB gzipped, loaded only when a file is opened, and needs no workers.
  - **Given up:** Monaco's minimap and command palette. The common indent-guide add-on
    (`@replit/codemirror-indentation-markers`) hasn't had a release since 2024, so the guides are
    our own (`indentGuides.ts`, about 80 lines).
  - **Dependencies:** CodeMirror is mostly one lead developer's work. In 2026 its repositories moved
    from GitHub to code.haverbeke.berlin (npm points there). Worth watching.
- **The app follows the system's light or dark mode** (2026-11-24), the editor included. The LED
  previews stay on black in both.

- **Preset banks for a remote stay outside the app:** the home-automation system switches banks; the
  app builds the looks and writes them to the bank slots. **The slot grid** (2026-11-24) is a view
  for that: a block of preset ids as rows and columns, shaped by the user (rows, columns, first id,
  steps, a name pattern), showing which look or playlist sits in each slot. Filling moves a saved
  item to that id, or keeps its primary id and writes an additional grid reference at the slot's id.
  The library stores one source item; copies exist only in an individual push plan. On the device,
  whatever sits on a slot's id is named by the grid's pattern (fixed 2026-11-27: a moved item kept
  its plain name). No remote, bank or cue logic in the app.
- **Editing sessions and home automation:** the user flags "editing" in the home-automation system
  by hand; the app holds no token for it.
- **Access:** on the LAN with the bearer token; a reverse proxy with client certificates (mTLS)
  before flashing from the app is enabled; never exposed to the internet.

## Waiting on

- **Installed hardware:** the first flash/revert rehearsal is complete on the spare WROVER; the
  next write waits for the owner's separate go-ahead to use the installed controller.
