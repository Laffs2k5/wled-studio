# SPDX-License-Identifier: EUPL-1.2
"""Run the fake WLED device: python -m wledstudio.fakewled [--port 8081] [--pin 1234]"""
import argparse
import os

import uvicorn

from .app import FakeDevice, create_app


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default=os.environ.get("FAKE_WLED_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("FAKE_WLED_PORT", "8081")))
    ap.add_argument("--pin", default=os.environ.get("FAKE_WLED_PIN") or None)
    ap.add_argument("--leds", type=int, default=int(os.environ.get("FAKE_WLED_LEDS", "60")))
    a = ap.parse_args()
    uvicorn.run(create_app(FakeDevice(led_count=a.leds, pin=a.pin)), host=a.host, port=a.port, log_level="info")


if __name__ == "__main__":
    main()
