# SPDX-License-Identifier: EUPL-1.2
"""Settings, from environment variables (WLEDSTUDIO_*)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _list(name: str, default: str) -> list[str]:
    return [x.strip() for x in os.environ.get(name, default).split(",") if x.strip()]


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("WLEDSTUDIO_DATA", "./data")).resolve())
    # Host header values the app answers to (DNS-rebinding protection). "*" disables the check.
    allowed_hosts: list[str] = field(default_factory=lambda: _list(
        "WLEDSTUDIO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]"))
    # Device hosts must resolve to private/loopback/link-local addresses unless this is set.
    allow_public_devices: bool = field(default_factory=lambda: os.environ.get(
        "WLEDSTUDIO_ALLOW_PUBLIC_DEVICES", "") == "1")
    # Optional shared token; when set, every API request needs "Authorization: Bearer <token>".
    token: str | None = field(default_factory=lambda: os.environ.get("WLEDSTUDIO_TOKEN") or None)
    static_dir: Path | None = field(default_factory=lambda: Path(p) if (p := os.environ.get("WLEDSTUDIO_STATIC")) else None)
    # The firmware builder's job service (wled-studio-builder), e.g. http://builder:8090; unset = off.
    builder_url: str | None = field(default_factory=lambda: os.environ.get("WLEDSTUDIO_BUILDER_URL") or None)
    builder_token: str | None = field(default_factory=lambda: os.environ.get("WLEDSTUDIO_BUILDER_TOKEN") or None)
    max_body_bytes: int = 1_000_000
    device_timeout_s: float = 5.0
