# SPDX-License-Identifier: EUPL-1.2
"""DDP (Distributed Display Protocol) packets, as WLED receives them on UDP port 4048.

Header (10 bytes): flags (version 1, push on the last packet of a frame), sequence
(1-15), data type (RGB24 or RGBW32), destination (1 = the display), data offset in
bytes (32-bit, big-endian), data length (16-bit, big-endian). At most 1440 data
bytes per packet. Matches WLED's own sender (wled00/udp.cpp, realtimeBroadcast).
"""
from __future__ import annotations

import asyncio
import struct

DDP_PORT = 4048
FLAGS_VER1 = 0x40
FLAGS_PUSH = 0x01
TYPE_RGB24 = 0x0B
TYPE_RGBW32 = 0x1B
ID_DISPLAY = 1
MAX_DATA = 1440


def packets(pixels: bytes, channels: int, seq: int) -> list[bytes]:
    """One frame -> its DDP packets. channels: 3 (RGB) or 4 (RGBW)."""
    if channels not in (3, 4):
        raise ValueError("channels must be 3 or 4")
    if not pixels or len(pixels) % channels:
        raise ValueError("pixel data must be a whole number of pixels")
    per_packet = MAX_DATA - (MAX_DATA % channels)
    out = []
    for off in range(0, len(pixels), per_packet):
        chunk = pixels[off:off + per_packet]
        last = off + per_packet >= len(pixels)
        flags = FLAGS_VER1 | (FLAGS_PUSH if last else 0)
        header = struct.pack(">BBBBIH", flags, (seq % 15) + 1, TYPE_RGBW32 if channels == 4 else TYPE_RGB24,
                             ID_DISPLAY, off, len(chunk))
        out.append(header + chunk)
    return out


class Sender:
    """Sends frames to one device over UDP."""

    def __init__(self, host: str, port: int = DDP_PORT):
        self.addr = (host, port)
        self.seq = 0
        self.transport: asyncio.DatagramTransport | None = None

    async def open(self) -> None:
        loop = asyncio.get_running_loop()
        self.transport, _ = await loop.create_datagram_endpoint(asyncio.DatagramProtocol, remote_addr=self.addr)

    def send(self, pixels: bytes, channels: int) -> int:
        assert self.transport is not None
        pk = packets(pixels, channels, self.seq)
        self.seq += 1
        for p in pk:
            self.transport.sendto(p)
        return len(pk)

    def close(self) -> None:
        if self.transport is not None:
            self.transport.close()
