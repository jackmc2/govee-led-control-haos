"""Config and options flows for the multi-model Govee integration."""

from __future__ import annotations

import ipaddress
import re
from typing import Any

import voluptuous as vol
from homeassistant.components import bluetooth
from homeassistant.components.bluetooth import BluetoothServiceInfoBleak
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_ADDRESS, CONF_HOST, CONF_NAME
from homeassistant.core import callback

from .const import (
    CONF_CREATE_PIXEL_ENTITIES,
    CONF_DEBOUNCE_MS,
    CONF_IDLE_DISCONNECT_SECONDS,
    CONF_MODEL,
    CONF_PANEL_COUNT,
    CONF_TOPOLOGY_PT,
    CONF_TRANSPORT,
    DEFAULT_CREATE_PIXEL_ENTITIES,
    DEFAULT_H6069_DEBOUNCE_MS,
    DEFAULT_H6069_HOST,
    DEFAULT_H6069_NAME,
    DEFAULT_H6069_PANEL_COUNT,
    DEFAULT_H70B3_DEBOUNCE_MS,
    DEFAULT_H70B3_NAME,
    DEFAULT_IDLE_DISCONNECT_SECONDS,
    DOMAIN,
    MAX_PANEL_COUNT,
    MIN_PANEL_COUNT,
    MODEL_H6069,
    MODEL_H70B3,
    TRANSPORT_BLUETOOTH,
    TRANSPORT_LAN,
)
from .h6069_topology import H6069TopologyError, decode_topology_pt
from .h70b3_discovery import discovered_h70b3, discovery_diagnostic

_MAC_PATTERN = re.compile(r"^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")


class GoveeAdvancedConfigFlow(ConfigFlow, domain=DOMAIN):
    """Discover nearby H70B3 devices, with manual and H6069 fallback."""

    VERSION = 1

    def __init__(self) -> None:
        self._address: str | None = None
        self._name = DEFAULT_H70B3_NAME

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return GoveeAdvancedOptionsFlow(config_entry)

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show discovered connectable H70B3 devices instead of asking for a MAC."""
        configured_addresses = {
            str(entry.data.get(CONF_ADDRESS, "")).upper()
            for entry in self._async_current_entries()
            if entry.data.get(CONF_MODEL) == MODEL_H70B3
        }
        # Compare all advertisements with devices reachable through a
        # connectable adapter/proxy. This separates missing reception from
        # filtering by model or a read-only Bluetooth scanner.
        all_ads = tuple(
            bluetooth.async_discovered_service_info(self.hass, connectable=False)
        )
        connectable_ads = tuple(
            bluetooth.async_discovered_service_info(self.hass, connectable=True)
        )
        # HAOS may record an advertisement from the ESPHome proxy in the
        # general Bluetooth cache before it is included in the connectable
        # cache. Use the same full view as HAOS's "Advertisements" page.
        # Connection availability is a separate status, not a discovery gate.
        devices = discovered_h70b3(
            all_ads, configured_addresses, require_connectable=False
        )
        diagnosis = discovery_diagnostic(
            all_ads,
            connectable_ads,
            bluetooth.async_scanner_count(self.hass, connectable=True),
        )
        # A selector is used even when no H70B3 is discovered. Unlike a
        # menu, vol.In labels render without depending on cached translations.
        # Keep the manual entry route and the H6069 route available.
        choices = {}
        for address, name in devices.items():
            connection_ready = bluetooth.async_ble_device_from_address(
                self.hass, address, connectable=True
            ) is not None
            status = "" if connection_ready else " — connexion BLE à vérifier"
            choices[address] = f"{name} ({address}){status}"
        if not devices and configured_addresses:
            # Configured H70B3s are intentionally hidden from the add-device
            # selector: they must not be reported as Bluetooth discovery failures.
            refresh_label = (
                f"Actualiser — {len(configured_addresses)} H70B3 déjà configuré(s), "
                "aucun nouveau rideau à ajouter"
            )
        elif not devices:
            refresh_label = "Actualiser — " + diagnosis
        else:
            refresh_label = "Actualiser les appareils Bluetooth"
        choices["refresh"] = refresh_label
        choices[MODEL_H70B3] = "H70B3 : saisir une adresse MAC manuellement"

        if user_input is not None:
            selection = user_input["device"]
            if selection == "refresh":
                return await self.async_step_refresh()
            if selection == MODEL_H70B3:
                return await self.async_step_h70b3()
            if selection in devices:
                address = selection.upper()
                name = devices[selection]
                await self.async_set_unique_id(f"{MODEL_H70B3}_{address}")
                self._abort_if_unique_id_configured()
                return self._create_h70b3_entry(address, name)

        return self.async_show_form(
            step_id="user" if devices else "not_found",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "device",
                        default=next(iter(devices), "refresh"),
                    ): vol.In(choices)
                }
            ),
        )

    async def async_step_refresh(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Re-read HAOS Bluetooth advertisements, including ESPHome proxies."""
        return await self.async_step_user()

    async def async_step_not_found(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle fallback choices and retry HAOS Bluetooth discovery."""
        return await self.async_step_user(user_input)

    async def async_step_h6069(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Configure the physically verified H6069 LAN adapter."""
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            try:
                ipaddress.ip_address(host)
            except ValueError:
                errors[CONF_HOST] = "invalid_ip"
            else:
                await self.async_set_unique_id(f"{MODEL_H6069}_{host}")
                self._abort_if_unique_id_configured()
                name = user_input[CONF_NAME].strip() or DEFAULT_H6069_NAME
                panel_count = int(user_input[CONF_PANEL_COUNT])
                return self.async_create_entry(
                    title=name,
                    data={
                        CONF_MODEL: MODEL_H6069,
                        CONF_TRANSPORT: TRANSPORT_LAN,
                        CONF_HOST: host,
                        CONF_NAME: name,
                        CONF_PANEL_COUNT: panel_count,
                    },
                    options={
                        CONF_PANEL_COUNT: panel_count,
                        CONF_DEBOUNCE_MS: DEFAULT_H6069_DEBOUNCE_MS,
                    },
                )

        return self.async_show_form(
            step_id="h6069",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_HOST, default=DEFAULT_H6069_HOST): str,
                    vol.Required(CONF_NAME, default=DEFAULT_H6069_NAME): str,
                    vol.Required(
                        CONF_PANEL_COUNT, default=DEFAULT_H6069_PANEL_COUNT
                    ): vol.All(
                        vol.Coerce(int),
                        vol.Range(min=MIN_PANEL_COUNT, max=MAX_PANEL_COUNT),
                    ),
                }
            ),
            errors=errors,
        )

    async def async_step_h70b3(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Configure the H70B3 through a local or proxied BLE adapter."""
        errors: dict[str, str] = {}
        if user_input is not None:
            address = user_input[CONF_ADDRESS].strip().upper()
            if not _MAC_PATTERN.fullmatch(address):
                errors[CONF_ADDRESS] = "invalid_address"
            else:
                await self.async_set_unique_id(f"{MODEL_H70B3}_{address}")
                self._abort_if_unique_id_configured()
                name = user_input[CONF_NAME].strip() or DEFAULT_H70B3_NAME
                return self._create_h70b3_entry(address, name)

        return self.async_show_form(
            step_id="h70b3",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ADDRESS): str,
                    vol.Required(CONF_NAME, default=DEFAULT_H70B3_NAME): str,
                }
            ),
            errors=errors,
        )

    def _create_h70b3_entry(self, address: str, name: str) -> ConfigFlowResult:
        return self.async_create_entry(
            title=name,
            data={
                CONF_MODEL: MODEL_H70B3,
                CONF_TRANSPORT: TRANSPORT_BLUETOOTH,
                CONF_ADDRESS: address,
                CONF_NAME: name,
            },
            options={
                CONF_CREATE_PIXEL_ENTITIES: DEFAULT_CREATE_PIXEL_ENTITIES,
                CONF_DEBOUNCE_MS: DEFAULT_H70B3_DEBOUNCE_MS,
                CONF_IDLE_DISCONNECT_SECONDS: DEFAULT_IDLE_DISCONNECT_SECONDS,
            },
        )

    async def async_step_bluetooth(
        self, discovery_info: BluetoothServiceInfoBleak
    ) -> ConfigFlowResult:
        """Offer a discovered H70B3 without contacting or changing it."""
        self._address = discovery_info.address.upper()
        self._name = discovery_info.name or DEFAULT_H70B3_NAME
        await self.async_set_unique_id(f"{MODEL_H70B3}_{self._address}")
        self._abort_if_unique_id_configured()
        self.context["title_placeholders"] = {"name": self._name}
        return await self.async_step_confirm()

    async def async_step_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm discovered Bluetooth; setup itself never transmits a frame."""
        if user_input is not None:
            assert self._address is not None
            return self._create_h70b3_entry(self._address, self._name)
        return self.async_show_form(
            step_id="confirm",
            description_placeholders={
                "name": self._name,
                "address": self._address or "",
            },
        )


class GoveeAdvancedOptionsFlow(OptionsFlow):
    """Expose only options that are meaningful for the configured model."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        options = self._entry.options
        model = self._entry.data[CONF_MODEL]
        errors: dict[str, str] = {}
        if user_input is not None and model == MODEL_H6069:
            topology_pt = str(user_input.get(CONF_TOPOLOGY_PT, "")).strip()
            user_input[CONF_TOPOLOGY_PT] = topology_pt
            if topology_pt:
                try:
                    topology = decode_topology_pt(
                        topology_pt,
                        source="validated manual Shape Recognition import",
                    )
                except H6069TopologyError:
                    errors[CONF_TOPOLOGY_PT] = "invalid_topology"
                else:
                    if topology.panel_count != int(user_input[CONF_PANEL_COUNT]):
                        errors[CONF_TOPOLOGY_PT] = "topology_count_mismatch"
        if user_input is not None and not errors:
            return self.async_create_entry(title="", data=user_input)

        if model == MODEL_H6069:
            schema = vol.Schema(
                {
                    vol.Required(
                        CONF_PANEL_COUNT,
                        default=options.get(
                            CONF_PANEL_COUNT,
                            self._entry.data.get(
                                CONF_PANEL_COUNT, DEFAULT_H6069_PANEL_COUNT
                            ),
                        ),
                    ): vol.All(
                        vol.Coerce(int),
                        vol.Range(min=MIN_PANEL_COUNT, max=MAX_PANEL_COUNT),
                    ),
                    vol.Required(
                        CONF_DEBOUNCE_MS,
                        default=options.get(
                            CONF_DEBOUNCE_MS, DEFAULT_H6069_DEBOUNCE_MS
                        ),
                    ): vol.All(vol.Coerce(int), vol.Range(min=50, max=2000)),
                    vol.Optional(
                        CONF_TOPOLOGY_PT,
                        default=options.get(CONF_TOPOLOGY_PT, ""),
                    ): str,
                }
            )
        else:
            schema = vol.Schema(
                {
                    vol.Required(
                        CONF_CREATE_PIXEL_ENTITIES,
                        default=options.get(
                            CONF_CREATE_PIXEL_ENTITIES,
                            DEFAULT_CREATE_PIXEL_ENTITIES,
                        ),
                    ): bool,
                    vol.Required(
                        CONF_DEBOUNCE_MS,
                        default=options.get(
                            CONF_DEBOUNCE_MS, DEFAULT_H70B3_DEBOUNCE_MS
                        ),
                    ): vol.All(vol.Coerce(int), vol.Range(min=50, max=2000)),
                    vol.Required(
                        CONF_IDLE_DISCONNECT_SECONDS,
                        default=options.get(
                            CONF_IDLE_DISCONNECT_SECONDS,
                            DEFAULT_IDLE_DISCONNECT_SECONDS,
                        ),
                    ): vol.All(vol.Coerce(int), vol.Range(min=3, max=120)),
                }
            )
        return self.async_show_form(
            step_id="init", data_schema=schema, errors=errors
        )
