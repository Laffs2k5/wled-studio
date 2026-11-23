# Security

wled-studio is built for **personal, local use**: one household, on a home network, possibly not
running all the time. There are no user accounts. The protections below follow the OWASP guidance
that applies to such an app.

## Threat model in short

- **The WLED devices** have no authentication of their own, apart from an optional settings PIN.
  Anyone on the LAN can already control them. wled-studio doesn't make that worse: it holds the PIN
  and uses it only for writing files to the device.
- **The browser** is the main attack surface. A malicious web page you visit must not be able to
  drive wled-studio on your behalf (CSRF, DNS rebinding).
- **wled-studio makes HTTP requests to hosts you enter**, so it must not become a way to reach
  arbitrary hosts (SSRF).

## What's in place

| Risk | Protection |
|---|---|
| DNS rebinding | Answers only to the Host names in `WLEDSTUDIO_ALLOWED_HOSTS` (default `localhost,127.0.0.1`) |
| Cross-site request forgery | Every write to `/api` needs the header `X-WLED-Studio: 1` (a cross-site page can't send it without a CORS preflight, which is never granted), and an `Origin` matching the Host |
| SSRF | Device hosts are a name or IP with an optional port, nothing else, and must resolve to private, loopback or link-local addresses (`WLEDSTUDIO_ALLOW_PUBLIC_DEVICES=1` lifts that) |
| Arbitrary device commands | Live control goes through a whitelisted schema (on, brightness, transition, segment fields, the mic). No config writes, no raw JSON, no PIN in state requests |
| Secrets | The settings PIN is write-only in the API, stored in a 0600 file per device (or `WLEDSTUDIO_PIN_<DEVICE_ID>`), never logged, and the device is locked again after every write, also on errors |
| XSS, clickjacking | A strict Content-Security-Policy (`default-src 'self'`, no inline scripts or styles; `'wasm-unsafe-eval'` so the effect preview's WebAssembly can compile, JavaScript `eval` stays off), `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, no referrer; React escapes all output |
| Streaming (websocket) | `/api/devices/<id>/stream` checks the Host and the Origin itself (HTTP middleware doesn't see websockets; this stops cross-site websocket hijacking), takes the token as the subprotocol `bearer.<token>`, validates every frame (channels, size, at most 4096 pixels), limits the rate to 60 fps, and sends DDP only to the device's own host |
| Effect files | The editor reads and writes only `*.cpp`, `*.h` and `library.json` in effect folders under `WLEDSTUDIO_EFFECTS_DIR`. Folder and file names are checked, there's no path traversal, and files are at most 256 kB. The code is yours; it's compiled by the builder, never run by the app |
| Oversized requests | Bodies over 1 MB are refused; request models refuse unknown fields and enforce ranges and lengths |
| Firmware builder's network | In the `firmware` profile the builder has no internet of its own: it sits on an internal network shared only with the app and an egress proxy (squid), which allows only GitHub, the PlatformIO registry, PyPI, npm and Emscripten's downloads (`proxy/squid.conf`). The `firmware-e2e` workflow checks that direct egress is blocked and that other hosts are refused |
| Container | Runs as a non-root user (uid 10001), read-only root filesystem, all capabilities dropped, `no-new-privileges`; base images pinned by digest; no npm install scripts during the build |
| Exposure | Listens on `127.0.0.1` only in the default compose file |
| Supply chain | Python and npm dependencies pinned (npm by lockfile); `npm audit` in CI; GitHub Actions pinned by commit |

## Using it from other machines

1. Publish the port on the LAN: in `compose.yaml`, `ports: ["8080:8080"]`.
2. Add the name you browse to: `WLEDSTUDIO_ALLOWED_HOSTS=localhost,127.0.0.1,studio.lan`.
3. **Set a token** so not everyone on the LAN can write presets: `WLEDSTUDIO_TOKEN=<a long random
   string>`. API requests then need `Authorization: Bearer <token>`; the web UI asks for it once
   per browser session (kept in session storage, sent as that header). Exempt: the health check, and
   compiled effect previews (`GET /api/firmware/jobs/<id>/preview/preview.{mjs,wasm}`). A browser
   can't add a header to a module import; those files are read-only, behind a random 128-bit job id,
   and contain only your compiled effects.

Don't expose wled-studio to the internet.

## Reporting a problem

Open an issue without exploit details, and ask for a private contact.
