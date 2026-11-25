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

On first start, Looks & effects shows a card **Add your WLED controller**: a name, the address
(`wled-kitchen.local`, `192.168.1.40`, with `:port` if it isn't 80; a pasted `http://…/` is fine)
and, only if you set one in WLED under Security, the settings PIN. Later devices are added with
**Add device** in the header. Addresses must be on your network; public addresses are refused
unless you allow them.

Adding only reads the device: the app stores it, then reads it once and says what it found
("Added Kitchen. Found: WLED 16.0.1, 250 LEDs."), or that it doesn't answer at that address.

The **Device** select in the header picks the device you work on, in every view: Looks & effects,
the Slot grid's write bar, the Effect studio's preview and room map, and the device Firmware
checks and flashes. The browser remembers it across reloads. Headings that name the device have a
**Change device** link back to it.

**Device settings** (⚙ next to the Device select) holds what the app keeps about the current
device; none of it is sent to the device:
- **Name** and **Address**: change the address when the device got a new one (it's checked as when
  adding);
- **Settings PIN** (WLED → Security): needed to write presets, palettes and firmware, and never
  shown again. **Save PIN** stores a new one; **Remove PIN** is a button of its own;
- **Room shape** (section 4);
- **Remove device…**: asks first and says what goes: the app's records of the device (its address,
  PIN, room shape, which looks go on it, and the record of what the app last wrote and flashed).
  Nothing on the device changes, the library stays, and backups of its presets stay in the data
  folder.

**A device that doesn't answer** (switched off, off the network, a wrong address): Looks & effects
says so where the live controls would be ("Desk does not answer at 192.168.1.40. Check that it is
powered and on the network."), with **Try again** and **Change the address…**. The library beside it stays usable: organise,
rename and delete looks; showing, editing, importing and writing wait until the device answers.

## 3. Looks: effects with their own controls

The effect list shows the device's effects (2D-only effects are hidden on strips; ♪ marks
sound-reactive ones). Picking one shows **only the controls that effect uses, with its own labels**,
read from WLED's effect metadata. Changes go to the strip at once.

- **Import from device** turns the device's presets into looks, **by name**. A look keeps the
  effect's and palette's names, not their numbers, so it survives firmware changes. What it did
  stays under the button ("Imported 1 new look… 5 already in the library were left as they are.").
- **Save as look…**, under the effect controls, stores what the strip shows as a look in the
  library. Give it a name and, optionally, a **preset id** (1-250, WLED's preset number; the form
  suggests the next free one, and warns when another look has it); without one the look stays in
  the library only. Choose what it keeps: the **whole strip setup** (segments and their effects;
  showing it replaces the strip's segments) or **effects and colours only** (applied to whatever
  segments the strip has). The mic follows the look: on for a sound-reactive effect, off for any
  other.
- **A look's row** shows its name with a line of facts under it (its preset id, a status such as
  "effect changed", "♪ mic" for a sound-reactive look, "in 1 playlist", the walls it follows),
  then **Show on strip**, **Edit**, and a **⋯** menu with Rename, Move up and down, Move to
  folder, Remove from this device (or Put on this device) and Delete.
- **Show on strip** plays a look on the strip without saving anything on the device.
- **"effect changed"** on a look's row means the effect on this device has different controls than
  when the look was saved: the tooltip and the write plan say what changed ("2 sliders renamed, 1
  option removed"), with the raw details behind **Details**. Show it on the strip; if it looks right,
  **Looks right: keep** takes this device's version of the effect as the look's reference (after a
  confirmation in the page). Other devices with the old version then show "effect changed".
  "effect updated" (labels or defaults changed) and "effect renumbered" need nothing.
- **Edit** opens a saved look in the look editor, in a dashed frame under the banner "Editing the
  saved look … The strip does not change.": the editor changes the look in the library only. The
  effect list on the left picks the effect of the segment being edited. **Cancel** asks first when
  there are unsaved changes. After **Save**, a note says that the look's preset on the device is
  out of date until the next write, with **Check and write** to open the write plan.
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

  Entries wled-studio doesn't manage are left alone. The result stays in the write bar until the
  next write: "Written to Desk and verified at 22:30: 4 presets. Backup of the previous presets:
  <file>", or why nothing was written.

Results that matter stay where the action was: the write, an import, a flash and its steps. Short
confirmations show for a few seconds at the top right; errors stay there until you dismiss them
(×).

**Playlists** (looks in a row, with times and shuffle) and **palettes** (a gradient editor) live in
the library too, and are written with the looks.

## 4. The room's shape

Under **Room shape** in the device settings, describe the strip as walls in LED order: a direction
and how many LEDs each. The live view (**Live view of the strip**) and the Effect studio's preview
are then drawn in that shape. Until a device has one, Looks & effects links to it (**Set the room
shape…**).

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
16.0.1 releases).

**Flashing** a passed build to the header's device is off unless the app runs with
`WLEDSTUDIO_FLASHING=on`, behind a client-certificate proxy ([security.md](security.md)). Try a
self-built image on a spare board first. Open a build that's *ready to flash*:
1. **Check the library** shows what the firmware changes for your looks on that device, conclusion
   first (*After flashing, of your 17 looks and playlists: 11 stop working, 4 start working, 2 stay
   as they are*), then the looks grouped by what happens to them, with why (*Uses effect "Glow",
   which this firmware does not have*); the unchanged ones are folded away.
2. **Plan the flash** checks the device (reads only) and leads with a verdict: *Ready to flash*,
   *Ready to flash, with N things to look at*, or *Cannot flash: N problems*. Problems come first,
   then the things to look at, each with what to do (**Store the PIN**, **See which looks**); the
   checks that passed are folded away. A line says what the device runs now and what it will run,
   with the effects the image adds, and what flashing does: a backup of presets and settings
   first, then the upload and a restart (the strip goes dark for a moment), about a minute.
3. Type the device's name and **Flash** it, after accepting the flashing notice
   ([DISCLAIMER.md](../DISCLAIMER.md)).
4. The run lists all its steps from the start (backup, the image checked, upload, restart, checks
   against the backup) with *Do not power off* while it runs, then says plainly how it went:
   *Flashed and running: … runs WLED 16.0.1 with 218 effects*, or what went wrong and what that
   means for the device, and what to do next.
5. **Go back to the previous firmware** boots the image in the device's other slot again (WLED
   keeps it there), with the name typed and a backup first. After a flash it's part of the result;
   otherwise it's folded away, saying what it would boot: what the device ran before the app last
   flashed or switched it, or *unknown* if the app never has. A virtual device has no way back.

## What's not here yet

- exact colours in the preview;
- WLED's built-in effects in the preview: the device's live view is their preview;
- user accounts: it's built for one household on a home network.

See [status.md](status.md).
