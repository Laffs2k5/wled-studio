# SPDX-License-Identifier: EUPL-1.2
"""The editing hook: a URL the app calls when an editing session starts and ends.

Other software that writes to the same device (a home automation system, say) can hold off while
someone edits. The app POSTs JSON to the device's hook URL:

    {"editing": true,  "device": "<device name>", "device_id": "<id>"}   before the snapshot
    {"editing": false, "device": "<device name>", "device_id": "<id>"}   after the session ends

The URL often carries a secret (a webhook id), so it is stored like a PIN (a 0600 file) and never
returned by the API. Its host gets the same SSRF check as a device host. A failing hook never
blocks editing: the result is reported with the session.
"""
from __future__ import annotations

from urllib.parse import urlsplit

import httpx

from . import netcheck

TIMEOUT = 5.0


class HookError(ValueError):
    pass


def check_url(url: str, allow_public: bool = False, resolver=netcheck.resolve) -> str:
    """Return the URL if it's an http(s) URL to an allowed host, or raise HookError."""
    url = url.strip()
    if len(url) > 500:
        raise HookError("the hook URL is too long")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise HookError("not a valid URL") from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise HookError("the hook URL must start with http:// or https:// and name a host")
    if parts.username or parts.password:
        raise HookError("no user name or password in the hook URL")
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    try:
        netcheck.check_device_host(f"{host}:{port}" if port else host, allow_public, resolver)
    except netcheck.HostError as e:
        raise HookError(str(e)) from None
    return url


async def notify(url: str, editing: bool, device_id: str, name: str,
                 transport: httpx.AsyncBaseTransport | None = None) -> str:
    """POST the editing state; "ok", or why not (never raises, never shows the URL)."""
    body = {"editing": editing, "device": name, "device_id": device_id}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False, transport=transport) as c:
            r = await c.post(url, json=body)
    except httpx.TimeoutException:
        return "the hook didn't answer in time"
    except httpx.HTTPError as e:
        return f"the hook couldn't be reached ({type(e).__name__})"
    if 200 <= r.status_code < 300:
        return "ok"
    return f"the hook answered {r.status_code}"
