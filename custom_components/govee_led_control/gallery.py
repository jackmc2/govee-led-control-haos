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
from .gallery_data import MAX_CATEGORIES, MAX_ITEMS, validate_gallery_category, validate_gallery_item

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.gallery"


class ArtworkGallery:
    """Persistent artworks, player settings and named category registry."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._items: list[dict[str, Any]] = []
        self._categories: list[str] = []
        self._player_brightness = 100

    def _category_index(self, name: str) -> int:
        key = name.casefold()
        return next((i for i, value in enumerate(self._categories)
                     if value.casefold() == key), -1)

    def _ensure_category(self, name: str) -> str:
        if not name:
            return ""
        index = self._category_index(name)
        if index >= 0:
            return self._categories[index]
        if len(self._categories) >= MAX_CATEGORIES:
            raise ValueError(f"At most {MAX_CATEGORIES} categories are allowed")
        self._categories.append(name)
        return name

    async def async_load(self) -> None:
        stored = await self._store.async_load() or {}
        items = stored.get("items", [])
        self._items = items if isinstance(items, list) else []
        self._categories = []
        # Older installations have no registry: derive it from saved artwork.
        # Preserve also deliberately empty categories from newer installations.
        names = stored.get("categories", [])
        for raw in [*(names if isinstance(names, list) else []),
                    *(item.get("category", "") for item in self._items
                      if isinstance(item, dict))]:
            try:
                name = validate_gallery_category(raw)
                if name:
                    self._ensure_category(name)
            except ValueError:
                continue
        value = stored.get("player_brightness", 100)
        self._player_brightness = value if type(value) is int and 1 <= value <= 100 else 100

    def items(self) -> list[dict[str, Any]]:
        return deepcopy(self._items)

    def categories(self) -> list[str]:
        return sorted(self._categories, key=str.casefold)

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
        await self._store.async_save({
            "items": self._items,
            "categories": self._categories,
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
            # Older clients do not know the category field: preserve it.
            if "category" not in raw:
                item["category"] = existing.get("category", "")
            item["category"] = self._ensure_category(item["category"])
            item["id"] = existing["id"]
            item["created_at"] = existing.get("created_at", now)
            item["updated_at"] = now
            self._items[self._items.index(existing)] = item
        else:
            if len(self._items) >= MAX_ITEMS:
                raise ValueError(f"The gallery can contain at most {MAX_ITEMS} artworks")
            item["category"] = self._ensure_category(item["category"])
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
        # Categories remain available after their final artwork is deleted.
        await self._async_store()

    async def async_manage_category(
        self, action: str, name: str, new_name: str | None = None
    ) -> list[str]:
        name = validate_gallery_category(name, allow_empty=False)
        index = self._category_index(name)
        if action == "create":
            if name.casefold() in ("non classé", "sans catégorie"):
                raise ValueError("This name is reserved for uncategorized artwork")
            if index >= 0:
                raise ValueError("This category already exists")
            self._ensure_category(name)
        elif action in ("rename", "delete"):
            if index < 0:
                raise ValueError("Category not found")
            original = self._categories[index]
            replacement = ""
            if action == "rename":
                replacement = validate_gallery_category(new_name, allow_empty=False)
                if replacement.casefold() in ("non classé", "sans catégorie"):
                    raise ValueError("This name is reserved for uncategorized artwork")
                collision = self._category_index(replacement)
                if collision >= 0 and collision != index:
                    raise ValueError("This category already exists")
                self._categories[index] = replacement
            else:
                del self._categories[index]
            now = datetime.now(UTC).isoformat()
            for item in self._items:
                if isinstance(item.get("category"), str) and (
                    item["category"].casefold() == original.casefold()
                ):
                    item["category"] = replacement
                    item["updated_at"] = now
        else:
            raise ValueError("Unknown category action")
        await self._async_store()
        return self.categories()


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
    connection.send_result(msg["id"], {"items": _gallery(hass).items(), "categories": _gallery(hass).categories()})


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
    {
        vol.Required("type"): f"{DOMAIN}/gallery/category/manage",
        vol.Required("action"): vol.In(("create", "rename", "delete")),
        vol.Required("name"): str,
        vol.Optional("new_name"): str,
    }
)
@websocket_api.async_response
async def websocket_gallery_category_manage(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    try:
        categories = await _gallery(hass).async_manage_category(
            msg["action"], msg["name"], msg.get("new_name")
        )
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_category", str(err))
        return
    connection.send_result(msg["id"], {"categories": categories})


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
    websocket_api.async_register_command(hass, websocket_gallery_category_manage)
    websocket_api.async_register_command(hass, websocket_player_brightness_get)
    websocket_api.async_register_command(hass, websocket_player_brightness_set)
    data[DATA_GALLERY_REGISTERED] = True
