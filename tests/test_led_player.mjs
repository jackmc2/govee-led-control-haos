/* Regression tests: LED Player calls the existing HA services, not a GIF stream. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const classes = new Map();
const sandbox = {
  HTMLElement: class {},
  window: { customCards: [] },
  customElements: {
    get: (name) => classes.get(name),
    define: (name, classType) => classes.set(name, classType),
  },
  btoa: (binary) => Buffer.from(binary, "binary").toString("base64"),
};
runInNewContext(
  readFileSync("custom_components/govee_led_control/frontend/govee-led-player.js", "utf8"),
  sandbox
);
const Player = classes.get("govee-led-player");
assert.equal(typeof Player, "function");
assert.equal(sandbox.window.customCards.filter((c) => c.type === "govee-led-player").length, 1);

function fixture(item) {
  const calls = [];
  const instance = new Player();
  instance.config = Player.getStubConfig();
  instance._items = [item];
  instance._selectedId = item.id;
  instance._busy = false;
  instance.shadowRoot = { getElementById: () => ({ disabled: false, textContent: "" }) };
  instance._renderSelection = () => {};
  instance._statusUpdate = (message, error = false) => {
    instance.testResult = { message, error };
  };
  instance._hass = {
    states: {
      "sensor.curtain": { attributes: { model: "H70B3", config_entry_id: "curtain_entry" } },
      "sensor.panels": { attributes: { model: "H6069", config_entry_id: "panels_entry" } },
    },
    callService: async (domain, name, data) => {
      calls.push({ domain, name, data });
    },
  };
  return { instance, calls };
}

const colors = Array(520).fill("#122233");
const frameA = { colors, duration: 150 };
const frameB = { colors: Array(520).fill("#334455"), duration: 200 };

{
  const { instance, calls } = fixture({
    id: "static", name: "Bleu", target: "h70b3",
    kind: "art", brightness: 45, colors,
  });
  await instance._sendSelected();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, "govee_led_control");
  assert.equal(calls[0].name, "set_frame");
  assert.equal(calls[0].data.config_entry_id, "curtain_entry");
  assert.equal(calls[0].data.colors.length, 520);
  assert.equal(calls[0].data.brightness_percent, 45);
  assert.equal(calls[0].data.commit, true);
  assert.equal(instance.testResult.error, false);
}

{
  const { instance, calls } = fixture({
    id: "gif", name: "Meteores", target: "h70b3",
    kind: "animation", brightness: 100, frames: [frameA, frameB],
  });
  await instance._sendSelected();
  assert.equal(calls.length, 1, "a native GIF is uploaded exactly once");
  assert.equal(calls[0].name, "upload_native_gif");
  assert.equal(calls[0].data.config_entry_id, "curtain_entry");
  assert.equal(Object.hasOwn(calls[0].data, "colors"), false);
  const data = Buffer.from(calls[0].data.gif_base64, "base64");
  assert.equal(data.toString("ascii", 0, 6), "GIF89a");
  assert.equal(data.readUInt16LE(6), 20);
  assert.equal(data.readUInt16LE(8), 26);
  assert.equal(data[data.length - 1], 0x3b);
  assert.equal(instance.testResult.error, false);
}

{
  const { instance, calls } = fixture({
    id: "panel", name: "Panneaux", target: "h6069",
    kind: "art", brightness: 80, colors: Array(40).fill("#123456"),
  });
  await instance._sendSelected();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "set_frame");
  assert.equal(calls[0].data.config_entry_id, "panels_entry");
  assert.equal(calls[0].data.colors.length, 40);
}
// The visible action label remains identical regardless of the selected content type.
for (const item of [
  { id: "still", name: "Image", kind: "art", target: "h70b3", colors },
  { id: "animation", name: "Gif", kind: "animation", target: "h70b3", frames: [frameA, frameB] },
]) {
  const { instance } = fixture(item);
  const elements = new Map();
  instance.shadowRoot = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, { textContent: "", disabled: false });
      return elements.get(id);
    },
  };
  instance._clearPreviewTimer = () => {};
  instance._drawPreview = () => {};
  instance._renderSelection = Player.prototype._renderSelection;
  instance._renderSelection();
  assert.equal(elements.get("play").textContent, "Envoyer sur le rideau");
}

// Layout is explicitly a two-column gallery (not just a two-column card layout).
const source = readFileSync("custom_components/govee_led_control/frontend/govee-led-player.js", "utf8");
assert.match(source, /\.items \{[^"]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.equal(source.includes("Lancer le GIF sur le rideau"), false);

// Layout: Refresh must be on the filter row; preview and Send precede the gallery.
const markupStart = source.indexOf('this.shadowRoot.innerHTML =');
const markupEnd = source.indexOf('this.shadowRoot.getElementById("refresh").addEventListener', markupStart);
const markup = source.slice(markupStart, markupEnd);
assert.ok(markup.includes('<div class="filter-bar"><div class="filters">'));
assert.ok(markup.indexOf('data-filter="animation"') < markup.indexOf('id="refresh"'));
assert.ok(markup.indexOf('id="refresh"') < markup.indexOf('class="detail"'));
assert.ok(markup.indexOf('id="preview"') < markup.indexOf('id="items"'));
assert.ok(markup.indexOf('id="play"') < markup.indexOf('id="items"'));
assert.ok(markup.indexOf('id="power"') < markup.indexOf('id="refresh"'));
assert.ok(source.includes('".layout { display:flex; flex-direction:column;'));


// The power button sends LAN WebSocket commands to THIS H70B3, never
// calls light.* or switch.* (and never destroys the native GIF via set_frame).
{
  const { instance, calls } = fixture({ id:"still", kind:"art", target:"h70b3", colors });
  const power = {
    disabled: false, textContent: "", title: "",
    classList: { toggle() {} },
  };
  instance.shadowRoot = { getElementById: () => power };
  instance._powerOn = null;
  instance._powerBusy = false;
  instance._powerLoading = false;
  const requests = [];
  instance._hass.callWS = async (req) => {
    requests.push(req);
    return { host: "192.168.1.50", on: req.on ?? true, verified: true };
  };
  instance._renderPowerButton();
  assert.equal(power.disabled, true, "unknown state is never toggled blindly");
  await instance._refreshPower();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].type, "govee_led_control/power/get");
  assert.equal(requests[0].config_entry_id, "curtain_entry");
  assert.equal(power.textContent, "⏻ Éteindre");
  assert.equal(power.disabled, false);
  await instance._togglePower();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].type, "govee_led_control/power/set");
  assert.equal(requests[1].config_entry_id, "curtain_entry");
  assert.equal(requests[1].on, false);
  assert.equal(power.textContent, "⏻ Allumer");
  assert.equal(instance.testResult.error, false);
  assert.equal(calls.length, 0, "never call an external light or switch service");
  instance.config.lan_ip = "192.168.1.50";
  await instance._togglePower();
  assert.equal(requests[2].lan_ip, "192.168.1.50");
  assert.equal(requests[2].on, true);
  assert.equal(power.textContent, "⏻ Éteindre");
}
{
  const { instance, calls } = fixture({ id:"still", kind:"art", target:"h70b3", colors });
  instance._powerOn = true;
  const requests = [];
  instance._hass.callWS = async (req) => {
    requests.push(req);
    return {host:"192.168.1.50",on:false,verified:false};
  };
  instance.shadowRoot = {
    getElementById: () => ({ disabled:false, textContent:"", title:"", classList:{ toggle(){} } }),
  };
  await instance._togglePower();
  assert.equal(requests.length,1);
  assert.equal(instance.testResult.error,true,"unverified UDP send must not claim success");
  assert.equal(calls.length,0);
}
assert.equal(source.includes("power_entity"), false,
  "LED Player must not depend on another Govee integration");
assert.equal(source.includes('callService(entityId.split'), false);

console.log("LED Player: static H70B3 image, native GIF, H6069 image OK");
