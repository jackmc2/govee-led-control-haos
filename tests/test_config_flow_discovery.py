"""Exercise the real Home Assistant config-flow methods without HA dependencies.

This specifically guards against blank menu items and ignored fallback choices.
"""
from __future__ import annotations

import ast
import asyncio
import importlib.util
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / "custom_components/govee_led_control/config_flow.py"
DISCOVERY = ROOT / "custom_components/govee_led_control/h70b3_discovery.py"
spec = importlib.util.spec_from_file_location("discovery_for_flow", DISCOVERY)
assert spec is not None and spec.loader is not None
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def load_steps(advertisements: list[object], connectable_ads=None):
    tree = ast.parse(FLOW.read_text(encoding="utf-8"))
    cls = next(node for node in tree.body
               if isinstance(node, ast.ClassDef)
               and node.name == "GoveeAdvancedConfigFlow")
    wanted = {"async_step_user", "async_step_not_found"}
    methods = [node for node in cls.body
               if isinstance(node, ast.AsyncFunctionDef) and node.name in wanted]
    assert len(methods) == 2
    module = ast.fix_missing_locations(ast.Module(
        body=[
            ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0),
            *methods,
        ],
        type_ignores=[],
    ))
    vol = types.SimpleNamespace(
        Required=lambda key, default=None: key,
        In=lambda mapping: mapping,
        Schema=lambda schema: schema,
    )
    if connectable_ads is None:
        connectable_ads = advertisements
    namespace = {
        "bluetooth": types.SimpleNamespace(
            async_discovered_service_info=lambda _hass, connectable: (
                connectable_ads if connectable else advertisements
            ),
            async_scanner_count=lambda _hass, connectable: 1,
            async_ble_device_from_address=lambda _hass, address, connectable: (
                object() if any(
                    d.address.upper() == address.upper() for d in connectable_ads
                ) else None
            ),
        ),
        "discovered_h70b3": helper.discovered_h70b3,
        "discovery_diagnostic": helper.discovery_diagnostic,
        "vol": vol,
        "CONF_ADDRESS": "address",
        "CONF_MODEL": "model",
        "MODEL_H70B3": "h70b3",
        "MODEL_H6069": "h6069",
    }
    exec(compile(module, str(FLOW), "exec"), namespace)
    return namespace


class FakeFlow:
    def __init__(self) -> None:
        self.hass = object()
        self.selected = None
        self.unique_id = None

    def _async_current_entries(self):
        return []

    def async_show_form(self, *, step_id, data_schema):
        return {"step_id": step_id, "fields": data_schema}

    async def async_step_h70b3(self):
        return {"type": "manual_h70b3"}

    async def async_step_h6069(self):
        return {"type": "lan_h6069"}

    async def async_step_refresh(self):
        return await self.async_step_user()

    async def async_set_unique_id(self, value):
        self.unique_id = value

    def _abort_if_unique_id_configured(self):
        return None

    def _create_h70b3_entry(self, address, name):
        self.selected = (address, name)
        return {"type": "created"}


class ConfigFlowDiscoveryTests(unittest.TestCase):
    def setup_flow(self, advertisements, connectable_ads=None):
        methods = load_steps(advertisements, connectable_ads)
        flow = FakeFlow()
        flow.async_step_user = types.MethodType(methods["async_step_user"], flow)
        flow.async_step_not_found = types.MethodType(methods["async_step_not_found"], flow)
        return flow

    def test_no_detection_shows_three_nonempty_choices(self):
        flow = self.setup_flow([])
        page = asyncio.run(flow.async_step_user())
        self.assertEqual(page["step_id"], "not_found")
        choices = page["fields"]["device"]
        self.assertEqual(set(choices), {"refresh", "h70b3", "h6069"})
        self.assertTrue(all(isinstance(x, str) and x.strip() for x in choices.values()))
        self.assertIn("aucune annonce reçue", choices["refresh"])

    def test_manual_choice_is_not_ignored(self):
        flow = self.setup_flow([])
        result = asyncio.run(flow.async_step_not_found({"device": "h70b3"}))
        self.assertEqual(result, {"type": "manual_h70b3"})

    def test_h6069_choice_is_not_ignored(self):
        flow = self.setup_flow([])
        result = asyncio.run(flow.async_step_not_found({"device": "h6069"}))
        self.assertEqual(result, {"type": "lan_h6069"})

    def test_h70b3_seen_in_haos_but_missing_from_connectable_cache(self):
        item = types.SimpleNamespace(
            name="Govee_H70B3_4148",
            address="02:11:22:33:44:55",
            connectable=False,
        )
        flow = self.setup_flow([item], connectable_ads=[])
        page = asyncio.run(flow.async_step_user())
        self.assertEqual(page["step_id"], "user")
        option = page["fields"]["device"]["02:11:22:33:44:55"]
        self.assertIn("Govee_H70B3_4148", option)
        self.assertIn("connexion BLE à vérifier", option)
        result = asyncio.run(
            flow.async_step_user({"device": "02:11:22:33:44:55"})
        )
        self.assertEqual(result, {"type": "created"})
        self.assertEqual(flow.selected[0], "02:11:22:33:44:55")

    def test_detected_h70b3_uses_advertised_mac(self):
        item = types.SimpleNamespace(
            name="Govee_H70B3_1234", address="aa:bb:cc:dd:ee:ff",
            connectable=True,
        )
        flow = self.setup_flow([item])
        page = asyncio.run(flow.async_step_user())
        self.assertEqual(page["step_id"], "user")
        self.assertIn("AA:BB:CC:DD:EE:FF", page["fields"]["device"])
        result = asyncio.run(flow.async_step_user({"device": "AA:BB:CC:DD:EE:FF"}))
        self.assertEqual(result, {"type": "created"})
        self.assertEqual(flow.selected, ("AA:BB:CC:DD:EE:FF", "Govee_H70B3_1234"))
        self.assertEqual(flow.unique_id, "h70b3_AA:BB:CC:DD:EE:FF")


if __name__ == "__main__":
    unittest.main()
