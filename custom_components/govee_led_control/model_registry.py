"""Declarative model and transport capability registry."""

from __future__ import annotations

from dataclasses import dataclass

from .const import MODEL_H6069, MODEL_H70B3, TRANSPORT_BLUETOOTH, TRANSPORT_LAN


@dataclass(frozen=True, slots=True)
class ModelSpec:
    """Capabilities known for one tested Govee model."""

    key: str
    sku: str
    name: str
    full_control_transport: str
    element_label: str
    element_count: int
    transport_support: dict[str, str]
    smart_functions: dict[str, str]
    evidence: str


MODEL_SPECS: dict[str, ModelSpec] = {
    MODEL_H6069: ModelSpec(
        key=MODEL_H6069,
        sku="H6069",
        name="Mini Panel Lights",
        full_control_transport=TRANSPORT_LAN,
        element_label="panel",
        element_count=40,
        transport_support={
            "lan": "Full individual panel control, physically verified",
            "bluetooth": "Bluetooth hardware present; individual panel control not implemented",
            "matter": "Basic device control only; no individual panel control",
        },
        smart_functions={
            "music_sync": "Officially supported; protocol not implemented",
            "shape_recognition": "Validated topology import; read-only LAN probe depends on firmware",
            "inner_panel_leds": "Possible internal LEDs detected; external addressing unverified",
            "sensor_level_demo": "Available through a Home Assistant sensor",
            "motion_sensor": "No built-in motion sensor verified",
        },
        evidence="LAN ptReal/A3 and 129-byte topology verified on real 40-panel hardware",
    ),
    MODEL_H70B3: ModelSpec(
        key=MODEL_H70B3,
        sku="H70B3",
        name="Curtain Lights 2",
        full_control_transport=TRANSPORT_BLUETOOTH,
        element_label="led",
        element_count=520,
        transport_support={
            "lan": "Basic device control only; 520-pixel LAN upload failed physical tests",
            "bluetooth": "Full 20x26 pixel control, physically verified",
            "matter": "Basic device control only; no individual LED addressing",
        },
        smart_functions={
            "music_sync": "Eight official music modes; audio input and protocol not identified",
            "image_gif": "GIF supported by manufacturer; static image upload over BLE verified",
            "sensor_level_demo": "Available through a Home Assistant sensor",
            "motion_sensor": "No built-in motion sensor verified",
        },
        evidence="Encrypted BLE A4/58 upload verified on physical 520-LED H70B3",
    ),
}


def get_model_spec(model: str) -> ModelSpec:
    """Return the immutable specification for a configured model."""
    try:
        return MODEL_SPECS[model]
    except KeyError as err:
        raise ValueError(f"Unsupported Govee model {model!r}") from err
