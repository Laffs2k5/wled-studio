# SPDX-License-Identifier: EUPL-1.2
"""Run wled-studio: python -m wledstudio [--host 127.0.0.1] [--port 8080]"""
import argparse
import os

import uvicorn

from .app import create_app


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default=os.environ.get("WLEDSTUDIO_BIND", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("WLEDSTUDIO_PORT", "8080")))
    a = ap.parse_args()
    uvicorn.run(create_app(), host=a.host, port=a.port, proxy_headers=False, server_header=False,
                log_level="info")


if __name__ == "__main__":
    main()
