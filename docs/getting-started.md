# Getting started

wled-studio runs as a container next to your WLED devices, and you use it in a browser on a proper
screen. This guide goes from the first start to building firmware with an effect of your own.

## 1. Start it

```bash
git clone https://github.com/Laffs2k5/wled-studio && cd wled-studio
docker compose up -d                    # http://localhost:8080
```

- **To try it without a device:** `docker compose --profile demo up -d`, then add the device
  `demo-device:8081` (a fake WLED with made-up effects).
- **To try it on a virtual WLED:** `docker compose --profile virtual up -d`, then add the device
  `virtual-device:8080`. It runs WLED's own code (QuinLED's 16.0.1: its effects, presets, playlists
  and API) with no hardware, so looks, presets and playlists behave as on a device. The first start
  builds it (several minutes). The app marks it **virtual (no LEDs)**; it can't be flashed or
  reverted, and the Effect studio's DDP stream doesn't reach it.
- **To use it from another machine:** read [security.md](security.md#using-it-from-other-machines)
  first. In short, publish the port, add the name you browse to to `WLEDSTUDIO_ALLOWED_HOSTS`, and
  set `WLEDSTUDIO_TOKEN`.

## 2. Add a device

**Add device**, with a name and the host (`wled-kitchen.local`, `192.168.1.40`, …). Hosts must be
on your network; public addresses are refused unless you allow them.

The **Device** select in the header picks the device you work on, in every view: Looks & effects,
the Slot grid's write bar, the Effect studio's preview and room map, and the device Firmware
checks and flashes. The browser remembers it across reloads. Headings that name the device have a
**Change device** link back to it.

If the device has a **settings PIN** (WLED → Security), set it with the **PIN** button. It's needed
only to write presets and palettes, and it's never shown again.

## 3. Looks: effects with their own controls

The effect list shows the device's effects (2D-only effects are hidden on strips; ♪ marks
sound-reactive ones). Picking one shows **only the controls that effect uses, with its own labels**,
read from WLED's effect metadata. Changes go to the strip at once.

- **Import from device** turns the device's presets into looks, **by name**. A look keeps the
  effect's and palette's names, not their numbers, so it survives firmware changes.
- **Save as look…**, under the effect controls, stores what the strip shows as a look in the
  library. Give it a name and, optionally, a **preset id** (1-250, WLED's preset number; the form
  suggests the next free one, and warns when another look has it); without one the look stays in
  the library only. Choose what it keeps: the **whole strip setup** (segments and their effects;
  showing it replaces the strip's segments) or **effects and colours only** (applied to whatever
  segments the strip has). The mic follows the look: on for a sound-reactive effect, off for any
  other.
- **Show** plays a look on the strip without saving anything on the device.
- **A look's preset id** can be changed later: click "preset 6" (or "no preset id") on its row, or
  use the field at the top of the look editor. It changes the library; the next write puts the look
  at its new id (the old preset stays on the device: writing never deletes presets).
- **The write bar** at the bottom of Looks & effects and the Slot grid compares the header's device
  with the library: "Desk: 3 presets differ from the library", or "Desk is up to date (written
  22:30)". It checks (a dry run that writes nothing) when the view opens, shortly after each change
  to the library, and on **Check again**; it never polls. **Review and write** opens the write
  plan, grouped by what will happen: **Will be written** (with what the device holds at that
  preset id now), **Already the same**, **Skipped: not on this device**, **Needs your decision:
  effect changed** (tick the ones to write anyway), and **Two looks want the same preset id**,
  which blocks the write until each has its own.
  Then **Write N presets to** the device:
  - the device's `presets.json` is backed up;
  - the write stops if someone changed the presets in the meantime (in WLED's own UI, say), unless
    you say to go ahead;
  - after the write, the file is read back and must match.

  Entries wled-studio doesn't manage are left alone.

**Playlists** (looks in a row, with times and shuffle) and **palettes** (a gradient editor) live in
the library too, and are written with the looks.

## 4. The room's shape

Under **Room shape**, describe the strip as walls in LED order: a direction and how many LEDs each.
The live view (**Live view of the strip**) and the Effect studio's preview are then drawn in that
shape.

## 5. Effect studio: your own effects

Effects are small C++ functions inside WLED's firmware. The Effect studio lets you write them,
watch them run, and build them in.

1. **Write:** in *Your effects' code*, **New effect** starts from a template: a wave along the strip,
   or a room-aware wave that uses each LED's position (**Write room map** puts the positions from
   your room shape next to it). Edit, **Save**. The files are in `./effects`, one folder per effect.
2. **Watch:** tick the **effect folders to compile** (opening a file ticks its folder; the ticks
   are remembered), then **Compile and preview**: it compiles them to WebAssembly and runs them in
   the browser, with the effect's own sliders. The line above the preview says what it shows: the
   built-in example until you compile, then your folders and when they were compiled. Saving a
   file in them marks the preview out of date, with a **Compile** button. If compiling fails, the
   compiler's messages appear under the button (the full log behind **Full log**); click a
   `folder/file:line` to open the file at that line.
3. **On the strip:** **Stream to the strip** sends the preview to the header's device (or another
   one picked under **Preview on**) live (DDP); its own effect comes back a few seconds after you
   stop.
4. **Into firmware:** once the preview shows your effects, **Build firmware with …** under it opens
   **Firmware** with those folders ticked and the board that matches the header's device picked
   (see 6).

Compiling needs the firmware builder:

```bash
WLEDSTUDIO_BUILDER_URL=http://builder:8090 docker compose --profile firmware up -d
sudo chown -R 10001:10001 effects       # the app runs as uid 10001 and edits these files
```

The builder has no internet of its own: it fetches WLED and the toolchain through an allowlist
proxy. The first preview installs Emscripten (a few minutes); the first firmware build downloads
the ESP32 toolchain.

**Keep your effects in git and work in the app alone.** Clone your effects repository into
`./effects` (the repository's root, or each folder in it, being one effect usermod). The app then
shows that folder's changes under the editor: **Show changes**, **Commit** with a message,
**Push** and **Pull**. A push first takes the remote's new commits under yours; if the same lines
changed on both sides, nothing is pushed and the app says so. Turn it on with:

```bash
WLEDSTUDIO_EFFECTS_GIT=on                          # committing
WLEDSTUDIO_EFFECTS_GIT_KEY=/run/secrets/effects_key # pushing: an SSH key, mounted read-only
WLEDSTUDIO_EFFECTS_GIT_AUTHOR="Your Name <you@users.noreply.github.com>"   # the commits' author
```

Make the key a GitHub **deploy key with write access** to that one repository
(`ssh-keygen -t ed25519 -N "" -f effects_key`, then the repository's Settings → Deploy keys, or
`gh repo deploy-key add effects_key.pub --allow-write`). It can push to that repository and
nothing else. Give it to uid 10001 with mode 600, or ssh refuses it. Only GitHub remotes are
pushed to, over SSH with GitHub's host key pinned; a clone made over HTTPS is pushed to the same
repository over SSH.

## 6. Firmware with your effects

**Firmware** builds WLED for your board with your effects added. Before an image may be flashed it
must pass four safety checks, the **gate**
([chain of trust](https://github.com/Laffs2k5/wled-studio-builder/blob/main/docs/chain-of-trust.md)):
1. the vendor's own image, rebuilt here, matches what's been verified for that board;
2. only your effect code is added: everything else is the vendor's, unchanged;
3. it fits the firmware slot, with a safety margin;
4. every effect runs in the virtual twin (the image's own WLED code, on the build machine) without
   crashing.

A build shows these as a checklist from the start, marks the one running, and shows the time so
far (usually 2–5 minutes); each line then says whether it passed and why not. The build log is
behind **Show build log**.

Pick the **board and WLED release** and **your effect folders to include**, then **Build**. The
target that matches the header's device is preselected and marked "matches"; an amber line says
when the chosen one is another board or release than the device runs. The app tells them apart by
what the device reports (`/json/info`: its release name or product, and its version). Your last
choice per device and the ticked folders are remembered in the browser.

**Your builds** lists the firmware builds (the Effect studio's preview compiles aren't among them):
when, board and release, effects, and the result: *ready to flash*, *failed check N* (hover for
which) or *running*. Click one to open it.

Supported boards are those with a pins file in wled-studio-builder (today: QuinLED's 16.0.0 and
16.0.1 releases). **Flashing from the app isn't built yet**, by design: a self-built image goes to
a spare board first.

## What's not here yet

- flashing (see above);
- exact colours in the preview;
- WLED's built-in effects in the preview: the device's live view is their preview;
- user accounts: it's built for one household on a home network.

See [status.md](status.md).
