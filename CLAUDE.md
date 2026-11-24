# CLAUDE.md (wled-studio)

Guidance for Claude Code in this repository. **Claude maintains this file**: when a convention,
gotcha or the status changes, update it in the same session, as its own commit.

## What this is

A local web app for WLED (looks, playlists, palettes, effect settings; later, own effects and
firmware via the sibling repo `wled-studio-builder`). Public; EUPL-1.2. Status and roadmap:
[docs/status.md](docs/status.md). Security model: [docs/security.md](docs/security.md).

## Keep it publishable

- No home or personal details: no real host names, IP addresses, MACs, PINs, people's names.
  Tests use the fake device and placeholder hosts (`wled.lan`).
- No WLED code or data: the fake device's effects and palettes are made up. Don't copy WLED's
  effect names, metadata strings or palette tables into the repo; read them from a device. The
  exception is the UI's labels for the values of WLED's segment settings (blend modes, sound
  simulations): fixed names of an interface, kept as facts, with the source file noted.
- **Nothing about the owner's home in this public repo,** tests included: no hosts, no room
  dimensions or wall counts. Use made-up numbers.

## Git

- Push directly to `main`. Open a PR only when CI on a branch is needed first; then fast-forward.
- Atomic conventional commits; the body explains *why*. AI config (`CLAUDE.md`, `.claude/`) in its
  own commit.

## Develop and test

- Backend: `cd backend && python -m venv .venv && .venv/bin/pip install -e '.[dev]' && .venv/bin/pytest --cov`.
- Frontend: `cd frontend && npm ci --ignore-scripts && npm test && npm run build`.
- End to end: `docker compose --profile demo up -d --build && scripts/smoke.sh`, then the browser
  tests: `cd e2e && npm ci && npx playwright install chromium && npx playwright test`
  (`WLEDSTUDIO_URL`, `DEVICE_HOST` point them elsewhere). They catch what component tests can't:
  the CSP, WebAssembly loading, real requests.
- CI keeps coverage at 85 % or more on both sides.
- **The image's Python dependencies are locked with hashes** (`backend/requirements.txt`). After
  changing dependencies in `pyproject.toml`, regenerate:
  `uv pip compile backend/pyproject.toml --universal --python-version 3.12 --generate-hashes --no-header -o backend/requirements.txt`.

## Gotchas

- **firmware-e2e runs the published images,** and the app image is published by the same commit's
  ci run. Started side by side, it pulled the previous image and a new route fell through to the
  web page (2026-11-23). On push it now waits for its commit's ci; keep that wait.

- WLED ignores a settings-PIN check within 3 s of the previous one, **across all clients**, so
  the cooldown is tracked per device (`wled._last_pin_check`), not per client.
- WLED has one JSON buffer; a busy device answers `{"error": 3}`. The client retries.
- `<output>` elements have the ARIA role `status`; in Playwright, target the toast as `.toast`, not
  `getByRole("status")`.
- The SPA route answers GET only: `curl -I` (HEAD) gets 405. Use `curl -D - -o /dev/null`.
- Under the strict CSP, React's `style={{…}}` works (set through the CSSOM), but inline
  `<style>` and `style="…"` in HTML don't.
- **The code editor (CodeMirror) lives in a shadow root** because of that CSP: there it styles
  itself with constructed stylesheets; in the document it would add a `<style>` the CSP blocks.
  So:
  - Testing Library can't see inside it: tests reach the view with `viewOf(host)` from `Code.tsx`.
    Playwright's CSS locators do pierce it (`.code .cm-content`);
  - the app's CSS doesn't reach in, but CSS variables do (`--panel`, `--cm-focus`);
  - CodeMirror's `&light`/`&dark` selectors work only in `EditorView.baseTheme`. In
    `EditorView.theme` they throw "Unsupported selector" and the editor doesn't appear;
  - jsdom has no layout: `src/test/setup.ts` stubs `Range.getClientRects` for CodeMirror.
- Check the editor's styling in more than Chromium when it changes: Firefox and WebKit run in
  Playwright here (WebKit needed `playwright install-deps webkit`, done 2026-11-24).
- Don't `pkill -f` the dev servers: the pattern matches your own shell. Kill by PID.
- **Flashes and reverts run as background tasks.** A test must enter the `TestClient`
  (`with TestClient(app) as c` or `c.__enter__()`), or each request gets its own event loop and
  the task dies with it. `app.state.flash_timing` shortens the reboot polling in tests.
- **The fake device is a plain ASGI middleware for its reboot window**, not `@app.middleware`:
  Starlette's `BaseHTTPMiddleware` delayed another request enough to break the stream test.
- WLED's `/update` and `/update?revert` answer with small HTML pages, not JSON; `wled.page_text()`
  takes the words out. `/cfg.json` is readable without the PIN (WLED keeps the secrets in
  `wsec.json`); `/json/cfg` is the PIN-protected one.
- **Pin commits by SHAs taken from `git rev-parse`, never typed from memory:** the Dockerfile's
  `BUILDER_COMMIT` once held a mistyped SHA, and the image build failed with "not our ref".
- The effect preview's compiler shim lives in wled-studio-builder (`preview/`); the Dockerfile's
  preview stage builds the example from there at `BUILDER_COMMIT`.
