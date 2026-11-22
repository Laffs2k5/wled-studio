# SPDX-License-Identifier: EUPL-1.2
"""Validate device host names: the app makes HTTP requests to them (SSRF guard).

A device host is a host name or IP address with an optional port: no scheme, no
path, no user info. It must resolve, and every address it resolves to must be
private, loopback or link-local, unless public devices are explicitly allowed.
"""
from __future__ import annotations

import ipaddress
import re
import socket

HOST_RE = re.compile(r"^(?P<host>[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::(?P<port>\d{1,5}))?$")


class HostError(ValueError):
    pass


def split_host(value: str) -> tuple[str, int | None]:
    m = HOST_RE.match(value.strip())
    if not m:
        raise HostError("a device host is a name or IP address with an optional :port, nothing else")
    host = m.group("host").strip("[]")
    port = int(m.group("port")) if m.group("port") else None
    if port is not None and not 0 < port < 65536:
        raise HostError("port out of range")
    return host, port


def _is_internal(ip: ipaddress._BaseAddress) -> bool:
    return ip.is_private or ip.is_loopback or ip.is_link_local


def resolve(host: str) -> list[ipaddress._BaseAddress]:
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise HostError(f"can't resolve {host!r}") from None
    return [ipaddress.ip_address(i[4][0].split("%")[0]) for i in infos]


def check_device_host(value: str, allow_public: bool = False, resolver=resolve) -> str:
    """Return the normalised host[:port], or raise HostError."""
    host, port = split_host(value)
    addrs = resolver(host)
    if not addrs:
        raise HostError(f"can't resolve {host!r}")
    if not allow_public:
        bad = [str(a) for a in addrs if not _is_internal(a)]
        if bad:
            raise HostError(f"{host!r} resolves to a public address ({', '.join(bad)}); "
                            "set WLEDSTUDIO_ALLOW_PUBLIC_DEVICES=1 to allow it")
    shown = f"[{host}]" if ":" in host else host
    return f"{shown}:{port}" if port else shown
