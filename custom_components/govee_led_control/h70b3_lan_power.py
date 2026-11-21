"""Direct H70B3 LAN power control, independent of external HA entities.

Govee's LAN protocol listens for multicast scan on UDP 4001, responds on
UDP 4002, and accepts turn/devStatus commands at the device IP on UDP 4003.
No cloud account, external Govee integration or BLE session is needed.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
import time
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_RUNTIMES, DOMAIN, MODEL_H70B3

_DISCOVERY_ADDR = ("239.255.255.250", 4001)
_CONTROL_PORT = 4003
_RESPONSE_PORT = 4002
_SCAN = b'{"msg":{"cmd":"scan","data":{"account_topic":"reserve"}}}'
_GET_STATUS = b'{"msg":{"cmd":"devStatus","data":{}}}'
_TIMEOUT_SECONDS = 1.4
_POWER_LOCK = asyncio.Lock()
_LAN_IP_CACHE: dict[str, str] = {}
_ALLOWED_RANGES = tuple(
    ipaddress.IPv4Network(prefix)
    for prefix in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def validate_host(raw: str) -> str:
    """Only accept numeric RFC1918 addresses; never resolve arbitrary hosts."""
    try:
        ip = ipaddress.IPv4Address(raw.strip())
    except (ipaddress.AddressValueError, AttributeError) as err:
        raise ValueError("Indiquez une adresse IPv4 locale valide (lan_ip)") from err
    if not any(ip in network for network in _ALLOWED_RANGES):
        raise ValueError("L'adresse du H70B3 doit être privée et sur le LAN")
    return str(ip)


def _listen() -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("", _RESPONSE_PORT))
        sock.settimeout(_TIMEOUT_SECONDS)
    except OSError:
        sock.close()
        raise
    return sock


def _parse_msg(packet: bytes) -> tuple[str | None, dict[str, Any]]:
    try:
        msg = json.loads(packet.decode("utf-8", errors="strict"))["msg"]
        return msg.get("cmd"), msg.get("data", {})
    except (KeyError, TypeError, ValueError, UnicodeDecodeError):
        return None, {}


def _matches_device(reply: dict[str, Any], ble_mac: str) -> bool:
    if str(reply.get("sku", "")).upper() != "H70B3":
        return False
    expected = "".join(c for c in ble_mac.upper() if c in "0123456789ABCDEF")
    device = "".join(c for c in str(reply.get("device", "")).upper() if c in "0123456789ABCDEF")
    # Govee LAN device IDs contain a prefix followed by its BLE MAC.
    return bool(expected) and device.endswith(expected)


def discover_host(ble_mac: str) -> str:
    """Find THIS H70B3, not just any Govee on the user's local network."""
    with _listen() as sock:
        sock.sendto(_SCAN, _DISCOVERY_ADDR)
        deadline = time.monotonic() + _TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            sock.settimeout(max(0.05, deadline - time.monotonic()))
            try:
                packet, address = sock.recvfrom(4096)
            except socket.timeout:
                break
            cmd, data = _parse_msg(packet)
            if cmd != "scan" or not _matches_device(data, ble_mac):
                continue
            # The packet source is authoritative; don't trust an advertised IP.
            return validate_host(address[0])
    raise ConnectionError(
        "H70B3 non découvert sur le LAN. Ajoutez lan_ip: 192.168.1.50 "
        "dans la carte LED Player si l'adresse est toujours celle du rideau."
    )


def read_power(host: str) -> bool:
    """Query onOff via devStatus; the device sends replies to UDP 4002."""
    host = validate_host(host)
    with _listen() as sock:
        sock.sendto(_GET_STATUS, (host, _CONTROL_PORT))
        deadline = time.monotonic() + _TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            sock.settimeout(max(0.05, deadline - time.monotonic()))
            try:
                packet, address = sock.recvfrom(4096)
            except socket.timeout:
                break
            if address[0] != host:
                continue
            cmd, data = _parse_msg(packet)
            if cmd != "devStatus" or data.get("onOff") not in (0, 1, False, True):
                continue
            return bool(data["onOff"])
    raise ConnectionError("Aucune réponse devStatus du H70B3 via UDP 4002")


def write_power(host: str, turn_on: bool) -> None:
    """Direct Govee LAN turn command; never touches a GIF frame or Bluetooth."""
    host = validate_host(host)
    payload = json.dumps(
        {"msg": {"cmd": "turn", "data": {"value": 1 if turn_on else 0}}},
        separators=(",", ":"),
    ).encode("utf-8")
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.sendto(payload, (host, _CONTROL_PORT))


def _runtime(hass: HomeAssistant, entry_id: str) -> Any:
    runtimes = hass.data.get(DOMAIN, {}).get(DATA_RUNTIMES, {})
    runtime = runtimes.get(entry_id)
    if runtime is None or runtime.spec.key != MODEL_H70B3:
        raise ValueError("Aucune entrée H70B3 correspondant à LED Player")
    return runtime


def _host_for(entry_id: str, ble_mac: str, configured: str | None) -> str:
    if configured:
        return validate_host(configured)
    cached = _LAN_IP_CACHE.get(entry_id)
    if cached:
        return cached
    host = discover_host(ble_mac)
    _LAN_IP_CACHE[entry_id] = host
    return host


def _get_sync(entry_id: str, ble_mac: str, configured: str | None) -> dict[str, Any]:
    host = _host_for(entry_id, ble_mac, configured)
    try:
        on = read_power(host)
    except (ConnectionError, OSError):
        if configured:
            raise
        # IP may have changed due to DHCP; refresh the scan once.
        _LAN_IP_CACHE.pop(entry_id, None)
        host = _host_for(entry_id, ble_mac, None)
        on = read_power(host)
    return {"host": host, "on": on, "verified": True}


def _set_sync(
    entry_id: str, ble_mac: str, configured: str | None, on: bool
) -> dict[str, Any]:
    host = _host_for(entry_id, ble_mac, configured)
    write_power(host, on)
    time.sleep(0.3)
    try:
        actual = read_power(host)
    except (ConnectionError, OSError):
        # The turn command has no ACK. Report an *unverified* transmission.
        return {"host": host, "on": on, "verified": False}
    return {"host": host, "on": actual, "verified": actual == on}


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/power/get",
        vol.Required("config_entry_id"): str,
        vol.Optional("lan_ip"): str,
    }
)
@websocket_api.async_response
async def websocket_power_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    try:
        ble_mac = _runtime(hass, msg["config_entry_id"]).controller.address
        async with _POWER_LOCK:
            result = await hass.async_add_executor_job(
                _get_sync, msg["config_entry_id"], ble_mac, msg.get("lan_ip")
            )
    except (ValueError, ConnectionError, OSError) as err:
        connection.send_error(msg["id"], "lan_power_unavailable", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/power/set",
        vol.Required("config_entry_id"): str,
        vol.Required("on"): bool,
        vol.Optional("lan_ip"): str,
    }
)
@websocket_api.async_response
async def websocket_power_set(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    try:
        ble_mac = _runtime(hass, msg["config_entry_id"]).controller.address
        async with _POWER_LOCK:
            result = await hass.async_add_executor_job(
                _set_sync, msg["config_entry_id"], ble_mac, msg.get("lan_ip"), msg["on"]
            )
    except (ValueError, ConnectionError, OSError) as err:
        connection.send_error(msg["id"], "lan_power_unavailable", str(err))
        return
    connection.send_result(msg["id"], result)


def async_register_lan_power(hass: HomeAssistant) -> None:
    """Register once, in the integration's existing setup lifecycle."""
    websocket_api.async_register_command(hass, websocket_power_get)
    websocket_api.async_register_command(hass, websocket_power_set)
