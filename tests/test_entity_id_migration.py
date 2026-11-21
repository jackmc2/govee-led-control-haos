"""Safeguard semantic HAOS entity IDs and migration of legacy Dutch slugs."""

from __future__ import annotations

import ast
import logging
import unittest
from pathlib import Path
from types import SimpleNamespace

FILE = (
    Path(__file__).resolve().parents[1]
    / "custom_components/govee_led_control/entity_id_migration.py"
)


def load_functions():
    parsed = ast.parse(FILE.read_text(encoding="utf-8"))
    definitions = [
        node for node in parsed.body
        if isinstance(node, ast.FunctionDef)
        and node.name in {"proposed_entity_id", "migrate_legacy_entity_ids"}
    ]
    suffixes = next(
        node for node in parsed.body if isinstance(node, ast.AnnAssign)
        and isinstance(node.target, ast.Name)
        and node.target.id == "_LEGACY_SUFFIXES"
    )
    regex_definitions = [
        node for node in parsed.body if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Name) and target.id in
            {"_LED_LEGACY", "_PANEL_LEGACY"}
            for target in node.targets
        )
    ]
    module = ast.fix_missing_locations(ast.Module(
        body=[
            ast.ImportFrom(
                module="__future__", names=[ast.alias(name="annotations")],
                level=0,
            ),
            *regex_definitions,
            suffixes,
            *definitions,
        ],
        type_ignores=[],
    ))
    namespace = {
        "DOMAIN": "govee_led_control",
        "_LOGGER": logging.getLogger(__name__),
        "re": __import__("re"),
    }
    exec(compile(module, str(FILE), "exec"), namespace)
    return namespace


class FakeRegistry:
    def __init__(self, entries):
        self.entities = {entry.entity_id: entry for entry in entries}
        self.migrations = []

    def async_update_entity(self, old_id, *, new_entity_id):
        entry = self.entities.pop(old_id)
        self.entities[new_entity_id] = entry
        self.migrations.append((old_id, new_entity_id))


class EntityIdMigrationTests(unittest.TestCase):
    def setUp(self):
        self.ns = load_functions()

    def test_transport_sensor_has_semantic_id(self):
        self.assertEqual(
            self.ns["proposed_entity_id"](
                "sensor.govee_h70b3_4148_volledige_controle_via"
            ),
            "sensor.govee_h70b3_4148_transport",
        )

    def test_other_dutch_controls_have_english_suffixes(self):
        cases = {
            "switch.govee_h70b3_4148_horizontaal_spiegelen":
                "switch.govee_h70b3_4148_flip_horizontal",
            "switch.govee_h70b3_4148_verticaal_spiegelen":
                "switch.govee_h70b3_4148_flip_vertical",
            "button.govee_h70b3_4148_alles_zwart":
                "button.govee_h70b3_4148_clear",
            "number.govee_h70b3_4148_demo_sensorniveau":
                "number.govee_h70b3_4148_visual_level",
            "select.govee_h70b3_4148_sensorvisualisatie":
                "select.govee_h70b3_4148_visual_style",
            "sensor.h6069_paneelindeling": "sensor.h6069_topology",
        }
        for before, after in cases.items():
            with self.subTest(before=before):
                self.assertEqual(self.ns["proposed_entity_id"](before), after)

    def test_legacy_led_and_panel_ids_convert_to_meaningful_english(self):
        self.assertEqual(
            self.ns["proposed_entity_id"]("light.govee_h70b3_4148_led_r01_k01"),
            "light.govee_h70b3_4148_led_row01_col01",
        )
        self.assertEqual(
            self.ns["proposed_entity_id"]("light.govee_h70b3_4148_led_r26_k20"),
            "light.govee_h70b3_4148_led_row26_col20",
        )
        self.assertEqual(
            self.ns["proposed_entity_id"]("light.govee_h6069_paneel_01"),
            "light.govee_h6069_panel_01",
        )

    def test_custom_ids_and_new_pixel_ids_are_unchanged(self):
        for value in (
            "sensor.salon_govee",
            "light.govee_h70b3_4148_led_row01_col01",
            "sensor.govee_h70b3_4148_transport",
        ):
            self.assertIsNone(self.ns["proposed_entity_id"](value))

    def test_migrate_only_matching_platform_and_entry_and_skip_conflicts(self):
        entries = [
            SimpleNamespace(
                entity_id="sensor.govee_h70b3_4148_volledige_controle_via",
                platform="govee_led_control", config_entry_id="target",
                unique_id="stable_transport",
            ),
            SimpleNamespace(
                entity_id="button.govee_h70b3_4148_alles_zwart",
                platform="govee_led_control", config_entry_id="target",
                unique_id="stable_clear",
            ),
            SimpleNamespace(
                entity_id="sensor.salon_govee",
                platform="govee_led_control", config_entry_id="target",
                unique_id="customized",
            ),
            SimpleNamespace(
                entity_id="sensor.other_volledige_controle_via",
                platform="other", config_entry_id="target",
                unique_id="foreign",
            ),
        ]
        registry = FakeRegistry(entries)
        registry.entities["button.govee_h70b3_4148_clear"] = SimpleNamespace(
            entity_id="button.govee_h70b3_4148_clear",
        )
        self.ns["er"] = SimpleNamespace(
            async_get=lambda hass: registry,
            async_entries_for_config_entry=lambda reg, entry_id: [
                item for item in entries if item.config_entry_id == entry_id
            ],
        )
        self.ns["DOMAIN"] = "govee_led_control"
        hass = SimpleNamespace(states=SimpleNamespace(get=lambda entity_id: None))
        self.assertEqual(self.ns["migrate_legacy_entity_ids"](hass, "target"), 1)
        self.assertEqual(
            registry.migrations,
            [
                (
                    "sensor.govee_h70b3_4148_volledige_controle_via",
                    "sensor.govee_h70b3_4148_transport",
                ),
            ],
        )
        self.assertEqual(entries[0].unique_id, "stable_transport")


if __name__ == "__main__":
    unittest.main()
