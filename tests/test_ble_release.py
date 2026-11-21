"""Regression tests for H70B3 BLE connection ownership (stdlib-only).

The production transport imports Home Assistant and Bleak. Extract its coroutine
with the AST to execute the *actual method body* against a test double without
installing Home Assistant on the CI runner.
"""

from __future__ import annotations

import ast
import asyncio
import logging
import time
import unittest
from pathlib import Path

SOURCE = (
    Path(__file__).resolve().parents[1]
    / "custom_components/govee_led_control/h70b3_ble.py"
)


class TransportError(RuntimeError):
    pass


def load_send_frame():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    cls = next(
        n for n in tree.body if isinstance(n, ast.ClassDef)
        and n.name == "H70B3BleClient"
    )
    func = next(
        n for n in cls.body if isinstance(n, ast.AsyncFunctionDef)
        and n.name == "async_send_frame"
    )
    mod = ast.fix_missing_locations(ast.Module(body=[func], type_ignores=[]))
    namespace = {
        "time": time,
        "RGB": tuple,
        "_LOGGER": logging.getLogger(__name__),
        "H70B3TransportError": TransportError,
    }
    exec(compile(mod, str(SOURCE), "exec"), namespace)
    return namespace["async_send_frame"]


class FakeTransport:
    def __init__(self, fail_once=False):
        self._operation_lock = asyncio.Lock()
        self.fail_once = fail_once
        self.uploads = 0
        self.disconnects = 0
        self.scheduled = 0
        self.cancelled = 0
        self.successful_uploads = 0
        self.last_error = None
        self.last_send_duration = None

    async def _send_frame_unlocked(self, colors, brightness):
        self.uploads += 1
        if self.fail_once and self.uploads == 1:
            raise TransportError("temporary failure")

    async def _disconnect_unlocked(self):
        self.disconnects += 1

    def _schedule_idle_disconnect(self):
        self.scheduled += 1

    def _cancel_idle_disconnect(self):
        self.cancelled += 1


class BleReleaseTests(unittest.TestCase):
    def test_single_image_releases_after_success(self):
        fake = FakeTransport()
        asyncio.run(load_send_frame()(fake, ((255, 0, 0),), 100))
        self.assertEqual(fake.uploads, 1)
        self.assertEqual(fake.disconnects, 1)
        self.assertEqual(fake.cancelled, 1)
        self.assertEqual(fake.scheduled, 0)
        self.assertEqual(fake.successful_uploads, 1)

    def test_explicit_streaming_retains_connection_temporarily(self):
        fake = FakeTransport()
        asyncio.run(
            load_send_frame()(
                fake, ((0, 0, 255),), 50, hold_connection=True
            )
        )
        self.assertEqual(fake.uploads, 1)
        self.assertEqual(fake.disconnects, 0)
        self.assertEqual(fake.cancelled, 0)
        self.assertEqual(fake.scheduled, 1)

    def test_retry_still_releases_after_success(self):
        fake = FakeTransport(fail_once=True)
        asyncio.run(load_send_frame()(fake, ((0, 0, 0),), 100))
        self.assertEqual(fake.uploads, 2)
        self.assertEqual(fake.disconnects, 2)
        self.assertEqual(fake.successful_uploads, 1)


if __name__ == "__main__":
    unittest.main()
