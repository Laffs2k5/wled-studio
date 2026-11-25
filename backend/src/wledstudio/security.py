# SPDX-License-Identifier: EUPL-1.2
"""HTTP security for a LAN app without user accounts.

- Host header allowlist: answers only to configured names (DNS rebinding).
- State-changing requests (anything but GET/HEAD/OPTIONS) to /api need the
  header "X-WLED-Studio: 1", which a cross-site page can't send without a CORS
  preflight that this app never grants, and an Origin, if present, that matches
  the Host (CSRF).
- Optional shared token (WLEDSTUDIO_TOKEN): every /api request (except the
  health check and compiled preview files, see TOKEN_EXEMPT) then needs
  "Authorization: Bearer <token>", compared in constant time.
- Response headers: a strict Content-Security-Policy, no framing, no sniffing,
  no referrer.
- Request bodies are limited in size.
"""
from __future__ import annotations

import hmac
import re
from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .config import Settings

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Open without the token: the health check, and compiled effect previews. A browser's
# module import() can't send an Authorization header; the files are read-only, sit
# behind a random 128-bit job id, and contain only your compiled effects.
TOKEN_EXEMPT = re.compile(r"^/api/(health|firmware/jobs/[0-9a-f]{32}/preview/preview\.(mjs|wasm))$")
CSRF_HEADER = "x-wled-studio"

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; "
        "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), usb=(), serial=()",
}


def _deny(status: int, msg: str) -> Response:
    return JSONResponse({"detail": msg}, status_code=status)


def host_allowed(host_header: str, allowed: list[str]) -> bool:
    if "*" in allowed:
        return True
    host = host_header.lower()
    if host.startswith("["):  # [::1]:8080
        name = host.split("]")[0] + "]"
    else:
        name = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
    return name in [a.lower() for a in allowed]


class SecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings):
        super().__init__(app)
        self.s = settings

    async def dispatch(self, request: Request, call_next):
        host = request.headers.get("host", "")
        if not host_allowed(host, self.s.allowed_hosts):
            return _deny(400, "host not allowed (set WLEDSTUDIO_ALLOWED_HOSTS)")

        length = request.headers.get("content-length")
        archive_limit = 10 * 1024 * 1024
        limit = archive_limit if request.url.path == "/api/library/archive/import" else self.s.max_body_bytes
        if length is not None and (not length.isdigit() or int(length) > limit):
            return _deny(413, "request body too large")

        if request.url.path.startswith("/api/"):
            exempt = request.method == "GET" and TOKEN_EXEMPT.match(request.url.path)
            if self.s.token is not None and not exempt:
                auth = request.headers.get("authorization", "")
                given = auth[7:] if auth.lower().startswith("bearer ") else ""
                if not hmac.compare_digest(given.encode(), self.s.token.encode()):
                    return _deny(401, "missing or wrong token")
            if request.method not in SAFE_METHODS:
                if request.headers.get(CSRF_HEADER) != "1":
                    return _deny(403, "missing X-WLED-Studio header")
                origin = request.headers.get("origin")
                if origin is not None and origin != "null":
                    if urlsplit(origin).netloc.lower() != host.lower():
                        return _deny(403, "cross-origin request refused")
                elif origin == "null":
                    return _deny(403, "cross-origin request refused")

        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response
