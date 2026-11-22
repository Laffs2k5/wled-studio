# SPDX-License-Identifier: EUPL-1.2
"""A fake WLED device for tests and the demo mode."""
from .app import EFFECTS, PALETTES, FakeDevice, create_app

__all__ = ["EFFECTS", "PALETTES", "FakeDevice", "create_app"]
