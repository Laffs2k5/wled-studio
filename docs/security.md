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
| XSS, clickjacking | A strict Content-Security-Policy (`default-src 'self'`, no inline scripts or styles), `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, no referrer; React escapes all output |
| Oversized requests | Bodies over 1 MB are refused; request models refuse unknown fields and enforce ranges and lengths |
| Container | Runs as a non-root user (uid 10001), read-only root filesystem, all capabilities dropped, `no-new-privileges`; base images pinned by digest; no npm install scripts during the build |
| Exposure | Listens on `127.0.0.1` only in the default compose file |
| Supply chain | Python and npm dependencies pinned (npm by lockfile); `npm audit` in CI; GitHub Actions pinned by commit |

## Using it from other machines

1. Publish the port on the LAN: in `compose.yaml`, `ports: ["8080:8080"]`.
2. Add the name you browse to: `WLEDSTUDIO_ALLOWED_HOSTS=localhost,127.0.0.1,studio.lan`.
3. **Set a token** so not everyone on the LAN can write presets: `WLEDSTUDIO_TOKEN=<a long random
   string>`. API requests then need `Authorization: Bearer <token>`. The web UI's login screen for
   the token is on the to-do list (docs/status.md); until then, keep it on localhost or behind a
   reverse proxy that authenticates.

Don't expose wled-studio to the internet.

## Reporting a problem

Open an issue without exploit details, and ask for a private contact.
