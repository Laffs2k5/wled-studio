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
  effect names, metadata strings or palette tables into the repo; read them from a device.

## Git

- Push directly to `main`. Open a PR only when CI on a branch is needed first; then fast-forward.
- Atomic conventional commits; the body explains *why*. AI config (`CLAUDE.md`, `.claude/`) in its
  own commit.

## Develop and test

- Backend: `cd backend && python -m venv .venv && .venv/bin/pip install -e '.[dev]' && .venv/bin/pytest --cov`.
- Frontend: `cd frontend && npm ci --ignore-scripts && npm test && npm run build`.
- End to end: `docker compose --profile demo up -d --build && scripts/smoke.sh`.
- CI keeps coverage at 85 % or more on both sides.

## Gotchas

- WLED ignores a settings-PIN check within 3 s of the previous one, **across all clients**, so
  the cooldown is tracked per device (`wled._last_pin_check`), not per client.
- WLED has one JSON buffer; a busy device answers `{"error": 3}`. The client retries.
- The SPA route answers GET only: `curl -I` (HEAD) gets 405. Use `curl -D - -o /dev/null`.
- Under the strict CSP, React's `style={{…}}` works (set through the CSSOM), but inline
  `<style>` and `style="…"` in HTML don't.
- Don't `pkill -f` the dev servers: the pattern matches your own shell. Kill by PID.
- **Pin commits by SHAs taken from `git rev-parse`, never typed from memory:** the Dockerfile's
  `BUILDER_COMMIT` once held a mistyped SHA, and the image build failed with "not our ref".
- The effect preview's compiler shim lives in wled-studio-builder (`preview/`); the Dockerfile's
  preview stage builds the example from there at `BUILDER_COMMIT`.
