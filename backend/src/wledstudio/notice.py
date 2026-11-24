# SPDX-License-Identifier: EUPL-1.2
"""The notice a user accepts before flashing or reverting firmware.

One source: the API serves it to the UI, and DISCLAIMER.md in the repository carries the same text
(a test keeps them equal). A new VERSION asks everyone again, including those who chose not to be
asked. Flash and revert requests must name the version they accepted; the backend refuses others.
"""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter()

VERSION = "2026-11-24"
TITLE = "Flashing firmware: no warranty, no liability, no support"
TEXT = """\
wled-studio can write firmware to your devices and revert it. A firmware update can fail or be
interrupted, and can leave a device unable to start ("bricked"), erase or change its configuration,
or cause connected hardware, such as LED strips and power supplies, to behave unexpectedly or be
damaged. The checks this software makes before and after a flash reduce some of these risks; they
do not remove them, and they may themselves be wrong.

1. No warranty. This software is provided "as is", without warranty of any kind, express or
   implied, including warranties of merchantability, fitness for a particular purpose and
   non-infringement, as set out in Article 7 (Disclaimer of Warranty) of the European Union Public
   Licence (EUPL-1.2) under which it is licensed. Its features, including building, flashing and
   reverting firmware and the checks around them, may contain defects and may not work with your
   device, its firmware or its configuration.

2. No liability. To the fullest extent permitted by applicable law, and as set out in Article 8
   (Limitation of Liability) of the EUPL-1.2, the authors and contributors are not liable for any
   damage or loss arising from the use of this software or from being unable to use it. This
   includes failed or interrupted firmware updates, devices that no longer start, lost or changed
   configuration or data, damaged hardware, and any direct, indirect, incidental or consequential
   loss. Nothing in this notice limits liability that cannot be limited under applicable law.

3. No support. The authors offer no support of any kind. There is no help with installing, using
   or troubleshooting this software, or with recovering a device, and no obligation to answer
   questions, issues or requests, or to fix defects.

4. Your own risk and responsibility. You use this software entirely at your own risk and are
   solely responsible for your devices: for keeping backups, for being able to recover a device
   without this software (for example by flashing it over USB), and for making sure that any
   firmware you flash is right for your hardware.

5. No affiliation. wled-studio is an independent project. It is not affiliated with or endorsed by
   the WLED project or any hardware vendor.

If you do not accept these terms, do not use the flashing and reverting features.
"""


class AcceptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(max_length=32)
    remember: bool = False


def _file(request: Request):
    return request.app.state.settings.data_dir / "notices.json"


def remembered(request: Request) -> dict | None:
    """The stored "don't show this again" acceptance, if it's for the current version."""
    p = _file(request)
    if not p.exists():
        return None
    entry = json.loads(p.read_text(encoding="utf-8")).get("flash")
    return entry if isinstance(entry, dict) and entry.get("version") == VERSION else None


def require_accepted(version: str | None) -> None:
    """A flash or revert must carry acceptance of the current notice."""
    if version != VERSION:
        raise HTTPException(428, "accept the flashing notice first")


@router.get("/api/notices/flash")
def get_notice(request: Request):
    entry = remembered(request)
    return {"version": VERSION, "title": TITLE, "text": TEXT, "remembered": entry is not None,
            "accepted": entry.get("accepted") if entry else None}


@router.post("/api/notices/flash")
def accept_notice(body: AcceptIn, request: Request):
    """Accepting the notice; with `remember`, it isn't shown again until its text changes."""
    if body.version != VERSION:
        raise HTTPException(409, "the notice has changed: read it again")
    accepted = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    if body.remember:
        p = _file(request)
        p.parent.mkdir(parents=True, exist_ok=True)
        data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        data["flash"] = {"version": VERSION, "accepted": accepted}
        p.write_text(json.dumps(data, indent=1), encoding="utf-8")
    return {"version": VERSION, "accepted": accepted, "remembered": body.remember}


@router.delete("/api/notices/flash")
def forget_notice(request: Request):
    """Show the notice again before the next flash."""
    p = _file(request)
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        data.pop("flash", None)
        p.write_text(json.dumps(data, indent=1), encoding="utf-8")
    return {"remembered": False}
