"""Unit tests for pure LAN power protocol without importing HAOS."""
import ast
import ipaddress
import json
from pathlib import Path
import socket
import time
import unittest
from typing import Any
from unittest.mock import MagicMock, patch

PATH = Path(__file__).resolve().parents[1] / "custom_components/govee_led_control/h70b3_lan_power.py"
TREE = ast.parse(PATH.read_text(encoding="utf-8"), filename=str(PATH))
NAMES = {
    "validate_host", "_parse_msg", "_matches_device", "write_power", "discover_host", "_listen"
}
FUNCTIONS = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
SCOPE = {
    "ipaddress": ipaddress,
    "json": json,
    "socket": socket,
    "time": time,
    "Any": Any,
    "_ALLOWED_RANGES": tuple(map(ipaddress.IPv4Network, (
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"
    ))),
    "_RESPONSE_PORT": 4002,
    "_CONTROL_PORT": 4003,
    "_DISCOVERY_ADDR": ("239.255.255.250", 4001),
    "_SCAN": b'{"msg":{"cmd":"scan","data":{"account_topic":"reserve"}}}',
    "_TIMEOUT_SECONDS": 0.01,
}
exec(compile(ast.Module(body=FUNCTIONS, type_ignores=[]), str(PATH), "exec"), SCOPE)

class TestH70B3LANPower(unittest.TestCase):
    def test_only_local_rfc1918_numeric_ipv4(self) -> None:
        validate = SCOPE["validate_host"]
        self.assertEqual(validate(" 192.168.1.50 "), "192.168.1.50")
        self.assertEqual(validate("10.42.0.5"), "10.42.0.5")
        self.assertEqual(validate("172.16.1.2"), "172.16.1.2")
        for host in ("example.com", "127.0.0.1", "0.0.0.0", "8.8.8.8", "224.0.0.1", "bad"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                validate(host)

    def test_matching_exact_h70b3_mac_suffix(self) -> None:
        match = SCOPE["_matches_device"]
        ble = "02:11:22:33:44:55"
        self.assertTrue(match({"sku":"H70B3","device":"17:10:02:11:22:33:44:55"}, ble))
        self.assertFalse(match({"sku":"H70B1","device":"17:10:02:11:22:33:44:55"}, ble))
        self.assertFalse(match({"sku":"H70B3","device":"17:10:02:11:22:33:44:56"}, ble))

    def test_send_exact_documented_govee_turn_udp(self) -> None:
        fake = MagicMock()
        fake.__enter__.return_value = fake
        with patch.object(socket, "socket", return_value=fake):
            SCOPE["write_power"]("192.168.1.50", True)
            SCOPE["write_power"]("192.168.1.50", False)
        self.assertEqual(fake.sendto.call_count, 2)
        sent = fake.sendto.call_args_list
        for expected, call in zip((1,0), sent):
            body, endpoint = call.args
            self.assertEqual(endpoint, ("192.168.1.50", 4003))
            self.assertEqual(json.loads(body)["msg"], {"cmd":"turn","data":{"value":expected}})

    def test_parse_valid_and_unexpected_packets(self) -> None:
        parse = SCOPE["_parse_msg"]
        self.assertEqual(parse(b'{"msg":{"cmd":"devStatus","data":{"onOff":1}}}'),
                         ("devStatus",{"onOff":1}))
        for packet in (b"", b"\xff", b"{}", b"not-json"):
            self.assertEqual(parse(packet), (None, {}))

    def test_autodiscovery_filters_other_govee_products(self) -> None:
        fake = MagicMock()
        fake.__enter__.return_value = fake
        fake.recvfrom.side_effect = [
            (b'{"msg":{"cmd":"scan","data":{"sku":"H70B3","device":"17:10:02:11:22:33:44:56"}}}', ("192.168.0.200",4002)),
            (b'{"msg":{"cmd":"scan","data":{"sku":"H70B3","device":"17:10:02:11:22:33:44:55","ip":"192.168.0.99"}}}', ("192.168.1.50",4002)),
        ]
        with patch.object(socket, "socket", return_value=fake):
            self.assertEqual(SCOPE["discover_host"]("02:11:22:33:44:55"), "192.168.1.50")
        fake.bind.assert_called_with(("",4002))
        fake.sendto.assert_called_with(SCOPE["_SCAN"], ("239.255.255.250",4001))


if __name__ == "__main__":
    unittest.main()
