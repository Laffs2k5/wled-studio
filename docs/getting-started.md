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

If the device has a **settings PIN** (WLED → Security), set it with the **PIN** button. It's needed
only to write presets and palettes, and it's never shown again.

## 3. Looks: effects with their own controls

The effect list shows the device's effects (2D-only effects are hidden on strips; ♪ marks
sound-reactive ones). Picking one shows **only the controls that effect uses, with its own labels**,
read from WLED's effect metadata. Changes go to the strip at once.

- **Import from device** turns the device's presets into looks, **by name**. A look keeps the
  effect's and palette's names, not their numbers, so it survives firmware changes.
- **Save current** stores what the strip shows as a look, with a **preset id** (1-250, WLED's
  preset number) if you give one; without one the look stays in the library only. The mic follows
  the look: on for a sound-reactive effect, off for any other.
- **Show** plays a look on the strip without saving anything on the device.
- **Check what would change**, then **Write N presets to** the device:
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
2. **Watch:** **Compile and preview** compiles them to WebAssembly and runs them in the browser,
   with the effect's own sliders. Colours and fades are close, not exact.
3. **On the strip:** pick the device and **Stream to the strip**. The strip shows the preview live
   (DDP), and its own effect comes back a few seconds after you stop.

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

**Firmware** builds an image through the **gate**
([chain of trust](https://github.com/Laffs2k5/wled-studio-builder/blob/main/docs/chain-of-trust.md)):
1. your vendor's stock image is rebuilt and checked against what's been verified for that board;
2. it's rebuilt with your effects;
3. only images whose sole difference is your code pass, and they must fit the firmware slot.

Supported boards are those with a pins file in wled-studio-builder (today: QuinLED's 16.0.0 and
16.0.1 releases). **Flashing from the app isn't built yet**, by design: a self-built image goes to
a spare board first.

## What's not here yet

- flashing (see above);
- exact colours in the preview;
- WLED's built-in effects in the preview: the device's live view is their preview;
- user accounts: it's built for one household on a home network.

See [status.md](status.md).
