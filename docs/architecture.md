# Architecture

```mermaid
flowchart LR
  B["Browser<br/>(React UI)"] -->|"/api, same origin"| S["wled-studio<br/>(FastAPI)"]
  S -->|"JSON API, /upload with PIN"| W["WLED devices"]
  S --> D[("data volume:<br/>devices, library,<br/>backups, PINs")]
  S -->|"build and preview jobs"| BLD["wled-studio-builder<br/>(job service)"]
  BLD -->|"only via the allowlist"| P["egress proxy"]
  P --> I["GitHub, PlatformIO,<br/>PyPI, npm, Emscripten"]
```

- **One container** serves the built UI and the API. State lives in a data volume:
  - `devices.json` and `secrets/<id>.pin` (mode 0600);
  - `library.json` with every earlier version in `history/`;
  - `backups/<device>/` and `state/` (the last written presets hash per device).
- **The library is the source of truth.** A device's `presets.json` is generated from it: looks are
  stored with effect and palette *names* and a snapshot of each effect's metadata, and resolved to
  the device's ids when written (see `backend/src/wledstudio/library.py` for the change-check
  statuses).
- **A look can own the segment layout** (`clear_other_segments`): showing it deletes the device's
  other segments, as WLED's own presets saved with segment bounds do. They pad the segment list
  with `{"stop":0}` up to the device's limit (`info.leds.maxseg`), and so does the app. Captured
  looks own the layout. Imported ones keep what the device's preset did, so an import followed by a
  write leaves unchanged presets unchanged.
- **Segments can be named by wall.** When a look is captured or imported, a segment that covers
  exactly one labelled wall of the device's room model gets that wall's name (`wall`). Showing or
  writing the look takes the wall's LEDs from the room model at that time, so correcting a boundary
  in the room model moves every look on that wall, with a note in the write plan. A look on a wall
  the model no longer has is unavailable. Without a room model the saved LEDs are used.
- **Writing** replaces `presets.json` as a whole (`push.py`):
  1. back up the current file;
  2. check for drift since the last write;
  3. upload, with the PIN unlocked only for that and locked again in a finally path;
  4. read back and verify.

  Entries the library doesn't manage are kept as they are.
- **The fake device** (`wledstudio.fakewled`) implements the API subset with made-up effects; it
  backs the tests and `docker compose --profile demo`.
- **The firmware side** is [wled-studio-builder](https://github.com/Laffs2k5/wled-studio-builder):
  verified reproducible builds of vendor WLED images, with your own effects added. The app will run
  it as a separate service for build jobs (no Docker socket in the app container).
