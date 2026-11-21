"""Regression tests for Govee H70B3 discovery using the ESPHome BLE cache."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

FILE = (
    Path(__file__).resolve().parents[1]
    / "custom_components/govee_led_control/h70b3_discovery.py"
)
spec = importlib.util.spec_from_file_location("h70b3_discovery_test", FILE)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
discovered_h70b3 = module.discovered_h70b3
discovery_diagnostic = module.discovery_diagnostic


def item(name, address, connectable=True):
    return SimpleNamespace(name=name, address=address, connectable=connectable)


class DiscoveryTests(unittest.TestCase):
    def test_proxied_h70b3_is_preselected_by_mac(self):
        seen = [
            item("Govee_H70B3_ABCD", "aa:bb:cc:dd:ee:ff"),
            item("Govee_H70B1_ABCD", "12:34:56:78:90:ab"),
        ]
        self.assertEqual(
            discovered_h70b3(seen),
            {"AA:BB:CC:DD:EE:FF": "Govee_H70B3_ABCD"},
        )

    def test_existing_devices_are_filtered(self):
        seen = [item("Govee_H70B3_ABCD", "AA:BB:CC:DD:EE:FF")]
        self.assertEqual(discovered_h70b3(seen, ["aa:bb:cc:dd:ee:ff"]), {})

    def test_non_connectable_and_invalid_addresses_are_filtered(self):
        seen = [
            item("Govee_H70B3_ABCD", "AA:BB:CC:DD:EE:FF", False),
            item("Govee_H70B3_BAD", "not-a-mac"),
        ]
        self.assertEqual(discovered_h70b3(seen), {})

    def test_repeated_proxy_advertisements_do_not_duplicate(self):
        seen = [item("Govee_H70B3_Z", "AA:BB:CC:DD:EE:FF")] * 3
        self.assertEqual(len(discovered_h70b3(seen)), 1)

    def test_alternate_gvh70b3_prefix(self):
        self.assertEqual(
            discovered_h70b3([item("GVH70B3_A", "AA:00:00:00:00:01")]),
            {"AA:00:00:00:00:01": "GVH70B3_A"},
        )

    def test_diagnostic_no_scanner(self):
        self.assertIn("aucun scanner Bluetooth", discovery_diagnostic([], [], 0))

    def test_diagnostic_no_advertisements(self):
        self.assertIn("aucune annonce reçue", discovery_diagnostic([], [], 1))

    def test_diagnostic_h70b3_only_nonconnectable(self):
        item_nonconn = item("Govee_H70B3_123", "AA:BB:CC:DD:EE:FF", False)
        self.assertIn(
            "sans connexion BLE possible",
            discovery_diagnostic([item_nonconn], [], 1),
        )

    def test_diagnostic_other_ble_devices_visible(self):
        normal = item("Other device", "AA:BB:CC:DD:EE:AA")
        message = discovery_diagnostic([normal], [normal], 1)
        self.assertIn("H70B3 non détectée", message)

    def test_name_can_fallback_to_ble_device_name(self):
        info = SimpleNamespace(
            name=None,
            address="AA:00:00:00:00:02",
            connectable=True,
            device=SimpleNamespace(name="Govee_H70B3_02"),
        )
        self.assertEqual(
            discovered_h70b3([info]),
            {"AA:00:00:00:00:02": "Govee_H70B3_02"},
        )


if __name__ == "__main__":
    unittest.main()
