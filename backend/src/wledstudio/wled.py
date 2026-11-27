# SPDX-License-Identifier: EUPL-1.2
"""An async client for WLED's HTTP JSON API.

- Writes to one device are serialised (one asyncio lock per device): WLED has
  one global JSON buffer and answers {"error": 3} when it's in use; the client
  retries those with a short backoff.
- The settings PIN (needed for /upload) is only held in memory, sent in a
  request body, never logged, and the device is locked again afterwards, also
  on errors. WLED ignores a PIN check within 3 s of the previous one, so the
  client waits out that cooldown before unlocking.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import re
import logging
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)

PIN_COOLDOWN_S = 3.2
BUSY_RETRIES = 4
BUSY_BACKOFF_S = 0.25


FLASH_TIMEOUT_S = 180.0   # a 1.3 MB image over Wi-Fi, written to flash as it arrives


class WLEDError(Exception):
    """A device answered with an error or not at all."""


class WLEDLocked(WLEDError):
    """The device refused a protected request (settings PIN missing or wrong)."""


class WLEDStateChanged(WLEDError):
    """The live state changed after the caller inspected it."""


_locks: dict[str, asyncio.Lock] = {}
# when each device last saw a PIN check: WLED ignores a check within 3 s of the
# previous one, across all clients, so this is tracked per device, not per client
_last_pin_check: dict[str, float] = {}


def device_lock(key: str) -> asyncio.Lock:
    lock = _locks.get(key)
    if lock is None:
        lock = _locks[key] = asyncio.Lock()
    return lock


class WLEDClient:
    def __init__(self, base_url: str, *, pin: str | None = None, timeout: float = 5.0,
                 transport: httpx.AsyncBaseTransport | None = None, sleep=asyncio.sleep, clock=time.monotonic):
        self.base_url = base_url.rstrip("/")
        self._pin = pin
        self._http = httpx.AsyncClient(base_url=self.base_url, timeout=timeout, transport=transport,
                                       follow_redirects=False, headers={"User-Agent": "wled-studio"})
        self._sleep = sleep
        self._clock = clock

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.aclose()

    @property
    def has_pin(self) -> bool:
        return self._pin is not None

    def __repr__(self) -> str:  # never show the PIN
        return f"WLEDClient({self.base_url!r}, pin={'set' if self._pin else 'none'})"

    # --- reads ---
    async def get_json(self, path: str) -> Any:
        body = await self.get_optional_json(path)
        if body is None:
            raise WLEDError(f"{self.base_url}{path}: HTTP 404")
        return body

    async def get_optional_json(self, path: str) -> Any | None:
        try:
            r = await self._http.get(path)
        except httpx.HTTPError as e:
            raise WLEDError(f"{self.base_url}{path}: {e.__class__.__name__}") from None
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise WLEDError(f"{self.base_url}{path}: HTTP {r.status_code}")
        try:
            return r.json()
        except json.JSONDecodeError:
            raise WLEDError(f"{self.base_url}{path}: not JSON") from None

    async def info(self) -> dict:
        return await self.get_json("/json/info")

    async def effects(self) -> list[str]:
        return await self.get_json("/json/eff")

    async def fxdata(self) -> list[str]:
        return await self.get_json("/json/fxdata")

    async def palettes(self) -> list[str]:
        return await self.get_json("/json/pal")

    async def custom_palette(self, index: int) -> Any | None:
        if not 0 <= index < 129:
            raise ValueError("custom palette index must be 0-128")
        return await self.get_optional_json(f"/palette{index}.json")

    async def state(self) -> dict:
        return await self._retry_busy(lambda: self._http.get("/json/state"))

    async def presets_text(self) -> str:
        try:
            r = await self._http.get("/presets.json")
        except httpx.HTTPError as e:
            raise WLEDError(f"presets.json: {e.__class__.__name__}") from None
        if r.status_code != 200:
            raise WLEDError(f"presets.json: HTTP {r.status_code}")
        return r.text

    # --- writes ---
    async def _retry_busy(self, send) -> Any:
        for attempt in range(BUSY_RETRIES + 1):
            try:
                r = await send()
            except httpx.HTTPError as e:
                raise WLEDError(f"{self.base_url}: {e.__class__.__name__}") from None
            try:
                body = r.json()
            except json.JSONDecodeError:
                body = None
            if isinstance(body, dict) and body.get("error") == 3 and attempt < BUSY_RETRIES:
                await self._sleep(BUSY_BACKOFF_S * (attempt + 1))
                continue
            if r.status_code != 200 or (isinstance(body, dict) and "error" in body):
                raise WLEDError(f"{self.base_url}: HTTP {r.status_code} {body if isinstance(body, dict) else ''}".strip())
            return body
        raise WLEDError(f"{self.base_url}: busy")  # pragma: no cover - loop always returns or raises

    async def set_state(self, payload: dict) -> dict:
        if "pin" in payload:
            raise ValueError("use unlocked() for the PIN")
        async with device_lock(self.base_url):
            return await self._retry_busy(lambda: self._http.post("/json/state", json=payload))

    async def restore_if_current(self, inspected_sha256: str, payload: dict) -> dict:
        """Check and restore live state in one Studio-side write transaction."""
        async with device_lock(self.base_url):
            current = await self._retry_busy(lambda: self._http.get("/json/state"))
            current_hash = hashlib.sha256(json.dumps(current, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
            if current_hash != inspected_sha256:
                raise WLEDStateChanged("the device changed; inspect the current state and confirm again")
            await self._retry_busy(lambda: self._http.post("/json/state", json=payload))
            return await self._retry_busy(lambda: self._http.get("/json/state"))

    async def _wait_pin_cooldown(self) -> None:
        wait = PIN_COOLDOWN_S - (self._clock() - _last_pin_check.get(self.base_url, -1e9))
        if wait > 0:
            await self._sleep(wait)

    async def _unlock(self) -> None:
        await self._wait_pin_cooldown()
        _last_pin_check[self.base_url] = self._clock()
        await self._retry_busy(lambda: self._http.post("/json/state", json={"pin": self._pin}))

    async def _lock(self) -> None:
        try:
            await self._http.get("/settings/lock")
        except httpx.HTTPError:
            log.warning("could not lock %s again", self.base_url)

    @contextlib.asynccontextmanager
    async def unlocked(self):
        """Hold the device's write lock with the settings PIN unlocked; always lock again."""
        async with device_lock(self.base_url):
            if self._pin is not None:
                await self._unlock()
            try:
                yield
            finally:
                if self._pin is not None:
                    await self._lock()

    async def _upload_raw(self, name: str, content: bytes) -> None:
        files = {"data": (f"/{name.lstrip('/')}", content, "application/octet-stream")}
        try:
            r = await self._http.post("/upload", files=files)
        except httpx.HTTPError as e:
            raise WLEDError(f"upload {name}: {e.__class__.__name__}") from None
        if r.status_code == 401:
            raise WLEDLocked(f"upload {name}: the device refused it (settings PIN missing or wrong)")
        if r.status_code != 200:
            raise WLEDError(f"upload {name}: HTTP {r.status_code}")

    async def upload(self, name: str, content: bytes) -> None:
        """Upload one file with the device unlocked (if a PIN is set)."""
        async with self.unlocked():
            await self._upload_raw(name, content)

    async def cfg_file(self) -> dict:
        """cfg.json as the device serves it (WLED leaves the secrets out; they're in wsec.json)."""
        return await self.get_json("/cfg.json")

    # --- firmware ---
    async def flash(self, image: bytes, *, timeout: float = FLASH_TIMEOUT_S) -> str:
        """Upload a firmware image to WLED's /update, unlocked; WLED validates its release
        metadata (never skipped here), writes the other OTA slot and reboots. Returns WLED's
        message; raises WLEDLocked (PIN or OTA lock) or WLEDError (refused or failed)."""
        async with self.unlocked():
            try:
                r = await self._http.post("/update", files={"update": ("firmware.bin", image, "application/octet-stream")},
                                          timeout=timeout)
            except httpx.HTTPError as e:
                raise WLEDError(f"firmware upload: {e.__class__.__name__}") from None
            return _ota_answer(r, "Update successful")

    async def revert(self) -> str:
        """Boot the image in the other OTA slot again (WLED's /update?revert), unlocked."""
        async with self.unlocked():
            try:
                r = await self._http.get("/update", params={"revert": ""}, timeout=30.0)
            except httpx.HTTPError as e:
                raise WLEDError(f"revert: {e.__class__.__name__}") from None
            return _ota_answer(r, "Reverted")


async def wait_for_reboot(client: WLEDClient, since: float, timing: tuple[float, float]) -> dict:
    """Poll /json/info until the device answers with an uptime from after `since`."""
    interval, timeout = timing
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        await asyncio.sleep(interval)
        try:
            info = await client.info()
        except WLEDError:
            continue
        if isinstance(info.get("uptime"), (int, float)) and info["uptime"] <= time.monotonic() - since + interval + 5:
            return info
    raise WLEDError(f"the device didn't come back within {int(timeout)} s")


def page_text(html: str, limit: int = 200) -> str:
    """The words of one of WLED's small HTML message pages."""
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(text.split())[:limit]


def _ota_answer(r: httpx.Response, success: str) -> str:
    text = page_text(r.text)
    if r.status_code == 401:
        raise WLEDLocked(f"the device refused it: {text or 'access denied'}")
    if r.status_code != 200 or success.lower() not in text.lower():
        raise WLEDError(f"HTTP {r.status_code}: {text or 'no answer'}")
    return text
