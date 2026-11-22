/* LED Studio regression checks: unified artwork editor and transport routing. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const registry = new Map();
const sandbox = {
  HTMLElement: class {},
  console: { info() {} },
  window: { customCards: [], location: { href: "http://ha.local/" }, confirm: () => true },
  customElements: {
    get: (name) => registry.get(name),
    define: (name, ctor) => registry.set(name, ctor),
  },
  btoa: (binary) => Buffer.from(binary, "binary").toString("base64"),
  document: { hidden: false },
};
const scheduled = new Map();
let timerId = 0;
sandbox.setTimeout = (callback, delay) => {
  const id = ++timerId;
  scheduled.set(id, {callback, delay});
  return id;
};
sandbox.clearTimeout = (id) => scheduled.delete(id);
runInNewContext(readFileSync("custom_components/govee_led_control/frontend/govee-led-studio.js", "utf8"), sandbox);
const Studio = registry.get("govee-led-studio");
assert.equal(typeof Studio, "function");
// LED Studio is exclusively an H70B3 editor; legacy H6069 artworks are
// preserved in storage and supported elsewhere, not shown in this card.
const studioSource = readFileSync("custom_components/govee_led_control/frontend/govee-led-studio.js", "utf8");
assert.equal(/H6069|h6069|data-tab="panels"/.test(studioSource), false);
assert.ok(studioSource.includes("Guirlande H70B3"));
// There must be no duplicate playback/send action below Importer ou créer.
assert.equal(studioSource.includes('id="gif-native-upload"'), false);
assert.equal(studioSource.includes('id="gif-play"'), false);
assert.equal(studioSource.includes('id="gif-stop"'), false);
assert.equal(studioSource.includes('id="editor-upload-hint"'), false);
assert.ok(studioSource.includes('id="h70-apply"'));
assert.ok(studioSource.includes('id="fit"'));
assert.ok(studioSource.includes('id="gif-preview-play"'));
assert.ok(studioSource.includes('id="editor-stage" hidden'));
assert.ok(studioSource.includes('id="editor-toolbar" hidden'));
assert.ok(studioSource.includes('.stage[hidden] { display:none !important; }'));
assert.ok(studioSource.includes('this._stopEditorPreview();'));



function fixture() {
  const calls = [];
  const fields = new Map();
  const get = (selector) => {
    if (!fields.has(selector)) {
      fields.set(selector, {
        value: "",
        textContent: "",
        disabled: false,
        classList: { toggle() {} },
        setAttribute() {},
        querySelectorAll: () => [],
        lastChild: { textContent: "" },
      });
    }
    return fields.get(selector);
  };
  const studio = new Studio();
  studio.config = Studio.getStubConfig();
  studio._h70 = Array(520).fill("#123456");
  studio._gifFrames = [{ colors: [...studio._h70], duration: 150 }];
  studio._gifEditing = true;
  studio._editorKind = "art";
  studio._gifFrameIndex = 0;
  studio._gifUndo = [];
  studio._gifEdited = false;
  studio._nativeGifReady = false;
  studio._tab = "curtain";
  studio._stopGif = () => {};
  studio._setStatus = (message, error=false) => { studio.testStatus = { message, error }; };
  studio._entryId = () => "h70b3_entry";
  studio.shadowRoot = { querySelector: get };
  studio._paintH70 = () => {};
  studio._renderGifEditor = () => {};
  studio._drawGifThumbnail = () => {};
  studio._updateGifTools = () => {};
  studio._loadGallery = async () => {};
  studio._showTab = () => {};
  studio._hass = {
    callService: async (domain, name, data) => calls.push({ domain, name, data }),
    callWS: async (data) => {
      calls.push({ ws: data });
      return { item: { id: data.item?.id || "stored-id" } };
    },
  };
  return { studio, calls, get };
}

{
  const { studio, calls } = fixture();
  await studio._sendH70();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "set_frame");
  assert.equal(calls[0].data.hold_ble, false);
  assert.equal(calls[0].data.commit, true);
  assert.equal(calls[0].data.colors.length, 520);
}

{
  const { studio, calls } = fixture();
  studio._editorKind = "animation";
  studio._gifFrames.push({ colors: Array(520).fill("#224466"), duration: 200 });
  studio._nativeGifReady = true;
  await studio._sendH70();
  assert.deepEqual(calls.map((call) => call.name), ["release_bluetooth", "upload_native_gif"],
    "Both send buttons must use the native GIF service, never set_frame streaming");
  const gif = Buffer.from(calls[1].data.gif_base64, "base64");
  assert.equal(gif.toString("ascii", 0, 6), "GIF89a");
  assert.equal(gif.readUInt16LE(6), 20);
  assert.equal(gif.readUInt16LE(8), 26);
  assert.equal(gif.at(-1), 0x3b);
}

{
  const { studio } = fixture();
  studio._stopGif = () => {};
  studio._showGifFrame = () => {};
  studio._createGif();
  assert.equal(studio._editorKind, "animation");
  assert.equal(studio._gifFrames.length, 2);
  assert.equal(studio._gifFrames[0].colors.length, 520);
  studio._duplicateGifFrame();
  assert.equal(studio._gifFrames.length, 3);
  assert.equal(studio._gifFrameIndex, 1);
  studio._deleteGifFrame();
  assert.equal(studio._gifFrames.length, 2);
  studio._createImage();
  assert.equal(studio._editorKind, "art");
  assert.equal(studio._gifFrames.length, 1);
  assert.equal(studio._gifFrames[0].colors.length, 520);
  assert.equal(studio._gifFrames[0].colors[0], "#000000");
}

{
  const { studio, calls, get } = fixture();
  get("#gif-editor-name").value = "Mon dessin";
  get("#gif-editor-category").value = "  Noël  ";
  await studio._saveGallery("art");
  const save = calls.find((call) => call.ws?.type === "govee_led_control/gallery/save");
  assert.ok(save);
  assert.equal(save.ws.item.kind, "art");
  assert.equal(save.ws.item.category, "Noël");
  assert.equal(save.ws.item.colors.length, 520);
  assert.equal(studio._editingGalleryId, "stored-id");
  assert.equal(studio._editingGalleryKind, "art");
}

{
  const { studio, calls, get } = fixture();
  studio._editorKind = "animation";
  studio._gifFrames.push({ colors: Array(520).fill("#007700"), duration: 180 });
  get("#gif-editor-name").value = "Mon animation";
  get("#gif-editor-category").value = "Halloween";
  await studio._saveGallery("animation");
  const save = calls.find((call) => call.ws?.type === "govee_led_control/gallery/save");
  assert.ok(save);
  assert.equal(save.ws.item.kind, "animation");
  assert.equal(save.ws.item.category, "Halloween");
  assert.equal(save.ws.item.frames.length, 2);
}

{
  const { studio } = fixture();
  studio._frameToColors = () => Array(520).fill("#aa5511");
  studio._showGifFrame = () => {};
  sandbox.createImageBitmap = async () => ({
    width: 64, height: 64, close() {},
  });
  sandbox.window.createImageBitmap = sandbox.createImageBitmap;
  await studio._loadMedia({ type: "image/png", name: "sapin.png", size: 128 });
  assert.equal(studio._editorKind, "art");
  assert.equal(studio._gifFrames.length, 1);
  assert.equal(studio._gifFrames[0].colors[0], "#aa5511");
  assert.equal(studio._nativeGifReady, false);
}

{
  const { studio } = fixture();
  studio._frameToColors = () => Array(520).fill("#00aa44");
  studio._showGifFrame = () => {};
  sandbox.ImageDecoder = class {
    constructor() { this.tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 3 } }; }
    async decode() {
      return { image: { displayWidth: 20, displayHeight: 26, duration: 150000, close() {} } };
    }
    close() {}
  };
  sandbox.window.ImageDecoder = sandbox.ImageDecoder;
  await studio._loadMedia({ type: "image/gif", name: "sapin.gif", size: 256, arrayBuffer: async () => new ArrayBuffer(16) });
  assert.equal(studio._editorKind, "animation");
  assert.equal(studio._gifFrames.length, 3);
  assert.equal(studio._nativeGifReady, true);
  assert.equal(studio._gifFrames[0].duration, 150);
}


// Editor starts hidden and appears only once artwork is created/imported/loaded.
{
  const studio = new Studio();
  studio.attachShadow = () => ({});
  studio._render = () => {};
  studio.setConfig({});
  assert.equal(studio._gifEditing, false);
  assert.equal(studio._gifFrames.length, 0);
  const elements = new Map();
  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: false, value: "", textContent: "", innerHTML: "",
      classList: { toggle() {} }, querySelectorAll: () => [], setAttribute() {},
    });
    return elements.get(selector);
  };
  studio.shadowRoot = {querySelector: get, querySelectorAll: () => []};
  studio._drawGifThumbnail = () => {};
  studio._renderGifEditor();
  assert.equal(get("#editor-toolbar").hidden, true);
  assert.equal(get("#editor-stage").hidden, true);
  assert.equal(get("#gif-editor").hidden, true);

  studio._gifEditing = true;
  studio._gifFrames = [{ colors: Array(520).fill("#000000"), duration: 150 }];
  studio._editorKind = "art";
  studio._renderGifEditor();
  assert.equal(get("#editor-toolbar").hidden, false);
  assert.equal(get("#editor-stage").hidden, false);
  assert.equal(get("#gif-editor").hidden, false);
  assert.equal(get("#gif-preview-play").disabled, true);
  studio._editorKind = "animation";
  studio._gifFrames.push({colors:Array(520).fill("#ffffff"),duration:240});
  studio._renderGifEditor();
  assert.equal(get("#gif-preview-play").disabled, false);
}

{
  const { studio, calls, get } = fixture();
  studio._editorKind = "animation";
  studio._gifFrames = [
    {colors:Array(520).fill("#123456"), duration: 130},
    {colors:Array(520).fill("#abcdef"), duration: 280},
  ];
  studio._editorPlaying = false;
  studio.shadowRoot.querySelectorAll = () => [];
  studio._paintH70 = () => {};
  studio._toggleEditorPreview();
  assert.equal(studio._editorPlaying, true);
  assert.equal(get("#gif-preview-play").textContent, "⏸ Pause");
  assert.equal(scheduled.size, 1);
  let [id, job] = [...scheduled][0];
  assert.equal(job.delay, 130);
  scheduled.delete(id);
  job.callback();
  assert.equal(studio._gifFrameIndex, 1);
  assert.equal(studio._h70[0], "#abcdef");
  assert.equal(get("#gif-frame-counter").textContent, "Image 2 / 2");
  assert.equal(get("#gif-frame-range").value, 2);
  [id, job] = [...scheduled][0];
  assert.equal(job.delay, 280);
  scheduled.delete(id);
  job.callback();
  assert.equal(studio._gifFrameIndex, 0);
  assert.equal(studio._h70[0], "#123456");
  assert.equal(scheduled.size, 1, "the preview loops over saved frames");
  assert.equal(calls.length, 0, "local GIF preview must not send any BLE/HA service calls");
  studio._toggleEditorPreview();
  assert.equal(studio._editorPlaying, false);
  assert.equal(get("#gif-preview-play").textContent, "▶ Lire");
  assert.equal(scheduled.size, 0, "Pause cancels the preview timer");

  // Manual navigation must stop automatic playback before editing.
  studio._stopGif = () => studio._stopEditorPreview();
  studio._showGifFrame = () => {};
  studio._toggleEditorPreview();
  assert.equal(scheduled.size, 1);
  studio._selectGifFrame(1);
  assert.equal(studio._editorPlaying, false);
  assert.equal(scheduled.size, 0);
  assert.equal(calls.length, 0);
}
console.log("LED Studio: hidden until selection, local GIF play/pause and frame timing OK");

console.log("LED Studio: unified image/GIF editor, import, save, native upload and static transfer OK");

// Editing an existing artwork restores its category without changing the pixels.
{
  const { studio, get } = fixture();
  studio._galleryItems = [{
    id: "old", name: "Sapin", target: "h70b3", kind: "art",
    category: "Noël", colors: Array(520).fill("#136524"), brightness: 90,
  }];
  studio._showGifFrame = () => {};
  studio._focusEditor = () => {};
  studio._openGalleryItem("old");
  assert.equal(get("#gif-editor-category").value, "Noël");
  assert.equal(studio._editingGalleryId, "old");
  studio._galleryItems[0].category = undefined; // Legacy saved creation.
  studio._openGalleryItem("old");
  assert.equal(get("#gif-editor-category").value, "");
}

// Category management is independent from individual artwork editing.
{
  const { studio, calls, get } = fixture();
  studio._galleryCategories = ["Halloween", "Noël"];
  studio._galleryItems = [
    { id: "one", category: "Noël", kind: "art" },
    { id: "two", category: "Noël", kind: "animation" },
  ];
  const select = get("#manage-category");
  studio._renderCategoryManager();
  assert.match(select.innerHTML, /Halloween/);
  assert.match(select.innerHTML, /Noël/);
  const suggestionList = get("#govee-category-list");
  studio._updateCategorySuggestions();
  assert.match(suggestionList.innerHTML, /Halloween/, "empty category still suggested");

  select.value = "Noël";
  get("#gif-editor-category").value = "Noël";
  sandbox.window.prompt = () => "Fêtes";
  studio._loadGallery = async () => { studio._galleryCategories = ["Halloween", "Fêtes"]; };
  await studio._manageCategory("rename");
  const rename = calls.find((call) => call.ws?.action === "rename");
  assert.equal(rename.ws.type, "govee_led_control/gallery/category/manage");
  assert.equal(rename.ws.name, "Noël");
  assert.equal(rename.ws.new_name, "Fêtes");
  assert.equal(get("#gif-editor-category").value, "Fêtes");
  assert.equal(select.value, "Fêtes");

  sandbox.window.prompt = () => "Hiver";
  studio._loadGallery = async () => { studio._galleryCategories.push("Hiver"); };
  await studio._manageCategory("create");
  const created = calls.find((call) => call.ws?.action === "create");
  assert.equal(created.ws.name, "Hiver");

  select.value = "Fêtes";
  get("#gif-editor-category").value = "Fêtes";
  studio._loadGallery = async () => { studio._galleryCategories = ["Halloween", "Hiver"]; };
  await studio._manageCategory("delete");
  const deleted = calls.find((call) => call.ws?.action === "delete");
  assert.equal(deleted.ws.name, "Fêtes");
  assert.equal(get("#gif-editor-category").value, "");
  assert.equal(select.value, "");
  assert.match(studio.testStatus.message, /conservés/);
}


// Gallery uses two-column compact cards and a separate, visible category badge.
{
  const { studio, get } = fixture();
  studio._galleryItems = [
    { id: "one", target: "h70b3", kind: "animation", name: "Bonhomme de neige",
      category: "Noël", frames: [{ colors: Array(520).fill("#ffffff"), duration: 100 }] },
    { id: "two", target: "h70b3", kind: "art", name: "Cadeau", category: "Fêtes",
      colors: Array(520).fill("#123456") },
    { id: "three", target: "h70b3", kind: "art", name: "Sans catégorie",
      colors: Array(520).fill("#123456") },
    { id: "legacy", target: "h6069", kind: "art", name: "Panneaux",
      colors: Array(520).fill("#123456") },
  ];
  studio._stopGalleryPreviews = () => {};
  studio._startGalleryPreviews = () => {};
  studio._renderGallery();
  const html = get("#gallery-list").innerHTML;
  assert.equal((html.match(/class="gallery-item"/g) || []).length, 3);
  assert.match(html, /class="gallery-category" title="Catégorie : Noël">Noël<\/span>/);
  assert.match(html, /class="gallery-category" title="Catégorie : Fêtes">Fêtes<\/span>/);
  assert.match(html, /class="gallery-category" title="Catégorie : Non classé">Non classé<\/span>/);
  assert.match(html, /GIF animé · 1 images/);
  assert.equal((html.match(/class="gallery-actions"/g) || []).length, 3);
  assert.equal((html.match(/data-gallery-load=/g) || []).length, 3);
  assert.equal((html.match(/data-gallery-delete=/g) || []).length, 3);
  assert.doesNotMatch(html, /Panneaux/);
  assert.match(studio._styles(), /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(studio._styles(), /@container\(max-width:420px\).*grid-template-columns:minmax\(0,1fr\)/);

  studio._galleryItems[0].category = '<script>alert("x")</script>';
  studio._renderGallery();
  assert.doesNotMatch(get("#gallery-list").innerHTML, /<script>/);
}


// Desktop LED Studio uses two *main* columns (editor left, gallery right),
// distinct from the existing two-column artwork grid inside the gallery.
// Responsive fallbacks retain the original full-width stacked layout.
{
  const src = studioSource;
  const columns = src.indexOf('<div class="studio-columns">');
  const workspace = src.indexOf('<div class="studio-workspace">', columns);
  const toolbar = src.indexOf('<section class="toolbar"', workspace);
  const stage = src.indexOf('<main id="curtain"', workspace);
  const workspaceClose = src.indexOf('        </main>\n          </div>', stage);
  const gallery = src.indexOf('<section class="gallery-panel">', workspaceClose);
  const library = src.indexOf('id="gallery-list"', gallery);
  const columnsClose = src.indexOf('        </section>\n        </div>\n      </ha-card>', library);
  assert.ok(columns >= 0 && workspace > columns && toolbar > workspace &&
    stage > toolbar && workspaceClose > stage && gallery > workspaceClose &&
    library > gallery && columnsClose > library,
    "desktop wrapper must place editor and gallery in sibling columns");
  const css = (new Studio())._styles();
  assert.match(css, /\.studio-columns \{ display:block; min-width:0; \}/,
    "narrow cards remain in the original vertical flow");
  assert.match(css, /@container \(min-width:940px\) \{[\s\S]*?\.studio-columns \{ display:grid; grid-template-columns:minmax\(0,1\.08fr\) minmax\(0,1fr\);/,
    "desktop breakpoint creates two independent columns");
  assert.match(css, /\.gallery-panel \{ border-top:0; border-left:/,
    "the gallery has a vertical divider in the desktop workspace");
  assert.match(css, /@container \(min-width:1580px\)/,
    "the matrix and presets can share a row only when width permits");
  assert.match(css, /@container\(max-width:420px\).*\.gallery-list \{ grid-template-columns:minmax\(0,1fr\)/);
}


// Pixel shifting edits one 20x26 frame without horizontal wrapping,
// preserving untouched frames and their durations, and remains undoable.
{
  const { studio, calls, get } = fixture();
  studio._editorKind = "animation";
  const first = Array(520).fill("#000000");
  first[0] = "#ff0000"; // top-left
  first[19] = "#00ff00"; // top-right, must be clipped on shift-right
  first[20] = "#0000ff"; // next row, must NOT wrap into previous row
  studio._gifFrames = [
    {colors:first, duration:140},
    {colors:Array(520).fill("#112233"), duration:320},
  ];
  studio._showGifFrame = () => { studio._h70 = [...studio._gifFrames[studio._gifFrameIndex].colors]; };
  const initial = [...first];

  studio._shiftGifPixels(1);
  assert.equal(studio._gifFrames[0].colors[0], "#000000");
  assert.equal(studio._gifFrames[0].colors[1], "#ff0000");
  assert.equal(studio._gifFrames[0].colors[19], "#000000");
  assert.equal(studio._gifFrames[0].colors[20], "#000000");
  assert.equal(studio._gifFrames[0].colors[21], "#0000ff");
  assert.equal(studio._gifFrames[0].duration, 140);
  assert.equal(studio._gifFrames[1].colors[0], "#112233");
  assert.equal(studio._gifUndo.length, 1);
  studio._undoGifEdit();
  assert.deepEqual(Array.from(studio._gifFrames[0].colors), initial);

  studio._shiftGifPixels(-1);
  assert.equal(studio._gifFrames[0].colors[18], "#00ff00");
  assert.equal(studio._gifFrames[0].colors[19], "#000000");
  assert.equal(studio._gifFrames[0].colors[20], "#000000");
  studio._undoGifEdit();
  assert.deepEqual(Array.from(studio._gifFrames[0].colors), initial);

  studio._gifFrames[0].colors.fill("#000000");
  studio._gifUndo = [];
  studio._shiftGifPixels(1);
  assert.equal(studio._gifUndo.length, 0, "no undo entry for an unchanged all-black frame");

  studio._gifEditing = false;
  studio._shiftGifPixels(1);
  assert.equal(studio._gifUndo.length, 0);
  assert.equal(calls.length, 0, "shifting never sends a physical device command");
  assert.ok(studioSource.includes('id="gif-shift-left"'));
  assert.ok(studioSource.includes('id="gif-shift-right"'));
}

// Reordering the timeline swaps complete frames (pixels + timing), preserves
// the selected artwork, respects boundaries and can be undone.
{
  const {studio, calls} = fixture();
  studio._editorKind = "animation";
  studio._gifFrames = [
    {colors:Array(520).fill("#110000"), duration:100},
    {colors:Array(520).fill("#220000"), duration:200},
    {colors:Array(520).fill("#330000"), duration:300},
  ];
  studio._showGifFrame = () => { studio._h70 = [...studio._gifFrames[studio._gifFrameIndex].colors]; };
  studio._moveGifFrame(-1);
  assert.equal(studio._gifFrameIndex, 0);
  assert.equal(studio._gifUndo.length, 0, "first frame cannot move earlier");

  studio._moveGifFrame(1);
  assert.equal(studio._gifFrameIndex, 1);
  assert.deepEqual(Array.from(studio._gifFrames, (f) => f.duration), [200,100,300]);
  assert.equal(studio._h70[0], "#110000");
  assert.equal(studio._gifUndo.length, 1);
  studio._moveGifFrame(1);
  assert.equal(studio._gifFrameIndex, 2);
  assert.deepEqual(Array.from(studio._gifFrames, (f) => f.duration), [200,300,100]);
  studio._moveGifFrame(1);
  assert.equal(studio._gifUndo.length, 2, "last frame cannot move later");

  studio._undoGifEdit();
  assert.equal(studio._gifFrameIndex, 1);
  assert.deepEqual(Array.from(studio._gifFrames, (f) => f.duration), [200,100,300]);
  studio._undoGifEdit();
  assert.equal(studio._gifFrameIndex, 0);
  assert.deepEqual(Array.from(studio._gifFrames, (f) => f.duration), [100,200,300]);

  studio._editorKind = "art";
  studio._moveGifFrame(1);
  assert.equal(studio._gifFrameIndex, 0, "still artwork cannot be reordered");
  assert.equal(calls.length, 0);
  assert.ok(studioSource.includes('id="gif-move-earlier"'));
  assert.ok(studioSource.includes('id="gif-move-later"'));
}
console.log("LED Studio: image shifts, frame reordering, bounds, durations and undo OK");
