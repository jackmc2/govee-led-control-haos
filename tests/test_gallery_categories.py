"""Regression tests for persisted gallery category management (no HA install needed)."""

import ast
from copy import deepcopy
from datetime import UTC, datetime
import importlib.util
from pathlib import Path
from typing import Any
import unittest
from uuid import uuid4

ROOT = Path(__file__).parents[1] / "custom_components" / "govee_led_control"
SPEC = importlib.util.spec_from_file_location("gallery_category_data", ROOT / "gallery_data.py")
data = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(data)

# Isolate the storage model, which has no HA logic in its methods, from
# Home Assistant's WebSocket/Store imports (not installed in unit-test CI).
source = ast.parse((ROOT / "gallery.py").read_text(encoding="utf-8"))
klass = next(node for node in source.body if isinstance(node, ast.ClassDef)
             and node.name == "ArtworkGallery")
namespace = {
    "deepcopy": deepcopy, "UTC": UTC, "datetime": datetime,
    "uuid4": uuid4, "Any": Any, "HomeAssistant": object,
    "Store": object, "MAX_ITEMS": data.MAX_ITEMS,
    "MAX_CATEGORIES": data.MAX_CATEGORIES,
    "validate_gallery_category": data.validate_gallery_category,
    "validate_gallery_item": data.validate_gallery_item,
}
exec(compile(ast.Module(body=[klass], type_ignores=[]), str(ROOT / "gallery.py"), "exec"), namespace)
ArtworkGallery = namespace["ArtworkGallery"]


class MemoryStore:
    def __init__(self, payload=None):
        self.payload = deepcopy(payload) if payload is not None else None

    async def async_load(self):
        return deepcopy(self.payload)

    async def async_save(self, data):
        self.payload = deepcopy(data)


class CategoryManagementTests(unittest.IsolatedAsyncioTestCase):
    async def gallery(self, stored=None):
        gallery = ArtworkGallery.__new__(ArtworkGallery)
        gallery._store = MemoryStore(stored)
        await gallery.async_load()
        return gallery

    @staticmethod
    def art(name="Sapin", category="Noël"):
        return {"id": "old", "name": name, "category": category, "target": "h70b3",
                "kind": "art", "brightness": 65, "colors": ["#123456"] * 520}

    async def test_migrate_old_items_and_preserve_pixels_and_brightness(self):
        original = self.art()
        also = {**self.art("Boule", "noël"), "id": "second"}
        gallery = await self.gallery({"items": [original, also], "player_brightness": 42})
        self.assertEqual(gallery.categories(), ["Noël"])
        self.assertEqual(gallery.player_brightness(), 42)
        self.assertEqual(gallery.items()[0]["colors"], original["colors"])
        self.assertEqual(gallery.items()[1]["category"], "noël")
        await gallery.async_manage_category("rename", "NOËL", "Fêtes")
        self.assertEqual([item["category"] for item in gallery.items()], ["Fêtes", "Fêtes"])
        self.assertEqual(gallery._store.payload["categories"], ["Fêtes"])
        reloaded = await self.gallery(gallery._store.payload)
        self.assertEqual(reloaded.categories(), ["Fêtes"])
        self.assertEqual(reloaded.player_brightness(), 42)
        self.assertEqual(reloaded.items()[0]["brightness"], 65)
        self.assertEqual(reloaded.items()[0]["colors"], original["colors"])

    async def test_empty_categories_and_delete_without_deleting_art(self):
        gallery = await self.gallery({"items": [self.art()]})
        await gallery.async_manage_category("create", " Halloween ")
        self.assertIn("Halloween", gallery.categories())
        await gallery.async_delete_item("old")
        self.assertIn("Noël", gallery.categories())  # Remains with zero artworks
        reloaded = await self.gallery(gallery._store.payload)
        self.assertIn("Halloween", reloaded.categories())
        new = await reloaded.async_save_item({
            "name": "Fantôme", "target": "h70b3", "kind": "art",
            "category": "Halloween", "colors": ["#aabbcc"] * 520,
        })
        self.assertEqual(new["category"], "Halloween")
        await reloaded.async_manage_category("delete", "HALLOWEEN")
        self.assertEqual(reloaded.items()[0]["category"], "")
        self.assertEqual(reloaded.items()[0]["colors"], ["#aabbcc"] * 520)
        self.assertNotIn("Halloween", reloaded.categories())
        self.assertIn("Noël", reloaded.categories())

    async def test_legacy_client_preserves_existing_category_on_save(self):
        gallery = await self.gallery({"items": [self.art()]})
        raw = self.art()
        del raw["category"]
        saved = await gallery.async_save_item(raw)
        self.assertEqual(saved["category"], "Noël")
        new = self.art()
        new["category"] = "noël"
        self.assertEqual((await gallery.async_save_item(new))["category"], "Noël")

    async def test_invalid_and_duplicate_category_operations(self):
        gallery = await self.gallery({"items": [self.art()]})
        for action, name, new_name in [
            ("create", "noël", None),
            ("create", "Non classé", None),
            ("create", "X" * 41, None),
            ("create", "A\nB", None),
            ("rename", "unknown", "Hiver"),
            ("rename", "Noël", ""),
            ("delete", "unknown", None),
        ]:
            with self.subTest(action=action, name=name), self.assertRaises(ValueError):
                await gallery.async_manage_category(action, name, new_name)
        self.assertEqual(gallery.categories(), ["Noël"])


if __name__ == "__main__":
    unittest.main()
