const CARD_VERSION = "0.5.15-shift-reorder";
const H70_WIDTH = 20;
const H70_HEIGHT = 26;
const H70_PIXELS = H70_WIDTH * H70_HEIGHT;
const BLACK = "#000000";

const PALETTE = [
  "#ff1744", "#ff6d00", "#ffd600", "#76ff03", "#00e676",
  "#00e5ff", "#2979ff", "#651fff", "#d500f9", "#ff4081",
  "#ffffff", "#000000",
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hsvToHex(h, s = 1, v = 1) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const rgb = [
    [v, t, p], [q, v, p], [p, v, t],
    [p, q, v], [t, p, v], [v, p, q],
  ][i % 6];
  return `#${rgb.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

// Encode the frames already fitted to the 20×26 LED matrix as a standalone
// GIF89a (RGB332 global palette, LZW, original frame delays and infinite loop).
// Runs only on explicit native-upload; no browser streaming is started.
function encodeNativeGifFrames(frames) {
  if (!frames.length || frames.length > 120) throw new Error("Nombre d'images GIF invalide");
  const bytes = [];
  const put = (...items) => bytes.push(...items);
  const word = (value) => put(value & 255, (value >>> 8) & 255);
  for (const ch of "GIF89a") put(ch.charCodeAt(0));
  word(H70_WIDTH); word(H70_HEIGHT);
  put(0xf7, 0, 0); // Global 256-color RGB332 palette.
  for (let i = 0; i < 256; i += 1) {
    put(Math.round(((i >>> 5) & 7) * 255 / 7),
      Math.round(((i >>> 2) & 7) * 255 / 7),
      Math.round((i & 3) * 255 / 3));
  }
  put(0x21, 0xff, 11);
  for (const ch of "NETSCAPE2.0") put(ch.charCodeAt(0));
  put(3, 1, 0, 0, 0); // Infinite repeat.
  for (const frame of frames) {
    if (!Array.isArray(frame.colors) || frame.colors.length !== H70_PIXELS) {
      throw new Error("La trame GIF n'a pas 520 pixels");
    }
    const delay = clamp(Math.round(frame.duration / 10), 2, 65535);
    put(0x21, 0xf9, 4, 0, delay & 255, delay >>> 8, 0, 0);
    put(0x2c);
    word(0); word(0); word(H70_WIDTH); word(H70_HEIGHT); put(0);
    put(8); // Minimum LZW code size.
    const indexed = frame.colors.map((hex) => {
      if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) {
        throw new Error("Couleur de pixel GIF invalide");
      }
      const red = parseInt(hex.slice(1, 3), 16);
      const green = parseInt(hex.slice(3, 5), 16);
      const blue = parseInt(hex.slice(5, 7), 16);
      return (red & 0xe0) | ((green & 0xe0) >>> 3) | (blue >>> 6);
    });
    const compressed = [];
    let bitCount = 0;
    let accumulator = 0;
    const emit = (code, width) => {
      accumulator |= code << bitCount;
      bitCount += width;
      while (bitCount >= 8) {
        compressed.push(accumulator & 255);
        accumulator >>>= 8;
        bitCount -= 8;
      }
    };
    const dictionary = new Map();
    let nextCode = 258;
    let codeSize = 9;
    emit(256, codeSize);
    let current = indexed[0];
    for (let i = 1; i < indexed.length; i += 1) {
      const pixel = indexed[i];
      const key = current * 256 + pixel;
      const match = dictionary.get(key);
      if (match !== undefined) {
        current = match;
      } else {
        emit(current, codeSize);
        if (nextCode < 4096) {
          dictionary.set(key, nextCode++);
          if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
        } else {
          emit(256, codeSize);
          dictionary.clear();
          nextCode = 258;
          codeSize = 9;
        }
        current = pixel;
      }
    }
    emit(current, codeSize);
    emit(257, codeSize);
    if (bitCount) compressed.push(accumulator & 255);
    for (let i = 0; i < compressed.length; i += 255) {
      const block = compressed.slice(i, i + 255);
      put(block.length, ...block);
    }
    put(0);
  }
  put(0x3b); // GIF trailer.
  if (bytes.length > 320 * 1024) {
    throw new Error("GIF converti trop volumineux (limite 320 Kio)");
  }
  return Uint8Array.from(bytes);
}

class GoveeLedStudio extends HTMLElement {
  static getStubConfig() {
    return {
      h70b3_transport_entity: "sensor.h70b3_transport",
    };
  }

  setConfig(config) {
    this.config = { ...GoveeLedStudio.getStubConfig(), ...config };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._selectedColor ||= "#ff1744";
    this._brightness ||= 70;
    this._fit ||= "contain";
    this._h70 ||= Array(H70_PIXELS).fill(BLACK);
    // Do not create an artwork at startup: the editor only opens on explicit
    // Import / Nouvelle image / Nouveau GIF / gallery selection.
    this._gifFrames ||= [];
    this._editorKind ||= "art";
    this._gifEditing ??= false;
    this._editorPlaying ??= false;
    this._nativeGifReady ||= false;
    this._gifFrameIndex ||= 0;
    this._gifEraser ||= false;
    this._gifUndo ||= [];
    this._gifEdited ||= false;
    this._editingGalleryId ||= null;
    this._editingGalleryKind ||= null;
    this._galleryItems ||= [];
    this._galleryCategories ||= [];
    this._render();
  }

  connectedCallback() {
    // HA can keep the old view mounted when navigating to another dashboard page.
    this._onVisibilityChange ||= () => {
      if (document.hidden) {
        this._stopGif();
        this._stopGalleryPreviews();
      } else {
        this._startGalleryPreviews();
      }
    };
    this._onRouteChange ||= () => {
      if (this._editorPlaying) this._stopEditorPreview();
      if (this._playing && window.location.href !== this._gifPageUrl) this._stopGif();
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);
    window.addEventListener("popstate", this._onRouteChange);
    window.addEventListener("hashchange", this._onRouteChange);
    window.addEventListener("location-changed", this._onRouteChange);
    window.addEventListener("pagehide", this._onVisibilityChange);
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    window.removeEventListener("popstate", this._onRouteChange);
    window.removeEventListener("hashchange", this._onRouteChange);
    window.removeEventListener("location-changed", this._onRouteChange);
    window.removeEventListener("pagehide", this._onVisibilityChange);
    this._stopGif();
    this._stopGalleryPreviews();
  }

  set hass(value) {
    this._hass = value;
    if (this.shadowRoot && !this._rendered) this._render();
    if (this._rendered && !this._galleryLoaded && !this._galleryLoading) this._loadGallery();
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return {
      columns: "full",
      min_columns: 6,
    };
  }

  _render() {
    if (!this.shadowRoot || !this.config) return;
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <header>
          <div>
            <div class="eyebrow">GOVEE CONTROL</div>
            <h1>LED Studio</h1>
            <p>Dessinez, choisissez un motif ou lancez un GIF.</p>
          </div>
          <div class="status" id="status"><span></span>Prêt</div>
        </header>

        <div class="device-label">Guirlande H70B3 · 520 LED</div>

        <div class="studio-columns">
          <div class="studio-workspace">
        <section class="toolbar" id="editor-toolbar" hidden>
          <label class="color-control">Couleur <input id="color" type="color" value="${this._selectedColor}"></label>
          <div class="palette">${PALETTE.map((color) => `<button class="swatch" data-color="${color}" style="--swatch:${color}" title="${color}"></button>`).join("")}</div>
          <label class="range-control">Luminosité <strong id="brightness-value">${this._brightness}%</strong>
            <input id="brightness" type="range" min="1" max="100" value="${this._brightness}">
          </label>
        </section>

        <main id="curtain" class="view active">
          <div class="stage" id="editor-stage" hidden>
            <div class="matrix-editor-area">
              <div class="gif-editor" id="gif-editor" hidden>
                <div class="gif-editor-head">
                  <strong id="editor-title">Éditeur d'image</strong>
                  <span id="gif-frame-counter">Image fixe · 20 × 26</span>
                </div>
                <div class="gif-editor-toolbar">
                  <button class="gif-animation-only" id="gif-prev" title="Image précédente" type="button">◀</button>
                  <button class="gif-animation-only gif-preview-play" id="gif-preview-play" title="Lire les images dans l’éditeur uniquement" type="button">▶ Lire</button>
                  <button class="gif-animation-only" id="gif-next" title="Image suivante" type="button">▶</button>
                  <label class="gif-animation-only">Durée <input id="gif-frame-duration" type="number" min="100" max="2000" step="10" value="150"> ms</label>
                  <button id="gif-undo" title="Annuler" type="button" disabled>↶ Annuler</button>
                  <button id="gif-erase" title="Peindre en noir" type="button">⌫ Gomme</button>
                </div>
                <div class="gif-pixel-shift" aria-label="Déplacer le dessin dans l'image">
                  <span>Décaler le dessin (1 pixel)</span>
                  <button id="gif-shift-left" type="button" title="Décaler les pixels d'une colonne vers la gauche" aria-label="Décaler le dessin à gauche">←</button>
                  <button id="gif-shift-right" type="button" title="Décaler les pixels d'une colonne vers la droite" aria-label="Décaler le dessin à droite">→</button>
                </div>
                <input id="gif-frame-range" class="gif-animation-only" aria-label="Numéro d'image du GIF" type="range" min="1" max="1" value="1">
                <div class="gif-filmstrip gif-animation-only" id="gif-filmstrip" aria-label="Images du GIF"></div>
                <div class="gif-editor-actions gif-animation-only">
                  <button id="gif-move-earlier" title="Reculer l'image sélectionnée dans l'ordre du GIF" type="button">← Reculer l'image</button>
                  <button id="gif-move-later" title="Avancer l'image sélectionnée dans l'ordre du GIF" type="button">Avancer l'image →</button>
                  <button id="gif-duplicate" type="button">+ Ajouter une image</button>
                  <button id="gif-delete" type="button">− Supprimer</button>
                  <button id="gif-clear-frame" type="button">Effacer l'image</button>
                </div>
                <button class="gif-clear-still" id="gif-clear-still" type="button">Effacer l'image</button>
                <div class="gif-editor-save">
                  <input id="gif-editor-name" maxlength="64" placeholder="Nom de la création" aria-label="Nom de la création">
                  <label class="category-editor-label" for="gif-editor-category">Catégorie
                    <input id="gif-editor-category" maxlength="40" list="govee-category-list" placeholder="Non classé" autocomplete="off">
                    <datalist id="govee-category-list"></datalist>
                  </label>
                  <button id="gif-editor-save" class="primary" type="button">Enregistrer l’image</button>
                </div>
                <small>Cliquez ou glissez sur les pixels pour dessiner. Image fixe et GIF utilisent les mêmes outils. Les modifications restent locales jusqu’à l’enregistrement ou l’envoi.</small>
              </div>
              <div class="matrix-shell"><div id="h70-grid" class="matrix"></div></div>
            </div>
            <div class="side-panel">
              <h2>Motifs</h2>
              <div class="button-grid">
                <button data-h70-preset="solid">Couleur unie</button>
                <button data-h70-preset="rainbow">Arc-en-ciel</button>
                <button data-h70-preset="gradient">Dégradé</button>
                <button data-h70-preset="sparkle">Étoiles</button>
              </div>
              <button class="primary" id="h70-apply">Envoyer à la guirlande</button>
              <button class="danger" id="h70-clear">Tout éteindre</button>
            </div>
          </div>

          <div class="gif-panel">
            <div>
              <div class="eyebrow">ANIMATIONS</div>
              <h2>Importer ou créer</h2>
              <p>Images fixes et GIF sont convertis en 20 × 26 et modifiables dans l'éditeur unique.</p>
            </div>
            <label class="upload" id="drop-zone">
              <input id="gif-file" type="file" accept="image/*,.gif,.png,.jpg,.jpeg,.webp,.bmp">
              <span class="upload-icon">＋</span>
              <strong>Importer une image ou un GIF</strong>
              <small>PNG, JPG, WebP, GIF · 10 Mo max</small>
            </label>
            <div class="gif-new-action">
              <button type="button" id="image-create">+ Nouvelle image</button>
              <button type="button" id="gif-create">+ Nouveau GIF</button>
              <small>Le GIF commence par 2 images ; vous pouvez en ajouter jusqu'à 120.</small>
            </div>
            <div class="gif-controls">
              <label>Ajustement
                <select id="fit"><option value="contain">Image entière</option><option value="cover">Remplir</option><option value="stretch">Étirer</option></select>
              </label>
            </div>
            <div id="gif-info" class="gif-info" hidden aria-live="polite"></div>
          </div>
        </main>
          </div>

        <section class="gallery-panel">
          <div class="gallery-heading">
            <div>
              <div class="eyebrow">GALERIE</div>
              <h2>Créations enregistrées</h2>
              <p>Chargez une image ou un GIF pour le modifier dans l’éditeur.</p>
            </div>
          </div>
          <div class="category-manager">
            <div class="category-manager-head"><strong>Gérer les catégories</strong><small>Les catégories restent disponibles même sans image.</small></div>
            <div class="category-manager-actions">
              <select id="manage-category" aria-label="Catégorie à gérer"><option value="">Choisir une catégorie</option></select>
              <button id="category-create" type="button">+ Créer</button>
              <button id="category-rename" type="button">Renommer</button>
              <button id="category-delete" type="button">Supprimer</button>
            </div>
            <small>Supprimer une catégorie déplace ses images et GIF dans « Non classé », sans supprimer les fichiers.</small>
          </div>
          <div class="gallery-list" id="gallery-list"><p>Chargement de la galerie…</p></div>
        </section>
        </div>
      </ha-card>`;
    this._rendered = true;
    this._bindEvents();
    this._renderGifEditor();
    if (this._gifEditing && this._gifFrames.length) this._paintH70();
    this._renderGallery();
    this._renderCategoryManager();
    if (this._hass && !this._galleryLoaded && !this._galleryLoading) this._loadGallery();
  }

  _bindEvents() {
    const root = this.shadowRoot;
    root.querySelector("#color").addEventListener("input", (event) => { this._selectedColor = event.target.value; this._gifEraser = false; this._updateGifTools(); });
    root.querySelectorAll(".swatch").forEach((button) => button.addEventListener("click", () => {
      this._selectedColor = button.dataset.color;
      this._gifEraser = false;
      this._updateGifTools();
      root.querySelector("#color").value = this._selectedColor;
    }));
    root.querySelector("#brightness").addEventListener("input", (event) => {
      this._brightness = Number(event.target.value);
      root.querySelector("#brightness-value").textContent = `${this._brightness}%`;
    });
    root.querySelector("#fit").addEventListener("change", async (event) => {
      if (this._gifEditing && !this._gifFile) {
        event.target.value = this._fit;
        return this._setStatus("L’ajustement n’est disponible que lors de l’import du fichier original.", true);
      }
      if (this._gifEdited && !window.confirm("Changer l’ajustement remplacera vos modifications. Continuer ?")) {
        event.target.value = this._fit;
        return;
      }
      this._fit = event.target.value;
      if (this._gifFile) await this._loadMedia(this._gifFile, true);
    });

    root.querySelectorAll("[data-h70-preset]").forEach((button) => button.addEventListener("click", () => this._presetH70(button.dataset.h70Preset)));
    root.querySelector("#h70-apply").addEventListener("click", () => this._sendH70());
    root.querySelector("#h70-clear").addEventListener("click", () => this._clear());
    root.querySelector("#gif-file").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await this._loadMedia(file);
      event.target.value = "";
    });
    root.querySelector("#gif-create").addEventListener("click", () => this._createGif());
    root.querySelector("#image-create").addEventListener("click", () => this._createImage());
    root.querySelector("#gif-prev").addEventListener("click", () => this._selectGifFrame(this._gifFrameIndex - 1));
    root.querySelector("#gif-preview-play").addEventListener("click", () => this._toggleEditorPreview());
    root.querySelector("#gif-next").addEventListener("click", () => this._selectGifFrame(this._gifFrameIndex + 1));
    root.querySelector("#gif-frame-range").addEventListener("input", (event) => this._selectGifFrame(Number(event.target.value) - 1));
    root.querySelector("#gif-frame-duration").addEventListener("change", (event) => this._setGifDuration(Number(event.target.value)));
    root.querySelector("#gif-undo").addEventListener("click", () => this._undoGifEdit());
    root.querySelector("#gif-shift-left").addEventListener("click", () => this._shiftGifPixels(-1));
    root.querySelector("#gif-shift-right").addEventListener("click", () => this._shiftGifPixels(1));
    root.querySelector("#gif-move-earlier").addEventListener("click", () => this._moveGifFrame(-1));
    root.querySelector("#gif-move-later").addEventListener("click", () => this._moveGifFrame(1));
    root.querySelector("#gif-erase").addEventListener("click", () => {
      this._gifEraser = !this._gifEraser;
      this._updateGifTools();
    });
    root.querySelector("#gif-duplicate").addEventListener("click", () => this._duplicateGifFrame());
    root.querySelector("#gif-delete").addEventListener("click", () => this._deleteGifFrame());
    root.querySelector("#gif-clear-frame").addEventListener("click", () => this._clearGifFrame());
    root.querySelector("#gif-clear-still").addEventListener("click", () => this._clearGifFrame());
    root.querySelector("#gif-editor-save").addEventListener("click", () => this._saveGifFromEditor());
    root.querySelector("#category-create").addEventListener("click", () => this._manageCategory("create"));
    root.querySelector("#category-rename").addEventListener("click", () => this._manageCategory("rename"));
    root.querySelector("#category-delete").addEventListener("click", () => this._manageCategory("delete"));
    const pixelGrid = root.querySelector("#h70-grid");
    pixelGrid.addEventListener("pointerdown", (event) => {
      if (!this._gifEditing || !this._gifFrames.length || event.button > 0) return;
      const index = this._gifPixelAt(event.clientX, event.clientY);
      if (index === null || this._gifFrames[this._gifFrameIndex].colors[index] === this._gifPaintColor()) return;
      this._stopGif();
      this._pushGifUndo();
      this._gifPointerId = event.pointerId;
      pixelGrid.setPointerCapture?.(event.pointerId);
      this._paintGifPixel(index);
      event.preventDefault();
    });
    pixelGrid.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this._gifPointerId || !this._gifEditing) return;
      if (event.pointerType === "mouse" && !(event.buttons & 1)) return;
      const index = this._gifPixelAt(event.clientX, event.clientY);
      if (index !== null) this._paintGifPixel(index);
      event.preventDefault();
    });
    const endStroke = (event) => {
      if (event.pointerId !== this._gifPointerId) return;
      this._gifPointerId = null;
      if (pixelGrid.hasPointerCapture?.(event.pointerId)) pixelGrid.releasePointerCapture(event.pointerId);
    };
    pixelGrid.addEventListener("pointerup", endStroke);
    pixelGrid.addEventListener("pointercancel", endStroke);

  }

  _gifPaintColor() { return this._gifEraser ? BLACK : this._selectedColor; }

  _gifPixelAt(x, y) {
    const grid = this.shadowRoot?.querySelector("#h70-grid");
    const bounds = grid?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height ||
        x < bounds.left || y < bounds.top || x >= bounds.right || y >= bounds.bottom) return null;
    const col = Math.floor((x - bounds.left) / bounds.width * H70_WIDTH);
    const row = Math.floor((y - bounds.top) / bounds.height * H70_HEIGHT);
    return row * H70_WIDTH + col;
  }

  _pushGifUndo() {
    this._gifUndo ||= [];
    this._gifUndo.push({
      index: this._gifFrameIndex,
      frames: this._gifFrames.map((frame) => ({ colors: [...frame.colors], duration: frame.duration })),
    });
    if (this._gifUndo.length > 15) this._gifUndo.shift();
    this._updateGifTools();
  }

  _markGifEdited() {
    this._gifEdited = true;
    this._nativeGifReady = this._editorKind === "animation" && this._gifFrames.length > 0;
    this._updateGifTools();
  }

  _paintGifPixel(index) {
    if (!this._gifEditing || !this._gifFrames[this._gifFrameIndex] ||
        !Number.isInteger(index) || index < 0 || index >= H70_PIXELS) return;
    const color = this._gifPaintColor();
    const frame = this._gifFrames[this._gifFrameIndex];
    if (frame.colors[index] === color) return;
    frame.colors[index] = color;
    this._h70[index] = color;
    const pixel = this.shadowRoot.querySelector("#h70-grid")?.children[index];
    if (pixel) pixel.style.setProperty("--pixel", color);
    this._markGifEdited();
    this._drawGifThumbnail(this._gifFrameIndex);
  }

  _showGifFrame() {
    const frame = this._gifFrames[this._gifFrameIndex];
    if (!frame) return;
    this._h70 = [...frame.colors];
    this._paintH70();
    this._renderGifEditor();
  }

  _selectGifFrame(index) {
    if (!this._gifEditing || !this._gifFrames.length) return;
    this._stopGif();
    this._gifFrameIndex = clamp(Math.trunc(index), 0, this._gifFrames.length - 1);
    this._showGifFrame();
  }

  // The preview displays stored frames ONLY in the HTML pixel grid.
  // It never calls Home Assistant services, uploads GIFs, or holds BLE.
  _toggleEditorPreview() {
    if (this._editorPlaying) return this._stopEditorPreview();
    if (!this._gifEditing || this._editorKind !== "animation" ||
        this._gifFrames.length < 2) return;
    this._stopEditorPreview();
    this._editorPlaying = true;
    this._updateEditorPlayButton();
    this._scheduleEditorPreview();
  }

  _scheduleEditorPreview() {
    if (!this._editorPlaying || this._editorKind !== "animation" ||
        !this._gifFrames.length || document.hidden) {
      return this._stopEditorPreview();
    }
    const duration = clamp(Number(this._gifFrames[this._gifFrameIndex].duration) || 150, 100, 2000);
    this._editorPreviewTimer = setTimeout(() => {
      this._editorPreviewTimer = undefined;
      if (!this._editorPlaying) return;
      this._gifFrameIndex = (this._gifFrameIndex + 1) % this._gifFrames.length;
      this._displayEditorPreviewFrame();
      this._scheduleEditorPreview();
    }, duration);
  }

  _displayEditorPreviewFrame() {
    const frame = this._gifFrames[this._gifFrameIndex];
    if (!frame) return;
    this._h70 = [...frame.colors];
    const root = this.shadowRoot;
    const grid = root?.querySelector("#h70-grid");
    if (grid?.children?.length === H70_PIXELS) {
      for (let index = 0; index < H70_PIXELS; index += 1) {
        grid.children[index].style.setProperty("--pixel", frame.colors[index]);
      }
    } else {
      this._paintH70();
    }
    root.querySelector("#gif-frame-counter").textContent =
      "Image " + (this._gifFrameIndex + 1) + " / " + this._gifFrames.length;
    root.querySelector("#gif-frame-range").value = this._gifFrameIndex + 1;
    root.querySelector("#gif-frame-duration").value = frame.duration;
    root.querySelector("#gif-prev").disabled = this._gifFrameIndex === 0;
    root.querySelector("#gif-next").disabled = this._gifFrameIndex === this._gifFrames.length - 1;
    root.querySelector("#gif-move-earlier").disabled = this._gifFrameIndex === 0;
    root.querySelector("#gif-move-later").disabled = this._gifFrameIndex === this._gifFrames.length - 1;
    root.querySelectorAll("#gif-filmstrip [data-frame]").forEach((button) =>
      button.classList.toggle("active", Number(button.dataset.frame) === this._gifFrameIndex));
  }

  _stopEditorPreview() {
    if (this._editorPreviewTimer !== undefined) {
      clearTimeout(this._editorPreviewTimer);
      this._editorPreviewTimer = undefined;
    }
    this._editorPlaying = false;
    this._updateEditorPlayButton();
  }

  _updateEditorPlayButton() {
    const button = this.shadowRoot?.querySelector("#gif-preview-play");
    if (!button) return;
    button.disabled = !this._gifEditing || this._editorKind !== "animation" ||
      this._gifFrames.length < 2;
    button.textContent = this._editorPlaying ? "⏸ Pause" : "▶ Lire";
    button.classList.toggle("active", !!this._editorPlaying);
    button.setAttribute("aria-pressed", this._editorPlaying ? "true" : "false");
  }

  _focusEditor() {
    this.shadowRoot?.querySelector("#editor-stage")?.scrollIntoView?.({
      behavior: "smooth", block: "start",
    });
  }

  _renderGifEditor() {
    const root = this.shadowRoot;
    const editor = root?.querySelector("#gif-editor");
    if (!editor) return;
    const active = this._gifEditing && this._gifFrames.length > 0;
    const animation = active && this._editorKind === "animation";
    root.querySelector("#editor-toolbar").hidden = !active;
    root.querySelector("#editor-stage").hidden = !active;
    root.querySelector("#curtain").classList.toggle("editor-active", active);
    editor.hidden = !active;
    editor.classList.toggle("is-still", active && !animation);
    root.querySelectorAll(".gif-animation-only").forEach((element) => {
      element.hidden = !animation;
    });
    root.querySelector("#h70-apply").textContent = animation
      ? "▶ Lancer le GIF sur le rideau"
      : "▶ Envoyer l'image à la guirlande";
    if (!active) return;
    const count = this._gifFrames.length;
    this._gifFrameIndex = clamp(this._gifFrameIndex, 0, count - 1);
    root.querySelector("#editor-title").textContent = animation ? "Éditeur GIF · image par image" : "Éditeur d'image";
    root.querySelector("#gif-editor-save").textContent = animation ? "Enregistrer le GIF" : "Enregistrer l'image";
    root.querySelector("#gif-frame-counter").textContent = animation
      ? "Image " + (this._gifFrameIndex + 1) + " / " + count
      : "Image fixe · 20 × 26";
    const range = root.querySelector("#gif-frame-range");
    range.max = count;
    range.value = this._gifFrameIndex + 1;
    root.querySelector("#gif-frame-duration").value = this._gifFrames[this._gifFrameIndex].duration;
    root.querySelector("#gif-prev").disabled = !animation || this._gifFrameIndex === 0;
    root.querySelector("#gif-next").disabled = !animation || this._gifFrameIndex === count - 1;
    root.querySelector("#gif-move-earlier").disabled = !animation || this._gifFrameIndex === 0;
    root.querySelector("#gif-move-later").disabled = !animation || this._gifFrameIndex === count - 1;
    root.querySelector("#gif-duplicate").disabled = !animation || count >= 120;
    root.querySelector("#gif-delete").disabled = !animation || count <= 1;
    this._updateEditorPlayButton();
    const strip = root.querySelector("#gif-filmstrip");
    if (animation) {
      strip.innerHTML = this._gifFrames.map((frame, index) =>
        '<button type="button" data-frame="' + index + '" class="gif-frame' +
        (index === this._gifFrameIndex ? ' active' : '') +
        '" title="Image ' + (index + 1) + ' · ' + frame.duration +
        ' ms"><canvas width="20" height="26"></canvas><span>' + (index + 1) + '</span></button>'
      ).join("");
      strip.querySelectorAll("[data-frame]").forEach((button) => {
        button.addEventListener("click", () => this._selectGifFrame(Number(button.dataset.frame)));
      });
      for (let index = 0; index < count; index++) this._drawGifThumbnail(index);
    } else {
      strip.innerHTML = "";
    }
    this._updateGifTools();
  }


  _drawGifThumbnail(index) {
    const canvas = this.shadowRoot?.querySelector('#gif-filmstrip [data-frame="' + index + '"] canvas');
    const frame = this._gifFrames[index];
    if (!canvas || !frame) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    frame.colors.forEach((color, pixel) => {
      context.fillStyle = color;
      context.fillRect(pixel % H70_WIDTH, Math.floor(pixel / H70_WIDTH), 1, 1);
    });
  }

  _updateGifTools() {
    const root = this.shadowRoot;
    if (!root) return;
    const undo = root.querySelector("#gif-undo");
    if (undo) undo.disabled = !this._gifUndo?.length;
    const eraser = root.querySelector("#gif-erase");
    if (eraser) eraser.classList.toggle("active", !!this._gifEraser);
    const save = root.querySelector("#gif-editor-save");
    if (save) save.disabled = !this._gifEditing || !this._gifFrames.length;
  }

  _undoGifEdit() {
    const entry = this._gifUndo?.pop();
    if (!entry) return;
    this._stopGif();
    this._gifFrames = entry.frames;
    this._gifFrameIndex = entry.index;
    this._markGifEdited();
    this._showGifFrame();
    this._setStatus("Dernière modification annulée");
  }

  _setGifDuration(duration) {
    if (!this._gifEditing || this._editorKind !== "animation" || !this._gifFrames[this._gifFrameIndex]) return;
    if (!Number.isFinite(duration)) return;
    const value = clamp(Math.round(duration), 100, 2000);
    if (this._gifFrames[this._gifFrameIndex].duration !== value) {
      this._stopGif();
      this._pushGifUndo();
      this._gifFrames[this._gifFrameIndex].duration = value;
      this._markGifEdited();
    }
    this._renderGifEditor();
  }

  // Shift the actual 20x26 RGB matrix: never wrap pixels across rows or edges.
  // This edits only the selected frame; newly uncovered pixels become black.
  _shiftGifPixels(deltaX) {
    if (!this._gifEditing || !this._gifFrames[this._gifFrameIndex] ||
        (deltaX !== -1 && deltaX !== 1)) return;
    const frame = this._gifFrames[this._gifFrameIndex];
    if (!Array.isArray(frame.colors) || frame.colors.length !== H70_PIXELS) return;
    const shifted = Array(H70_PIXELS).fill(BLACK);
    for (let y = 0; y < H70_HEIGHT; y += 1) {
      for (let x = 0; x < H70_WIDTH; x += 1) {
        const targetX = x + deltaX;
        if (targetX >= 0 && targetX < H70_WIDTH) {
          shifted[y * H70_WIDTH + targetX] = frame.colors[y * H70_WIDTH + x];
        }
      }
    }
    if (shifted.every((color, index) => color === frame.colors[index])) return;
    this._stopGif();
    this._pushGifUndo();
    frame.colors = shifted;
    this._markGifEdited();
    this._showGifFrame();
  }

  // Reorder a timeline frame together with its duration, keeping it selected.
  _moveGifFrame(delta) {
    if (!this._gifEditing || this._editorKind !== "animation" ||
        (delta !== -1 && delta !== 1)) return;
    const index = this._gifFrameIndex;
    const next = index + delta;
    if (next < 0 || next >= this._gifFrames.length) return;
    this._stopGif();
    this._pushGifUndo();
    [this._gifFrames[index], this._gifFrames[next]] = [this._gifFrames[next], this._gifFrames[index]];
    this._gifFrameIndex = next;
    this._markGifEdited();
    this._showGifFrame();
  }

  _duplicateGifFrame() {
    if (!this._gifEditing || this._editorKind !== "animation" || !this._gifFrames.length || this._gifFrames.length >= 120) return;
    this._stopGif();
    this._pushGifUndo();
    const frame = this._gifFrames[this._gifFrameIndex];
    this._gifFrames.splice(++this._gifFrameIndex, 0, {
      colors: [...frame.colors], duration: frame.duration,
    });
    this._markGifEdited();
    this._showGifFrame();
  }

  _deleteGifFrame() {
    if (!this._gifEditing || this._editorKind !== "animation" || this._gifFrames.length <= 1) return;
    this._stopGif();
    this._pushGifUndo();
    this._gifFrames.splice(this._gifFrameIndex, 1);
    this._gifFrameIndex = Math.min(this._gifFrameIndex, this._gifFrames.length - 1);
    this._markGifEdited();
    this._showGifFrame();
  }

  _clearGifFrame() {
    if (!this._gifEditing || !this._gifFrames[this._gifFrameIndex] ||
        this._gifFrames[this._gifFrameIndex].colors.every((color) => color === BLACK)) return;
    this._stopGif();
    this._pushGifUndo();
    this._gifFrames[this._gifFrameIndex].colors.fill(BLACK);
    this._markGifEdited();
    this._showGifFrame();
  }

  _createImage() {
    if (this._gifEdited && !window.confirm("Créer une image remplacera les modifications non enregistrées. Continuer ?")) return;
    this._stopGif();
    this._gifFile = null;
    this._gifFrames = [{ colors: Array(H70_PIXELS).fill(BLACK), duration: 150 }];
    this._editorKind = "art";
    this._gifEditing = true;
    this._gifFrameIndex = 0;
    this._gifUndo = [];
    this._gifEraser = false;
    this._gifEdited = false;
    this._nativeGifReady = false;
    this._editingGalleryId = null;
    this._editingGalleryKind = null;
    this.shadowRoot.querySelector("#gif-editor-name").value = "Nouvelle image";
    this.shadowRoot.querySelector("#gif-editor-category").value = "";
    this.shadowRoot.querySelector("#gif-info").textContent = "Nouvelle image · 20 × 26";
    this._showGifFrame();
    this._focusEditor();
    this._setStatus("Nouvelle image : dessinez, puis enregistrez ou envoyez.");
  }

  _createGif() {
    if (this._gifEdited && this._editorKind === "animation" && !window.confirm("Créer un nouveau GIF remplacera l’animation non enregistrée. Continuer ?")) return;
    this._stopGif();
    const initial = [...this._h70];
    this._gifFile = null;
    this._gifFrames = [
      { colors: [...initial], duration: 150 },
      { colors: [...initial], duration: 150 },
    ];
    this._gifEditing = true;
    this._editorKind = "animation";
    this._gifFrameIndex = 0;
    this._gifUndo = [];
    this._gifEraser = false;
    this._gifEdited = true;
    this._nativeGifReady = true;
    this._editingGalleryId = null;
    this._editingGalleryKind = null;
    this.shadowRoot.querySelector("#gif-editor-name").value = "Mon GIF";
    this.shadowRoot.querySelector("#gif-editor-category").value = "";
    this.shadowRoot.querySelector("#gif-info").textContent = "Nouveau GIF · 2 images · prêt à éditer";
    this._showGifFrame();
    this._focusEditor();
    this._setStatus("Nouveau GIF : modifiez les images, puis enregistrez ou envoyez.");
  }

  async _saveGifFromEditor() {
    if (!this._gifEditing || !this._gifFrames.length) return;
    const name = this.shadowRoot.querySelector("#gif-editor-name").value.trim();
    if (!name) return this._setStatus("Donnez un nom à la création avant de l'enregistrer", true);
    await this._saveGallery(this._editorKind === "animation" ? "animation" : "art");
  }

  _sendH70() {
    // A loaded/created GIF must use the SAME native one-shot upload as
    // "Lancer le GIF sur le rideau"; no 520-color static frame by accident.
    return this._gifEditing && this._editorKind === "animation" && this._gifFrames.length
      ? this._uploadNativeGif()
      : this._sendFrame(this._h70);
  }

  _paintH70() {
    const grid = this.shadowRoot.querySelector("#h70-grid");
    grid.innerHTML = this._h70.map((color, index) => `<button data-index="${index}" style="--pixel:${color}" title="${index % H70_WIDTH}, ${Math.floor(index / H70_WIDTH)}"></button>`).join("");
    grid.classList.toggle("gif-drawing", !!this._gifEditing);
    grid.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (this._gifEditing && this._gifFrames.length) {
        if (this._gifFrames[this._gifFrameIndex].colors[index] !== this._gifPaintColor()) {
          this._stopGif();
          this._pushGifUndo();
          this._paintGifPixel(index);
        }
        return;
      }
      this._h70[index] = this._selectedColor;
      button.style.setProperty("--pixel", this._selectedColor);
    }));
  }

  _presetH70(name) {
    this._stopGif();
    if (this._gifEditing && this._gifFrames.length) this._pushGifUndo();
    if (name === "solid") this._h70.fill(this._selectedColor);
    if (name === "rainbow") this._h70 = this._h70.map((_, index) => hsvToHex((index % H70_WIDTH) / H70_WIDTH));
    if (name === "gradient") this._h70 = this._h70.map((_, index) => hsvToHex((index % H70_WIDTH) / H70_WIDTH, 1, 0.25 + 0.75 * (Math.floor(index / H70_WIDTH) / (H70_HEIGHT - 1))));
    if (name === "sparkle") this._h70 = this._h70.map(() => Math.random() > 0.84 ? this._selectedColor : BLACK);
    if (this._gifEditing && this._gifFrames[this._gifFrameIndex]) {
      this._gifFrames[this._gifFrameIndex].colors = [...this._h70];
      this._markGifEdited();
      this._drawGifThumbnail(this._gifFrameIndex);
    }
    this._paintH70();
  }

  _transportEntity(configuredEntityId) {
    const states = this._hass?.states || {};
    const configured = states[configuredEntityId];
    if (configured?.attributes?.model === "H70B3" && configured?.attributes?.config_entry_id) {
      return configured;
    }
    // The HA entity registry may retain old/custom IDs after an integration
    // update. Find the correct transport by its stable attributes instead.
    return Object.entries(states).find(([id, state]) =>
      id.startsWith("sensor.") &&
      state.attributes?.model === "H70B3" &&
      state.attributes?.config_entry_id &&
      state.attributes?.runtime
    )?.[1] || null;
  }

  _entryId(entityId) {
    return this._transportEntity(entityId)?.attributes?.config_entry_id || null;
  }

  async _sendFrame(colors, quiet = false) {
    const entryId = this._entryId(this.config.h70b3_transport_entity);
    if (!entryId) return this._setStatus(`Identifiant de configuration introuvable pour ${this.config.h70b3_transport_entity}`, true);
    try {
      await this._hass.callService("govee_led_control", "set_frame", {
        config_entry_id: entryId,
        colors,
        brightness_percent: this._brightness,
        hold_ble: quiet, // GIF image-by-image playback only; static artwork releases BLE.
        commit: true,
      });
      if (!quiet) this._setStatus("Image envoyée");
      return true;
    } catch (error) {
      this._setStatus(error?.message || "Échec de l’envoi", true);
      this._stopGif();
      return false;
    }
  }

  async _clear() {
    this._stopGif();
    const entryId = this._entryId(this.config.h70b3_transport_entity);
    if (!entryId) return this._setStatus("Identifiant H70B3 introuvable", true);
    try {
      await this._hass.callService("govee_led_control", "clear", {
        config_entry_id: entryId, commit: true,
      });
      if (this._gifEditing && this._gifFrames[this._gifFrameIndex]) {
        this._pushGifUndo();
        this._gifFrames[this._gifFrameIndex].colors.fill(BLACK);
        this._markGifEdited();
        this._showGifFrame();
      } else {
        this._h70.fill(BLACK);
        this._paintH70();
      }
      this._setStatus("LED éteintes");
    } catch (error) {
      this._setStatus(error?.message || "Échec de l’extinction", true);
    }
  }


  async _loadMedia(file, skipConfirmation = false) {
    if (!file) return;
    if (!skipConfirmation && this._gifEdited && !window.confirm("Importer un fichier remplacera les modifications non enregistrées. Continuer ?")) return;
    if (file.size > 10 * 1024 * 1024) return this._setStatus("Le fichier dépasse 10 Mo", true);
    const isGif = file.type === "image/gif" || /\.gif$/i.test(file.name);
    const allowed = /^(image\/(gif|png|jpeg|webp|bmp))$/.test(file.type) ||
      /\.(gif|png|jpe?g|webp|bmp)$/i.test(file.name);
    if (!allowed) return this._setStatus("Format non reconnu. Importez un PNG, JPEG, WebP, BMP ou GIF.", true);
    if (isGif && !("ImageDecoder" in window)) return this._setStatus("Pour les GIF, utilisez Chrome, Edge ou l’application Home Assistant.", true);
    if (!isGif && !("createImageBitmap" in window)) return this._setStatus("Le navigateur ne peut pas décoder cette image.", true);
    const info = this.shadowRoot.querySelector("#gif-info");
    info.textContent = "Import du fichier…";
    this._setStatus("Conversion en matrice 20 × 26…");
    try {
      const frames = [];
      if (isGif) {
        const data = await file.arrayBuffer();
        const decoder = new ImageDecoder({ data, type: "image/gif" });
        try {
          await decoder.tracks.ready;
          const count = Math.min(decoder.tracks.selectedTrack.frameCount, 120);
          for (let index = 0; index < count; index += 1) {
            const result = await decoder.decode({ frameIndex: index, completeFramesOnly: true });
            try {
              frames.push({
                colors: this._frameToColors(result.image),
                duration: clamp((result.image.duration || 100000) / 1000, 100, 2000),
              });
            } finally {
              result.image.close();
            }
            if (index % 10 === 0) info.textContent = "Conversion du GIF… " + (index + 1) + "/" + count;
          }
        } finally {
          decoder.close();
        }
      } else {
        const bitmap = await createImageBitmap(file);
        try {
          frames.push({ colors: this._frameToColors(bitmap), duration: 150 });
        } finally {
          bitmap.close();
        }
      }
      if (!frames.length) throw new Error("Le fichier ne contient aucune image.");
      this._stopGif();
      this._gifFile = file;
      this._gifFrames = frames;
      this._editorKind = isGif ? "animation" : "art";
      this._gifEditing = true;
      this._gifFrameIndex = 0;
      this._gifUndo = [];
      this._gifEraser = false;
      this._gifEdited = false;
      this._editingGalleryId = null;
      this._editingGalleryKind = null;
      this._nativeGifReady = isGif;
      this.shadowRoot.querySelector("#gif-editor-name").value = file.name.replace(/\.[^.]+$/, "").slice(0, 64);
      this.shadowRoot.querySelector("#gif-editor-category").value = "";
      this._showGifFrame();
      this._focusEditor();
      const name = isGif ? "GIF" : "Image";
      info.textContent = name + " · " + file.name + (isGif ? " · " + frames.length + " images" : "") + " · prêt à éditer";
      this._setStatus(name + " importé : modifiez-le, puis enregistrez ou envoyez.");
    } catch (error) {
      info.textContent = "Échec de l'import du fichier.";
      this._setStatus(error?.message || "Impossible de lire le fichier.", true);
    }
  }


  _frameToColors(frame) {
    const canvas = document.createElement("canvas");
    canvas.width = H70_WIDTH;
    canvas.height = H70_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = BLACK;
    context.fillRect(0, 0, H70_WIDTH, H70_HEIGHT);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const sourceWidth = frame.displayWidth || frame.width;
    const sourceHeight = frame.displayHeight || frame.height;
    if (this._fit === "stretch") {
      context.drawImage(frame, 0, 0, H70_WIDTH, H70_HEIGHT);
    } else {
      const scale = this._fit === "cover"
        ? Math.max(H70_WIDTH / sourceWidth, H70_HEIGHT / sourceHeight)
        : Math.min(H70_WIDTH / sourceWidth, H70_HEIGHT / sourceHeight);
      const width = sourceWidth * scale;
      const height = sourceHeight * scale;
      context.drawImage(frame, (H70_WIDTH - width) / 2, (H70_HEIGHT - height) / 2, width, height);
    }
    const pixels = context.getImageData(0, 0, H70_WIDTH, H70_HEIGHT).data;
    const colors = [];
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] / 255;
      colors.push(rgbToHex(Math.round(pixels[index] * alpha), Math.round(pixels[index + 1] * alpha), Math.round(pixels[index + 2] * alpha)));
    }
    return colors;
  }

  async _uploadNativeGif() {
    if (this._editorKind !== "animation" || !this._nativeGifReady || !this._gifFrames.length) {
      return this._setStatus("Chargez ou créez un GIF avant de l'envoyer", true);
    }
    const entryId = this._entryId(this.config.h70b3_transport_entity);
    if (!entryId) return this._setStatus("Identifiant H70B3 introuvable", true);
    // Stop every local streaming loop before sending the native file.
    this._stopGif(false);
    const inflight = this._pendingGifSend;
    if (inflight) await inflight.catch(() => {});
    const button = this.shadowRoot.querySelector("#h70-apply");
    const buttonLabel = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "⏳ Envoi du GIF…";
    }
    this._setStatus("Envoi du GIF sur le rideau…");
    try {
      await this._hass.callService("govee_led_control", "release_bluetooth", {
        config_entry_id: entryId,
      });
      // Re-encode the frames already scaled by LED Studio to the physical
      // curtain resolution, regardless of the source GIF's dimensions.
      const bytes = encodeNativeGifFrames(this._gifFrames);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x4000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x4000));
      }
      await this._hass.callService("govee_led_control", "upload_native_gif", {
        config_entry_id: entryId,
        gif_base64: btoa(binary),
      });
      this._setStatus("GIF lancé sur le rideau · Lecture autonome · Bluetooth libéré");
    } catch (error) {
      this._setStatus(error?.message || "Échec du transfert GIF natif", true);
    } finally {
      if (button) {
        button.textContent = buttonLabel;
        button.disabled = false;
      }
    }
  }

  _stopGif(releaseBle = true) {
    this._stopEditorPreview();
    const wasPlaying = this._playing;
    this._playing = false;
    this._playGeneration = (this._playGeneration || 0) + 1;
    if (wasPlaying && releaseBle) {
      const entryId = this._entryId(this.config.h70b3_transport_entity);
      const hass = this._hass;
      if (entryId && hass) {
        // Wait for a frame already submitted to HA before releasing BLE.
        Promise.resolve(this._pendingGifSend).catch(() => {}).then(() =>
          hass.callService("govee_led_control", "release_bluetooth", {
            config_entry_id: entryId,
          })
        ).catch((error) => this._setStatus(error?.message || "Échec de la libération Bluetooth", true));
      }
    }
  }

  async _loadGallery(force = false) {
    if (!this._hass?.callWS || (this._galleryLoaded && !force)) return;
    this._galleryLoading = true;
    try {
      const result = await this._hass.callWS({ type: "govee_led_control/gallery/list" });
      this._galleryItems = Array.isArray(result?.items) ? result.items : [];
      this._galleryCategories = Array.isArray(result?.categories)
        ? result.categories
        : this._galleryItems.map((item) => item.category).filter((value) => typeof value === "string" && value.trim());
      this._updateCategorySuggestions();
      this._renderCategoryManager();
      this._galleryLoaded = true;
      this._renderGallery();
    } catch (error) {
      const list = this.shadowRoot?.querySelector("#gallery-list");
      if (list) list.innerHTML = "<p>La galerie sera disponible après mise à jour et redémarrage de Home Assistant.</p>";
      this._setStatus(error?.message || "Échec du chargement de la galerie", true);
    } finally {
      this._galleryLoading = false;
    }
  }

  _updateCategorySuggestions() {
    const datalist = this.shadowRoot?.querySelector("#govee-category-list");
    if (!datalist) return;
    const unique = new Map();
    for (const name of [...this._galleryCategories, ...this._galleryItems.map((item) => item.category)]) {
      const category = typeof name === "string" ? name.trim() : "";
      if (category && !unique.has(category.toLocaleLowerCase("fr"))) {
        unique.set(category.toLocaleLowerCase("fr"), category);
      }
    }
    datalist.innerHTML = [...unique.values()]
      .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true }))
      .map((name) => '<option value="' + escapeHtml(name) + '"></option>')
      .join("");
  }

  _renderCategoryManager() {
    const select = this.shadowRoot?.querySelector("#manage-category");
    if (!select) return;
    const previouslySelected = select.value;
    const categories = [...this._galleryCategories]
      .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true }));
    select.innerHTML = '<option value="">Choisir une catégorie</option>' +
      categories.map((name) => '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>').join("");
    select.value = categories.includes(previouslySelected) ? previouslySelected : "";
  }

  async _manageCategory(action) {
    if (!this._hass?.callWS) return;
    const select = this.shadowRoot.querySelector("#manage-category");
    const name = action === "create" ? "" : select.value;
    if (action !== "create" && !name) {
      return this._setStatus("Choisissez d'abord une catégorie.", true);
    }
    let newName;
    if (action === "create" || action === "rename") {
      const answer = window.prompt(
        action === "create" ? "Nom de la nouvelle catégorie :" : "Nouveau nom de la catégorie :",
        action === "rename" ? name : ""
      );
      if (answer === null) return;
      newName = answer.trim();
      if (!newName || newName.length > 40 || /[\x00-\x1f]/.test(newName)) {
        return this._setStatus("Indiquez un nom valide (40 caractères maximum, une ligne).", true);
      }
    } else {
      const count = this._galleryItems.filter((item) =>
        typeof item.category === "string" && item.category.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr")
      ).length;
      if (!window.confirm('Supprimer la catégorie « ' + name + ' » ? ' +
        count + ' création(s) passeront dans « Non classé » sans être supprimées.')) return;
    }
    const body = { type: "govee_led_control/gallery/category/manage", action, name: action === "create" ? newName : name };
    if (action === "rename") body.new_name = newName;
    try {
      await this._hass.callWS(body);
      const editor = this.shadowRoot.querySelector("#gif-editor-category");
      if (action !== "create" && editor.value.trim().toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr")) {
        editor.value = action === "rename" ? newName : "";
      }
      await this._loadGallery(true);
      select.value = action === "delete" ? "" : newName;
      this._setStatus(action === "delete" ? "Catégorie supprimée · Images et GIF conservés" :
        action === "rename" ? "Catégorie renommée dans toute la galerie" : "Catégorie créée");
    } catch (error) {
      this._setStatus(error?.message || "Impossible de modifier la catégorie.", true);
    }
  }

  async _saveGallery(kind) {
    const input = this.shadowRoot.querySelector("#gif-editor-name");
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return this._setStatus("Donnez d’abord un nom à votre création", true);
    }
    if (kind === "animation" && (this._editorKind !== "animation" || !this._gifFrames.length)) {
      return this._setStatus("Chargez ou créez un GIF pour l'enregistrer", true);
    }

    const categoryInput = this.shadowRoot.querySelector("#gif-editor-category");
    const rawCategory = categoryInput.value.trim();
    if (rawCategory.length > 40) {
      return this._setStatus("La catégorie ne doit pas dépasser 40 caractères.", true);
    }
    const existingCategory = [...(this._galleryCategories || []), ...(this._galleryItems || [])
      .map((entry) => typeof entry.category === "string" ? entry.category.trim() : "")]
      .find((value) => value && value.toLocaleLowerCase("fr") === rawCategory.toLocaleLowerCase("fr"));
    const category = existingCategory || rawCategory;
    const target = "h70b3";
    const item = { name, category, kind, target, brightness: this._brightness };
    if (kind === "animation") {
      item.frames = this._gifFrames.map((frame) => ({ colors: [...frame.colors], duration: frame.duration }));
    } else {
      item.colors = [...this._h70];
    }

    this._setStatus("Enregistrement du motif…");
    try {
      // Update the selected saved artwork only when its type and target still
      // match; saving one GIF frame as a static image creates a NEW artwork.
      const savingCurrentEditor = this._gifEditing && kind === this._editorKind;
      if (savingCurrentEditor && this._editingGalleryId &&
          this._editingGalleryKind === kind) item.id = this._editingGalleryId;
      const result = await this._hass.callWS({ type: "govee_led_control/gallery/save", item });
      if (savingCurrentEditor) {
        this._editingGalleryId = result?.item?.id || this._editingGalleryId;
        this._editingGalleryKind = kind;
        this._gifEdited = false;
        this.shadowRoot.querySelector("#gif-editor-name").value = name;
      }
      await this._loadGallery(true);
      this._setStatus(kind === "animation" ? "GIF enregistré · Disponible dans LED Player" : "Image enregistrée · Disponible dans LED Player");
    } catch (error) {
      this._setStatus(error?.message || "Échec de l’enregistrement", true);
    }
  }

  _renderGallery() {
    const list = this.shadowRoot?.querySelector("#gallery-list");
    if (!list) return;
    this._stopGalleryPreviews();
    const visibleItems = this._galleryItems
      .filter((item) => item.target === "h70b3")
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr", {
        sensitivity: "base",
        numeric: true,
      }));
    if (!visibleItems.length) {
      list.innerHTML = '<p>Aucune création enregistrée. Utilisez « Enregistrer » dans l’éditeur.</p>';
      return;
    }
    list.innerHTML = visibleItems.map((item) => {
      const animated = item.kind === "animation" && item.target === "h70b3";
      const count = item.frames?.length || 0;
      const detail = animated ? "GIF animé · " + count + " images" : "Image fixe · H70B3";
      return '<article class="gallery-item">' +
        '<div class="gallery-preview">' +
          '<canvas width="20" height="26" data-gallery-preview="' +
          escapeHtml(item.id) + '" aria-label="Aperçu de ' + escapeHtml(item.name) + '"></canvas>' +
          (animated ? '<span class="gallery-gif-badge">GIF</span>' : '') +
        '</div>' +
        '<div class="gallery-meta"><strong>' + escapeHtml(item.name) + '</strong><small>' +
          detail + '</small><span class="gallery-category" title="Catégorie : ' +
          escapeHtml(item.category || "Non classé") + '">' +
          escapeHtml(item.category || "Non classé") + '</span></div>' +
        '<div class="gallery-actions">' +
          '<button type="button" data-gallery-load="' + escapeHtml(item.id) + '">Modifier</button>' +
          '<button type="button" class="danger compact" data-gallery-delete="' + escapeHtml(item.id) +
            '" aria-label="Supprimer ' + escapeHtml(item.name) + '">Supprimer</button>' +
        '</div>' +
        '</article>';
    }).join("");
    list.querySelectorAll("[data-gallery-load]").forEach((button) =>
      button.addEventListener("click", () => this._openGalleryItem(button.dataset.galleryLoad)));
    list.querySelectorAll("[data-gallery-delete]").forEach((button) =>
      button.addEventListener("click", () => this._deleteGalleryItem(button.dataset.galleryDelete)));
    this._startGalleryPreviews();
  }

  _stopGalleryPreviews() {
    if (this._galleryPreviewTimer !== undefined) {
      clearTimeout(this._galleryPreviewTimer);
      this._galleryPreviewTimer = undefined;
    }
  }

  _paintGalleryPreview(item, frameIndex = 0) {
    if (!item || !this.shadowRoot) return;
    const canvas = [...this.shadowRoot.querySelectorAll("[data-gallery-preview]")]
      .find((element) => element.dataset.galleryPreview === item.id);
    if (!canvas) return;
    const frame = item.kind === "animation" ? item.frames?.[frameIndex] : null;
    const colors = frame ? frame.colors : item.colors;
    if (!Array.isArray(colors) || !colors.length) return;
    const width = H70_WIDTH;
    const height = H70_HEIGHT;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#030408";
    context.fillRect(0, 0, width, height);
    colors.forEach((color, index) => {
      if (index >= width * height || typeof color !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(color)) return;
      context.fillStyle = color;
      context.fillRect(index % width, Math.floor(index / width), 1, 1);
    });
  }

  _startGalleryPreviews() {
    this._stopGalleryPreviews();
    if (!this.shadowRoot || !this._galleryItems?.length) return;
    const now = Date.now();
    this._galleryPreviewState = new Map();
    let hasAnimations = false;
    for (const item of this._galleryItems) {
      this._paintGalleryPreview(item, 0);
      if (item.kind === "animation" && Array.isArray(item.frames) && item.frames.length > 1) {
        hasAnimations = true;
        this._galleryPreviewState.set(item.id, {
          index: 0,
          due: now + clamp(Number(item.frames[0].duration) || 100, 100, 2000),
        });
      }
    }
    if (hasAnimations && this.isConnected && !document.hidden) {
      this._galleryPreviewTimer = setTimeout(() => this._tickGalleryPreviews(), 80);
    }
  }

  _tickGalleryPreviews() {
    this._galleryPreviewTimer = undefined;
    if (!this.isConnected || document.hidden) return;
    const now = Date.now();
    let nextDelay = 2000;
    for (const item of this._galleryItems) {
      const state = this._galleryPreviewState?.get(item.id);
      if (!state) continue;
      if (state.due <= now) {
        state.index = (state.index + 1) % item.frames.length;
        this._paintGalleryPreview(item, state.index);
        state.due = now + clamp(Number(item.frames[state.index].duration) || 100, 100, 2000);
      }
      nextDelay = Math.min(nextDelay, Math.max(25, state.due - now));
    }
    if (this._galleryPreviewState?.size) {
      this._galleryPreviewTimer = setTimeout(() => this._tickGalleryPreviews(), nextDelay);
    }
  }


  _openGalleryItem(itemId) {
    const item = this._galleryItems.find((candidate) => candidate.id === itemId);
    if (!item || item.target !== "h70b3") return;
    if (this._gifEdited && !window.confirm("Charger cette création remplacera les modifications non enregistrées. Continuer ?")) return;
    this._stopGif();
    this._gifFile = null;
    this._gifFrameIndex = 0;
    this._gifUndo = [];
    this._gifEraser = false;
    this._gifEdited = false;
    this._editingGalleryId = null;
    this._editingGalleryKind = null;
    this._nativeGifReady = false;
    this.shadowRoot.querySelector("#gif-editor-name").value = item.name;
    this.shadowRoot.querySelector("#gif-editor-category").value = item.category || "";
    this._brightness = clamp(Number(item.brightness) || 100, 1, 100);
    this.shadowRoot.querySelector("#brightness").value = this._brightness;
    this.shadowRoot.querySelector("#brightness-value").textContent = this._brightness + "%";
    this._editorKind = item.kind === "animation" ? "animation" : "art";
    this._gifFrames = item.kind === "animation"
      ? item.frames.map((frame) => ({ colors: [...frame.colors], duration: frame.duration }))
      : [{ colors: [...item.colors], duration: 150 }];
    this._gifEditing = true;
    this._nativeGifReady = this._editorKind === "animation";
    this._editingGalleryId = item.id;
    this._editingGalleryKind = item.kind;
    this.shadowRoot.querySelector("#gif-info").textContent =
      item.name + (this._editorKind === "animation" ? " · " + this._gifFrames.length + " images" : " · Image fixe") + " · prêt à modifier";
    this._showGifFrame();
    this._focusEditor();
    this._setStatus(item.name + " chargé dans l’éditeur");
  }

  async _deleteGalleryItem(itemId) {
    const item = this._galleryItems.find((candidate) => candidate.id === itemId);
    if (!item || !window.confirm(`Supprimer définitivement « ${item.name} » de la galerie ?`)) return;
    try {
      await this._hass.callWS({ type: "govee_led_control/gallery/delete", item_id: itemId });
      await this._loadGallery(true);
      this._setStatus("Motif supprimé");
    } catch (error) {
      this._setStatus(error?.message || "Échec de la suppression", true);
    }
  }

  _setStatus(message, error = false) {
    const status = this.shadowRoot.querySelector("#status");
    status.classList.toggle("error", error);
    status.lastChild.textContent = message;
  }

  _styles() {
    return `
      :host { --accent:#7857ff; --accent2:#21d4fd; display:block; min-width:0; }
      ha-card { container-type:inline-size; width:100%; min-width:0; box-sizing:border-box; overflow:hidden; padding:0; background:linear-gradient(145deg, rgba(20,22,31,.98), rgba(9,10,16,.98)); color:#f7f7fb; border:1px solid rgba(255,255,255,.09); }
      header { padding:24px 26px 18px; display:flex; justify-content:space-between; gap:20px; align-items:flex-start; background:radial-gradient(circle at 82% -20%, rgba(120,87,255,.3), transparent 45%); }
      h1,h2,p { margin:0; } h1 { font-size:30px; letter-spacing:-.04em; } h2 { font-size:18px; margin-bottom:10px; } p { color:#a9adbd; margin-top:5px; }
      .eyebrow { color:#8e7aff; font-size:11px; font-weight:800; letter-spacing:.16em; margin-bottom:5px; }
      .status { display:flex; gap:8px; align-items:center; color:#c7cad6; font-size:12px; padding:8px 12px; background:rgba(255,255,255,.06); border-radius:999px; max-width:45%; }
      .status span { width:8px; height:8px; border-radius:50%; background:#33df95; box-shadow:0 0 12px #33df95; flex:none; } .status.error span { background:#ff5364; box-shadow:0 0 12px #ff5364; }
      .device-label { padding:9px 26px; border-bottom:1px solid rgba(255,255,255,.08); color:#b3a5ff; font-size:12px; font-weight:700; }
      .studio-columns { display:block; min-width:0; }
      .studio-workspace { min-width:0; }
      button,select,input { font:inherit; } button { min-width:0; border:0; cursor:pointer; color:#e8e9ef; background:rgba(255,255,255,.07); border-radius:10px; padding:10px 13px; transition:.15s ease; overflow-wrap:anywhere; } button:hover { background:rgba(255,255,255,.13); transform:translateY(-1px); } button:disabled { opacity:.38; cursor:not-allowed; transform:none; }
      .toolbar { display:grid; grid-template-columns:auto 1fr minmax(180px,280px); gap:18px; align-items:center; padding:18px 26px; background:rgba(255,255,255,.025); }
      .toolbar[hidden], .stage[hidden] { display:none !important; }
      label { color:#aeb2c0; font-size:12px; } .color-control { display:flex; align-items:center; gap:9px; } input[type=color] { width:42px; height:34px; padding:0; border:0; background:none; }
      .palette { display:flex; flex-wrap:wrap; gap:7px; } .swatch { width:25px; height:25px; border-radius:50%; padding:0; background:var(--swatch); border:2px solid rgba(255,255,255,.22); }
      .range-control { display:grid; grid-template-columns:1fr auto; gap:5px 10px; } .range-control input { grid-column:1/-1; accent-color:var(--accent); }
      .view { padding:24px 26px 28px; }
      .view:not(.editor-active) { padding-top:0; }
      .view:not(.editor-active) .gif-panel { margin-top:18px; }
      .stage { display:grid; grid-template-columns:minmax(280px,1fr) minmax(190px,260px); gap:24px; align-items:start; } .stage > *,.gif-panel > * { min-width:0; }
      .matrix-editor-area { min-width:0; display:grid; gap:14px; }
      .gif-editor[hidden] { display:none !important; }
      .gif-animation-only[hidden] { display:none !important; }
      .gif-editor.is-still .gif-animation-only { display:none !important; }
      .gif-editor { background:rgba(120,87,255,.075); border:1px solid rgba(148,122,255,.26); border-radius:14px; padding:13px; display:grid; gap:11px; }
      .gif-editor-head { display:flex; justify-content:space-between; gap:8px; font-size:13px; align-items:center; }
      .gif-editor-head strong { color:#f4f0ff; }
      .gif-editor-head span { color:#b3a5ff; font-variant-numeric:tabular-nums; font-size:12px; }
      .gif-editor-toolbar { display:flex; flex-wrap:wrap; gap:7px; align-items:center; }
      .gif-editor-toolbar button,.gif-editor-actions button,.gif-pixel-shift button { padding:7px 10px; font-size:12px; }
      .gif-pixel-shift { display:flex; flex-wrap:wrap; align-items:center; gap:7px; }
      .gif-pixel-shift span { font-size:12px; color:#b3a5ff; }
      .gif-pixel-shift button { min-width:38px; background:rgba(120,87,255,.19); border:1px solid rgba(148,122,255,.34); }
      .gif-editor-toolbar label { display:flex; align-items:center; gap:5px; }
      .gif-editor-toolbar input[type=number] { box-sizing:border-box; width:64px; border:1px solid rgba(255,255,255,.2); color:white; background:#212536; padding:6px; border-radius:7px; }
      .gif-editor-toolbar button.active { background:#5f4dca; color:white; }
      .gif-editor-toolbar .gif-preview-play { background:rgba(120,87,255,.27); border:1px solid rgba(161,137,255,.55); min-width:83px; font-weight:700; }
      .gif-editor-toolbar .gif-preview-play.active { background:#7857ff; color:white; }
      #gif-frame-range { width:100%; accent-color:var(--accent); }
      .gif-filmstrip { display:flex; gap:6px; min-width:0; overflow-x:auto; padding:2px 0 7px; }
      .gif-frame { display:grid; flex:none; gap:2px; place-items:center; padding:5px; border-radius:8px; background:#111420; border:1px solid rgba(255,255,255,.08); }
      .gif-frame canvas { width:30px; height:39px; background:black; image-rendering:pixelated; }
      .gif-frame span { font-size:10px; color:#a0a8b6; }
      .gif-frame.active { border-color:#8c77ff; background:rgba(126,99,255,.26); }
      .gif-editor-actions { display:flex; flex-wrap:wrap; gap:6px; }
      .gif-clear-still { justify-self:start; font-size:12px; padding:7px 12px; }
      .gif-editor:not(.is-still) .gif-clear-still { display:none; }
      .gif-editor-save { display:grid; grid-template-columns:minmax(100px,1fr) auto; gap:7px; }
      .gif-editor-save input { min-width:0; width:100%; box-sizing:border-box; border:1px solid rgba(255,255,255,.14); background:#222532; color:white; border-radius:8px; padding:9px; }
      .gif-editor-save #gif-editor-name { grid-column:1/-1; }
      .gif-editor-save .category-editor-label { display:grid; min-width:0; gap:5px; color:#b8c0d4; font-size:12px; }
      .gif-editor-save #gif-editor-save { align-self:end; min-height:38px; }
      .gif-editor-save .primary { margin:0; width:auto; font-size:12px; }
      .gif-editor small { color:#a0a8b6; font-size:11px; line-height:1.45; }
      .matrix-shell { width:min(100%,420px); box-sizing:border-box; margin:auto; padding:12px; border-radius:15px; background:#030408; box-shadow:inset 0 0 30px rgba(0,0,0,.8), 0 20px 50px rgba(0,0,0,.22); }
      .matrix { display:grid; grid-template-columns:repeat(20,1fr); gap:3px; aspect-ratio:20/26; }
      .matrix.gif-drawing { touch-action:none; } .matrix button { min-width:0; padding:0; border-radius:3px; background:var(--pixel); box-shadow:0 0 5px color-mix(in srgb, var(--pixel) 70%, transparent); }
      .side-panel,.gif-panel { padding:18px; border:1px solid rgba(255,255,255,.08); border-radius:15px; background:rgba(255,255,255,.035); }
      .button-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-bottom:15px; } .primary { width:100%; background:linear-gradient(135deg,var(--accent),#5b8cff); font-weight:700; margin-top:7px; } .danger { width:100%; color:#ff8994; margin-top:8px; }
      .gif-panel { margin-top:24px; display:grid; grid-template-columns:1fr minmax(180px,260px); gap:18px 24px; align-items:center; }
      .upload { min-height:115px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; border:1px dashed rgba(255,255,255,.25); border-radius:12px; cursor:pointer; background:rgba(120,87,255,.06); } .upload:hover { border-color:var(--accent); } .upload input { display:none; } .upload-icon { font-size:30px; color:#9b86ff; } .upload small { color:#767c8f; }
      .gif-new-action { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:7px; align-content:center; }
      .gif-new-action small { grid-column:1/-1; }
      .gif-new-action button { background:rgba(120,87,255,.18); border:1px solid rgba(140,110,255,.45); font-weight:700; }
      .gif-new-action small { font-size:11px; color:#9ea8bb; }
      .gif-controls { grid-column:1/-1; display:grid; grid-template-columns:minmax(130px,260px); gap:10px; align-items:center; }
      .gif-controls label { display:grid; gap:7px; }
      .gif-controls select { width:100%; }
      select { color:#e8e9ef; background:#222532; border:0; border-radius:8px; padding:9px; }
      .gif-info[hidden] { display:none; }

      .gallery-panel { border-top:1px solid rgba(255,255,255,.08); padding:24px 26px 28px; background:rgba(255,255,255,.018); }
      .gallery-heading { display:flex; justify-content:space-between; gap:14px; align-items:end; }
      .category-manager { margin-top:18px; padding:14px; border:1px solid rgba(148,122,255,.26); background:rgba(120,87,255,.055); border-radius:12px; display:grid; gap:10px; }
      .category-manager-head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
      .category-manager-head strong { font-size:13px; } .category-manager small { color:#9da7bc; font-size:11px; }
      .category-manager-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
      .category-manager-actions select { flex:1 1 170px; min-width:0; }
      .category-manager-actions button { padding:9px 11px; font-size:12px; }
      #category-delete { color:#ff8994; }
      /* Compact two-column library cards, including on medium-width HA dashboards. */
      .gallery-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:18px; }
      .gallery-list > p { grid-column:1/-1; color:#9297a8; font-size:13px; }
      .gallery-item { display:grid; grid-template-columns:56px minmax(0,1fr); grid-template-rows:1fr auto; gap:9px; min-width:0; align-items:center; padding:10px; border:1px solid rgba(255,255,255,.09); border-radius:13px; background:rgba(255,255,255,.035); }
      .gallery-preview { position:relative; display:flex; width:56px; height:80px; box-sizing:border-box; align-items:center; justify-content:center; padding:4px; overflow:hidden; border-radius:9px; background:#030408; }
      .gallery-preview canvas { display:block; width:100%; max-width:48px; height:auto; max-height:100%; object-fit:contain; image-rendering:pixelated; }
      .gallery-gif-badge { position:absolute; bottom:3px; right:3px; padding:2px 4px; font-size:9px; font-weight:700; border-radius:4px; background:rgba(90,68,207,.88); color:white; }
      .gallery-meta { display:grid; align-content:center; justify-items:start; gap:5px; min-width:0; }
      .gallery-meta strong { max-width:100%; overflow-wrap:anywhere; font-size:12px; line-height:1.3; }
      .gallery-meta small { color:#9da7bc; font-size:10px; line-height:1.4; }
      .gallery-category { display:inline-block; max-width:100%; box-sizing:border-box; overflow-wrap:anywhere; border-radius:6px; padding:4px 6px; color:#d8cafa; background:rgba(120,87,255,.18); border:1px solid rgba(148,122,255,.32); font-size:10px; line-height:1.25; }
      .gallery-actions { grid-column:1/-1; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:stretch; gap:7px; }
      .gallery-actions button { width:100%; min-width:0; min-height:34px; padding:7px 5px; white-space:nowrap; font-size:11px; }
      .danger.compact { margin:0; width:100%; }

      /* At desktop card widths, the editor stays on the left and the library
         stays on the right; smaller Lovelace columns keep the stacked view. */
      @container (min-width:940px) {
        .studio-columns { display:grid; grid-template-columns:minmax(0,1.08fr) minmax(0,1fr); align-items:start; }
        .studio-workspace { min-width:0; }
        .gallery-panel { border-top:0; border-left:1px solid rgba(255,255,255,.08); padding:22px 18px 28px; }
        .toolbar { grid-template-columns:auto minmax(0,1fr); gap:12px; padding:16px 18px; }
        .toolbar .range-control { grid-column:1/-1; }
        .view { padding:20px 18px 28px; }
        .view:not(.editor-active) { padding-top:0; }
        .stage { grid-template-columns:minmax(0,1fr); gap:14px; }
        .matrix-shell { max-width:360px; }
        .gif-panel { grid-template-columns:minmax(0,1fr); gap:13px; }
        .gif-panel .gif-controls { grid-template-columns:minmax(130px,260px); }
        .gallery-list { grid-template-columns:repeat(2,minmax(0,1fr)); }
      }
      @container (min-width:1580px) {
        .stage { grid-template-columns:minmax(0,1fr) minmax(190px,240px); gap:18px; }
        .matrix-shell { max-width:420px; }
      }
      @container(max-width:720px) { header { padding:20px; } .toolbar { grid-template-columns:1fr; padding:16px 20px; } .stage,.gif-panel { grid-template-columns:1fr; } .view { padding:20px; } .gif-controls { grid-template-columns:1fr; } .status { display:none; } }
      @container(max-width:420px) { .gallery-list { grid-template-columns:minmax(0,1fr); } .gallery-item { grid-template-columns:70px minmax(0,1fr); } .gallery-preview { width:70px; height:92px; } .gallery-preview canvas { max-width:58px; } }
      @container(max-width:440px) { .gif-controls,.button-grid,.gif-editor-save { grid-template-columns:1fr; } }
      @media(max-width:700px) { header { padding:20px; } .toolbar { grid-template-columns:1fr; padding:16px 20px; } .stage,.gif-panel { grid-template-columns:1fr; } .view { padding:20px; } .gif-controls { grid-template-columns:1fr; } .status { display:none; } }
    `;
  }
}

if (!customElements.get("govee-led-studio")) customElements.define("govee-led-studio", GoveeLedStudio);
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "govee-led-studio")) {
  window.customCards.push({ type: "govee-led-studio", name: "Govee LED Studio", description: "Éditeur LED H70B3, images 20×26 et GIF autonomes.", preview: true });
}
console.info(`%c Govee LED Studio %c ${CARD_VERSION} `, "color:white;background:#7857ff;font-weight:bold", "color:#7857ff;background:#eee");
