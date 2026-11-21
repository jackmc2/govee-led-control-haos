"""Pure helpers for selecting discoverable Govee H70B3 BLE advertisements.

No Bluetooth connection or active scan is started here; Home Assistant's
Bluetooth manager (including ESPHome connectable proxies) supplies the data.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Iterable

_MAC_PATTERN = re.compile(r"^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$")


def discovered_h70b3(
    service_infos: Iterable[object],
    configured_addresses: Collection[str] = (),
    *,
    require_connectable: bool = True,
) -> dict[str, str]:
    """Return unconfigured, connectable H70B3 devices indexed by their BLE MAC.

    Discovery is based on the advertised name, not a Wi-Fi IP address.
    Deliberately avoid substituting a fabricated address if none is seen.
    """
    configured = {address.upper() for address in configured_addresses}
    devices: dict[str, str] = {}
    for info in service_infos:
        if require_connectable and getattr(info, "connectable", True) is False:
            continue
        address = str(getattr(info, "address", "")).upper()
        if not _MAC_PATTERN.fullmatch(address) or address in configured:
            continue
        name = str(
            getattr(info, "name", None)
            or getattr(getattr(info, "device", None), "name", None)
            or ""
        ).strip()
        normalized = name.upper()
        if not (
            normalized.startswith("GOVEE_H70B3")
            or normalized.startswith("GVH70B3")
        ):
            continue
        devices.setdefault(address, name)
    return dict(sorted(devices.items(), key=lambda item: item[1].casefold()))


def discovery_diagnostic(
    all_advertisements: Iterable[object],
    connectable_advertisements: Iterable[object],
    scanner_count: int,
) -> str:
    """Summarize what HAOS can currently see, without attempting a BLE connection.

    Used in the selection option itself so it stays readable when frontend
    translation resources are missing or cached.
    """
    all_items = tuple(all_advertisements)
    connectable_items = tuple(connectable_advertisements)
    seen = len({str(getattr(x, "address", "")).upper() for x in all_items})
    connectable = len(
        {str(getattr(x, "address", "")).upper() for x in connectable_items}
    )
    total_h70b3 = discovered_h70b3(all_items, require_connectable=False)
    connectable_h70b3 = discovered_h70b3(connectable_items)

    if scanner_count <= 0:
        return "aucun scanner Bluetooth connectable ; vérifier le proxy ESPHome"
    if total_h70b3 and not connectable_h70b3:
        return "H70B3 visible, mais sans connexion BLE possible ; activer le proxy"
    if seen == 0:
        return f"{scanner_count} scanner(s), aucune annonce reçue ; vérifier le mode Active"
    if connectable == 0:
        return f"{seen} appareil(s) vus, aucun connectable ; vérifier le proxy"
    return (
        f"{scanner_count} scanner(s), {seen} appareil(s) vus, "
        f"{connectable} connectable(s), H70B3 non détectée"
    )
