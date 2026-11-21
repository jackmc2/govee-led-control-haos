"""Persistent artwork gallery for the bundled LED Studio card."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DATA_GALLERY, DATA_GALLERY_REGISTERED, DOMAIN
from .gallery_data import MAX_ITEMS, validate_gallery_item

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.gallery"


class ArtworkGallery:
    """Small persistent gallery stored in Home Assistant's .storage directory."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._items: list[dict[str, Any]] = []
        self._player_brightness = 100

    async def async_load(self) -> None:
        stored = await self._store.async_load() or {}
        items = stored.get("items", [])
        self._items = items if isinstance(items, list) else []
        value = stored.get("player_brightness", 100)
        self._player_brightness = value if type(value) is int and 1 <= value <= 100 else 100

    def items(self) -> list[dict[str, Any]]:
        return deepcopy(self._items)

    def player_brightness(self) -> int:
        """Shared Player brightness, persistent across browsers and HA restarts."""
        return self._player_brightness

    async def async_set_player_brightness(self, brightness: int) -> int:
        if type(brightness) is not int or not 1 <= brightness <= 100:
            raise ValueError("Brightness must be between 1 and 100")
        self._player_brightness = brightness
        await self._async_store()
        return self._player_brightness

    async def _async_store(self) -> None:
        # Keep the artwork and player setting together in the existing HA Store.
        await self._store.async_save({
            "items": self._items,
            "player_brightness": self._player_brightness,
        })

    async def async_save_item(self, raw: object) -> dict[str, Any]:
        item = validate_gallery_item(raw)
        requested_id = raw.get("id") if isinstance(raw, dict) else None
        existing = next(
            (candidate for candidate in self._items if candidate.get("id") == requested_id),
            None,
        )
        now = datetime.now(UTC).isoformat()
        if existing is not None:
            # Preserve categories when an older LED Studio client saves an item
            # without knowing about the optional category field.
            if "category" not in raw:
                item["category"] = existing.get("category", "")
            item["id"] = existing["id"]
            item["created_at"] = existing.get("created_at", now)
            item["updated_at"] = now
            self._items[self._items.index(existing)] = item
        else:
            if len(self._items) >= MAX_ITEMS:
                raise ValueError(f"The gallery can contain at most {MAX_ITEMS} artworks")
            item["id"] = uuid4().hex
            item["created_at"] = now
            item["updated_at"] = now
            self._items.append(item)
        await self._async_store()
        return deepcopy(item)

    async def async_delete_item(self, item_id: str) -> None:
        remaining = [item for item in self._items if item.get("id") != item_id]
        if len(remaining) == len(self._items):
            raise ValueError("Artwork was not found")
        self._items = remaining
        await self._async_store()


def _gallery(hass: HomeAssistant) -> ArtworkGallery:
    return hass.data[DOMAIN][DATA_GALLERY]


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/gallery/list"}
)
@websocket_api.async_response
async def websocket_gallery_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    connection.send_result(msg["id"], {"items": _gallery(hass).items()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/gallery/save",
        vol.Required("item"): dict,
    }
)
@websocket_api.async_response
async def websocket_gallery_save(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    try:
        item = await _gallery(hass).async_save_item(msg["item"])
    except (TypeError, ValueError) as err:
        connection.send_error(msg["id"], "invalid_artwork", str(err))
        return
    connection.send_result(msg["id"], {"item": item})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/gallery/delete",
        vol.Required("item_id"): str,
    }
)
@websocket_api.async_response
async def websocket_gallery_delete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    try:
        await _gallery(hass).async_delete_item(msg["item_id"])
    except ValueError as err:
        connection.send_error(msg["id"], "artwork_not_found", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/player/brightness/get"}
)
@websocket_api.async_response
async def websocket_player_brightness_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    connection.send_result(msg["id"], {"brightness": _gallery(hass).player_brightness()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/player/brightness/set",
        vol.Required("brightness"): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
    }
)
@websocket_api.async_response
async def websocket_player_brightness_set(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    brightness = await _gallery(hass).async_set_player_brightness(msg["brightness"])
    connection.send_result(msg["id"], {"brightness": brightness})


async def async_setup_gallery(hass: HomeAssistant) -> None:
    """Load storage and register gallery websocket commands once."""
    data = hass.data[DOMAIN]
    if data.get(DATA_GALLERY_REGISTERED):
        return
    gallery = ArtworkGallery(hass)
    await gallery.async_load()
    data[DATA_GALLERY] = gallery
    websocket_api.async_register_command(hass, websocket_gallery_list)
    websocket_api.async_register_command(hass, websocket_gallery_save)
    websocket_api.async_register_command(hass, websocket_gallery_delete)
    websocket_api.async_register_command(hass, websocket_player_brightness_get)
    websocket_api.async_register_command(hass, websocket_player_brightness_set)
    data[DATA_GALLERY_REGISTERED] = True
