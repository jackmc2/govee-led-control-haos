"""Check HA-backed LED Player brightness persistence without HA runtime dependencies."""

from __future__ import annotations

import ast
import asyncio
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "custom_components/govee_led_control/gallery.py"


class InMemoryStore:
    def __init__(self, hass: dict, _version: int, key: str) -> None:
        self.database = hass
        self.key = key

    async def async_load(self) -> dict:
        return deepcopy(self.database.get(self.key, {}))

    async def async_save(self, value: dict) -> None:
        self.database[self.key] = deepcopy(value)


def load_gallery_class():
    source = ast.parse(SOURCE.read_text(encoding="utf-8"))
    cls = next(node for node in source.body if isinstance(node, ast.ClassDef)
               and node.name == "ArtworkGallery")
    module = ast.fix_missing_locations(ast.Module(
        body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), cls],
        type_ignores=[],
    ))
    ns = {
        "Store": InMemoryStore,
        "STORAGE_VERSION": 1,
        "STORAGE_KEY": "govee_led_control.gallery",
        "Any": Any,
        "deepcopy": deepcopy,
        "datetime": datetime,
        "UTC": UTC,
        "uuid4": uuid4,
        "MAX_ITEMS": 50,
        "validate_gallery_item": lambda item: {k:v for k,v in item.items() if k != "id"},
    }
    exec(compile(module, str(SOURCE), "exec"), ns)
    return ns["ArtworkGallery"]


class PlayerBrightnessTests(unittest.TestCase):
    def test_upgrade_existing_gallery_keeps_artwork_and_defaults_to_100(self):
        gallery_type = load_gallery_class()
        store = {"govee_led_control.gallery": {"items": [
            {"id": "existing", "name": "Cadeau", "brightness": 70},
        ]}}

        async def scenario():
            gallery = gallery_type(store)
            await gallery.async_load()
            self.assertEqual(gallery.player_brightness(), 100)
            self.assertEqual(gallery.items()[0]["name"], "Cadeau")
            await gallery.async_set_player_brightness(36)
            self.assertEqual(store["govee_led_control.gallery"]["items"][0]["name"], "Cadeau")
            restored = gallery_type(store)
            await restored.async_load()
            self.assertEqual(restored.player_brightness(), 36)
            self.assertEqual(restored.items()[0]["brightness"], 70)
            # Saving gallery art must not revert persisted player brightness.
            await restored.async_save_item({"id": "existing", "name": "Noël", "brightness": 70})
            reopened = gallery_type(store)
            await reopened.async_load()
            self.assertEqual(reopened.player_brightness(), 36)
            self.assertEqual(reopened.items()[0]["name"], "Noël")
        asyncio.run(scenario())

    def test_invalid_brightness_is_rejected_without_changing_storage(self):
        gallery_type = load_gallery_class()
        store = {}

        async def scenario():
            gallery = gallery_type(store)
            await gallery.async_load()
            for invalid in (0, 101, True, "50", -10):
                with self.assertRaises(ValueError):
                    await gallery.async_set_player_brightness(invalid)
            self.assertEqual(gallery.player_brightness(), 100)
            await gallery.async_set_player_brightness(1)
            await gallery.async_set_player_brightness(100)
            self.assertEqual(gallery.player_brightness(), 100)
        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
