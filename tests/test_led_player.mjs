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
  document: { hidden: false },
};
const timers = new Map();
let nextTimerId = 0;
sandbox.setTimeout = (callback, delay) => {
  const id = ++nextTimerId;
  timers.set(id, { callback, delay });
  return id;
};
sandbox.clearTimeout = (id) => timers.delete(id);
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
  instance._brightness = 100;
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
  instance._brightness = 72;
  await instance._sendSelected();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, "govee_led_control");
  assert.equal(calls[0].name, "set_frame");
  assert.equal(calls[0].data.config_entry_id, "curtain_entry");
  assert.equal(calls[0].data.colors.length, 520);
  assert.equal(calls[0].data.brightness_percent, 72,
    "the persistent Player slider overrides the brightness stored in Studio");
  assert.equal(calls[0].data.commit, true);
  assert.equal(instance.testResult.error, false);
}

{
  const { instance, calls } = fixture({
    id: "gif", name: "Meteores", target: "h70b3",
    kind: "animation", brightness: 100, frames: [frameA, frameB],
  });
  instance._brightness = 50;
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
  // GIF89a global RGB332 palette starts at byte 13. Pure red at index 0xe0
  // must become half-bright, without any additional BLE command.
  assert.equal(data[13 + 0xe0 * 3], 128);
  assert.equal(data[13 + 0xe0 * 3 + 1], 0);
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
  assert.equal(calls[0].data.brightness_percent, 100);
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

// Brightness is shared through HA's .storage WebSocket commands; it must not
// rely on browser-only localStorage or on editing/saving the artwork itself.
{
  const { instance } = fixture({id:"still", name:"Vert", kind:"art", target:"h70b3", colors});
  let storedBrightness = 38;
  const requests = [];
  instance._brightness = 100;
  instance._brightnessLoaded = false;
  instance._brightnessLoading = false;
  instance._brightnessTouched = false;
  instance._renderBrightness = () => {};
  instance._drawPreview = () => {};
  instance._brightnessHint = () => {};
  instance._hass.callWS = async (req) => {
    requests.push(req);
    if (req.type.endsWith("/get")) return {brightness: storedBrightness};
    storedBrightness = req.brightness;
    return {brightness: storedBrightness};
  };
  await instance._loadBrightness();
  assert.equal(instance._brightness, 38);
  assert.equal(instance._brightnessLoaded, true);
  instance._brightness = 61;
  await instance._saveBrightness();
  assert.equal(storedBrightness, 61);
  assert.equal(requests.at(-1).type, "govee_led_control/player/brightness/set");
  // Simulate a second browser opening the card: the last persisted value wins.
  const { instance: anotherPlayer } = fixture({id:"still",kind:"art",target:"h70b3",colors});
  anotherPlayer._brightnessLoaded = false;
  anotherPlayer._brightnessLoading = false;
  anotherPlayer._brightnessTouched = false;
  anotherPlayer._renderBrightness = () => {};
  anotherPlayer._drawPreview = () => {};
  anotherPlayer._brightnessHint = () => {};
  anotherPlayer._hass.callWS = instance._hass.callWS;
  await anotherPlayer._loadBrightness();
  assert.equal(anotherPlayer._brightness, 61);
  assert.equal(source.includes("localStorage"), false,
    "HA storage, rather than the current browser, owns the Player brightness");
}

// The player gallery must be sorted by artwork name (A-Z), regardless of
// save time; the natural sort handles French accents, case and numeric suffixes.
{
  const { instance } = fixture({ id: "test", name: "Test", target: "h70b3", kind: "art", colors });
  instance._items = [];
  instance._selectedId = null;
  const refresh = { disabled: false };
  instance.shadowRoot = { getElementById: () => refresh };
  instance._renderItems = () => {};
  instance._statusUpdate = () => {};
  const gallery = [
    { id: "z", name: "Zèbre", updated_at: "2026-11-21T12:00:00Z" },
    { id: "n10", name: "Noël 10", updated_at: "2026-11-21T13:00:00Z" },
    { id: "e", name: "Étoile", updated_at: "2026-11-21T14:00:00Z" },
    { id: "n2", name: "noël 2", updated_at: "2026-11-21T11:00:00Z" },
    { id: "a", name: "Ange", updated_at: "2026-11-21T15:00:00Z" },
  ];
  instance._hass.callWS = async () => ({ items: gallery });
  await instance._loadGallery();
  assert.deepEqual(Array.from(instance._items, (item) => item.id), ["a", "e", "n2", "n10", "z"]);
  assert.equal(instance._selectedId, "a", "first gallery item is the first alphabetically");
  instance._selectedId = "n10";
  await instance._loadGallery();
  assert.equal(instance._selectedId, "n10", "refresh preserves the selected artwork");
  assert.equal(refresh.disabled, false, "refresh button re-enabled after loading");
}

// Category selector complements, rather than replaces, the image/GIF filters.
{
  const { instance } = fixture({ id:"a", name:"Ange", kind:"art", target:"h70b3", colors });
  instance._items = [
    { id:"a", name:"Ange", category:"Noël", kind:"art", target:"h70b3", colors },
    { id:"b", name:"Boule", category:"noël", kind:"animation", target:"h70b3", frames:[frameA] },
    { id:"c", name:"Chat", kind:"art", target:"h70b3", colors },
    { id:"d", name:"Dino", category:"Halloween", kind:"animation", target:"h70b3", frames:[frameB] },
  ];
  instance._categoryFilter = "all";
  instance._filter = "all";
  const select = { innerHTML:"", value:"all" };
  const list = { innerHTML:"", querySelectorAll: () => [] };
  instance.shadowRoot = {
    getElementById: (id) => id === "category-filter" ? select : list,
    querySelectorAll: () => [],
  };
  instance._renderSelection = () => {};
  instance._renderCategoryFilter();
  assert.match(select.innerHTML, /Toutes les catégories/);
  assert.match(select.innerHTML, /Non classé/);
  assert.match(select.innerHTML, /Halloween/);
  assert.equal((select.innerHTML.match(/>Noël</g) || []).length, 1,
    "same category in different case appears once");
  instance._categoryFilter = "category:noël";
  instance._filter = "animation";
  instance._renderItems();
  assert.match(list.innerHTML, /Boule/);
  assert.doesNotMatch(list.innerHTML, /Ange|Chat|Dino/);
  assert.equal(instance._selectedId, "b");
  instance._categoryFilter = "uncategorized";
  instance._filter = "all";
  instance._renderItems();
  assert.match(list.innerHTML, /Chat/);
  assert.doesNotMatch(list.innerHTML, /Ange|Boule|Dino/);
}


// The gallery shows animated GIF thumbnails with an overlay badge and
// category chip, never a redundant "GIF · N images · H70B3" metadata row.
{
  const { instance } = fixture({ id:"a", name:"Bonhomme de neige", kind:"animation",
    target:"h70b3", category:"Noël", frames:[frameA,frameB] });
  instance._items.push({ id:"b", name:"Cadeau", kind:"art",
    target:"h70b3", category:"Fêtes", colors });
  instance._filter = "all";
  instance._categoryFilter = "all";
  const thumbnails = [];
  const list = {
    innerHTML: "",
    querySelectorAll(selector) {
      if (selector === "[data-thumb]") return thumbnails;
      return [];
    },
  };
  const root = {
    getElementById: () => list,
    querySelectorAll: () => [],
  };
  instance.shadowRoot = root;
  instance._paintCanvas = () => {};
  instance._renderItems();
  assert.equal((list.innerHTML.match(/class="thumb-gif-badge"/g) || []).length, 1);
  assert.match(list.innerHTML, /<span class="thumb-gif-badge">GIF<\/span>/);
  assert.match(list.innerHTML, /<strong>Bonhomme de neige<\/strong><span class="category-tag" title="Noël">Noël<\/span>/);
  assert.match(list.innerHTML, /<strong>Cadeau<\/strong><span class="category-tag" title="Fêtes">Fêtes<\/span>/);
  assert.doesNotMatch(list.innerHTML, /GIF · [0-9]+ images · H70B3/);
  assert.doesNotMatch(list.innerHTML, /class="item-meta"[^]*?<small>/);
  assert.match(source, /\.thumb-gif-badge \{[^"]*position:absolute/);
  assert.match(source, /\.category-tag \{[^"]*border:1px solid/);
}

// Playing gallery thumbnails is a local-only timer, independent from the
// selected (full-size) preview and the native BLE upload.
{
  const { instance, calls } = fixture({ id:"gif", name:"Sapin", kind:"animation",
    target:"h70b3", category:"Noël", frames:[frameA,frameB] });
  const gifCanvas = { dataset:{ thumb:"gif" } };
  const staticCanvas = { dataset:{ thumb:"still" } };
  const list = {
    querySelectorAll: () => [gifCanvas, staticCanvas],
  };
  const still = { id:"still", name:"Cadeau", kind:"art", target:"h70b3", colors };
  const painted = [];
  instance._paintCanvas = (canvas, pixels, target) => painted.push({canvas,pixels,target});
  instance.isConnected = true;
  instance._startThumbnailPreviews(list, [instance._items[0],still]);
  assert.equal(instance._thumbnailState.size, 1);
  assert.equal(timers.size, 1);
  instance._thumbnailState.get("gif").due = 0;
  instance._tickThumbnailPreviews();
  assert.equal(painted.length, 1);
  assert.equal(painted[0].canvas, gifCanvas);
  assert.equal(painted[0].pixels, frameB.colors);
  assert.equal(instance._thumbnailState.get("gif").index, 1);
  assert.equal(calls.length, 0, "thumbnail animation must not contact the rideau");
  sandbox.document.hidden = true;
  instance._clearThumbnailTimer();
  assert.equal(timers.size, 0);
  sandbox.document.hidden = false;
  instance._resumeThumbnailPreviews();
  assert.equal(timers.size, 1);
  instance.disconnectedCallback = Player.prototype.disconnectedCallback;
  // The original disconnected handler would remove the visibility listener.
  sandbox.document.removeEventListener = () => {};
  instance.disconnectedCallback();
  assert.equal(timers.size, 0, "unmount stops the thumbnail loop");
}
