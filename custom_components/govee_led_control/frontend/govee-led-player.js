/* LED Player — independent gallery card for Home Assistant.
 * Saved artworks are fetched from the same .storage-backed gallery as LED Studio.
 * GIFs are uploaded once using the hardware-validated native service.
 * Preview timers never send anything to the physical device.
 */
const PLAYER_WIDTH = 20;
const PLAYER_HEIGHT = 26;
const PLAYER_PIXELS = PLAYER_WIDTH * PLAYER_HEIGHT;
const playerClamp = (value, min, max) => Math.max(min, Math.min(max, value));

function playerEscape(value) {
  return String(value).replace(/[&<>'"]/g, (c) =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])
  );
}

function playerColors(item) {
  return item && item.kind === "animation"
    ? item.frames && item.frames[0] && item.frames[0].colors
    : item && item.colors;
}

function encodePlayerGifFrames(frames, brightness = 100) {
  if (!frames.length || frames.length > 120) throw new Error("Nombre d'images GIF invalide");
  const bytes = [];
  const put = (...items) => bytes.push(...items);
  const word = (value) => put(value & 255, (value >>> 8) & 255);
  for (const ch of "GIF89a") put(ch.charCodeAt(0));
  word(PLAYER_WIDTH); word(PLAYER_HEIGHT);
  put(0xf7, 0, 0); // Global 256-color RGB332 palette.
  // The H70B3 GIF protocol has no brightness argument: scale the global
  // palette before the single native upload (never stream frames over BLE).
  const intensity = playerClamp(Number(brightness) || 100, 1, 100) / 100;
  for (let i = 0; i < 256; i += 1) {
    put(Math.round(((i >>> 5) & 7) * 255 / 7 * intensity),
      Math.round(((i >>> 2) & 7) * 255 / 7 * intensity),
      Math.round((i & 3) * 255 / 3 * intensity));
  }
  put(0x21, 0xff, 11);
  for (const ch of "NETSCAPE2.0") put(ch.charCodeAt(0));
  put(3, 1, 0, 0, 0); // Infinite repeat.
  for (const frame of frames) {
    if (!Array.isArray(frame.colors) || frame.colors.length !== PLAYER_PIXELS) {
      throw new Error("La trame GIF n'a pas 520 pixels");
    }
    const delay = playerClamp(Math.round(frame.duration / 10), 2, 65535);
    put(0x21, 0xf9, 4, 0, delay & 255, delay >>> 8, 0, 0);
    put(0x2c);
    word(0); word(0); word(PLAYER_WIDTH); word(PLAYER_HEIGHT); put(0);
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


class GoveeLedPlayer extends HTMLElement {
  static getStubConfig() {
    return {
      title: "LED Player",
      // Optional fallback if automatic local discovery does not work.
      // No external Govee integration or additional light entity is needed.
      lan_ip: "",
      h70b3_transport_entity: "sensor.h70b3_transport",
      h6069_transport_entity: "sensor.h6069_transport",
    };
  }

  setConfig(config) {
    this.config = { ...GoveeLedPlayer.getStubConfig(), ...config };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._items ||= [];
    this._selectedId ||= null;
    this._filter ||= "all";
    this._status ||= "Choisissez une création enregistrée dans LED Studio.";
    this._error ||= false;
    this._busy ||= false;
    this._loading ||= false;
    this._powerBusy ||= false;
    this._powerLoading ||= false;
    this._powerOn ??= null;
    this._nextPowerCheck ||= 0;
    this._previewFrame ||= 0;
    this._brightness ??= 100;
    this._brightnessLoaded ??= false;
    this._brightnessLoading ??= false;
    this._brightnessTouched ??= false;
    this._render();
    if (this.isConnected && this._hass) this._loadGallery();
  }

  set hass(value) {
    const initial = !this._hass;
    this._hass = value;
    if (initial && this.isConnected) this._loadGallery();
    if (this.isConnected) void this._loadBrightness();
    this._renderPowerButton();
    if (this.isConnected && (initial || Date.now() >= this._nextPowerCheck)) {
      this._nextPowerCheck = Date.now() + 15000;
      void this._refreshPower();
    }
  }

  connectedCallback() {
    if (this._hass) {
      this._loadGallery();
      void this._loadBrightness();
      void this._refreshPower();
    }
    this._onPageHidden ||= () => {
      if (document.hidden) this._clearPreviewTimer();
      else {
        this._drawPreview();
        void this._refreshPower();
      }
    };
    document.addEventListener("visibilitychange", this._onPageHidden);
  }

  disconnectedCallback() {
    this._clearPreviewTimer();
    document.removeEventListener("visibilitychange", this._onPageHidden);
  }

  getCardSize() { return 6; }
  getGridOptions() { return { columns: "full", min_columns: 4 }; }

  _render() {
    if (!this.shadowRoot || !this.config) return;
    const css = [
      ":host { display:block; min-width:0; --purple:#866cff; color:#f5f4ff; }",
      "ha-card { display:block; container-type:inline-size; box-sizing:border-box; padding:20px; min-width:0; background:linear-gradient(140deg,#171925,#0b0c13); color:#f5f4ff; border:1px solid rgba(255,255,255,.1); }",
      "* { box-sizing:border-box; } button { font:inherit; border:0; cursor:pointer; } button:disabled { opacity:.42; cursor:default; }",
      ".head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }",
      ".eyebrow { color:#a998ff; font-weight:700; font-size:10px; letter-spacing:.14em; text-transform:uppercase; }",
      "h2,h3,p { margin:0; } h2 { font-size:23px; letter-spacing:-.035em; margin-top:3px; } h3 { font-size:17px; margin-bottom:4px; }",
      ".muted { color:#9aa2b9; font-size:12px; } .head-actions { display:flex; align-items:center; justify-content:flex-end; flex:none; } .refresh,.power { background:rgba(255,255,255,.08); color:#f3f0ff; border-radius:9px; white-space:nowrap; } .refresh { padding:8px 12px; font-size:12px; min-height:34px; } .power { min-height:58px; padding:14px 18px; font-size:14px; font-weight:700; border:1px solid rgba(255,255,255,.12); } .power.is-on { border-color:rgba(64,205,139,.65); color:#8af6c0; background:rgba(20,137,78,.15); } .power.is-off { border-color:rgba(255,255,255,.16); } .power:not(:disabled):hover { filter:brightness(1.16); }",
      ".layout { display:flex; flex-direction:column; gap:16px; min-width:0; } .gallery { min-width:0; } .filter-bar { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px; }",
      ".filters { display:flex; gap:6px; flex-wrap:wrap; min-width:0; }",
      ".filter { border-radius:8px; background:rgba(255,255,255,.055); color:#acb3c8; padding:8px 11px; font-size:12px; }",
      ".filter.active { color:#fff; background:rgba(134,108,255,.24); box-shadow:inset 0 0 0 1px rgba(134,108,255,.55); }",
      ".items { max-height:520px; overflow-y:auto; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; padding-right:2px; align-content:start; }",
      ".item { width:100%; min-width:0; min-height:136px; display:flex; flex-direction:column; gap:8px; align-items:center; justify-content:center; text-align:center; border-radius:11px; padding:10px 7px; background:rgba(255,255,255,.04); color:#e7e9f6; border:1px solid transparent; }",
      ".item.active { background:rgba(134,108,255,.15); border-color:rgba(134,108,255,.55); }",
      ".item:hover { background:rgba(255,255,255,.09); }",
      ".thumb { width:48px; height:62px; flex:none; border-radius:7px; background:#05060b; image-rendering:pixelated; object-fit:contain; }",
      ".item-meta { min-width:0; max-width:100%; display:grid; gap:3px; } .item-meta strong { font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      ".item-meta small { color:#8e99b1; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      ".detail { border:1px solid rgba(255,255,255,.085); background:rgba(255,255,255,.035); padding:17px; border-radius:14px; min-height:290px; }",
      ".preview-wrap { background:#030408; border-radius:13px; min-height:215px; display:flex; align-items:center; justify-content:center; padding:13px; margin:12px 0; }",
      "canvas { display:block; image-rendering:pixelated; object-fit:contain; }",
      "#preview { width:min(100%,210px); height:auto; max-height:260px; box-shadow:0 0 26px rgba(110,92,255,.1); }",
      ".meta-row { display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; color:#9ba2b6; font-size:12px; }",
      ".brightness-control { display:grid; gap:7px; margin-top:16px; padding:12px 14px; border-radius:10px; background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.10); }",
      ".brightness-head { display:flex; justify-content:space-between; align-items:center; gap:8px; color:#e6e7f5; font-size:13px; font-weight:600; }",
      ".brightness-head strong { color:#c5b8ff; font-variant-numeric:tabular-nums; font-size:15px; }",
      ".brightness-control input[type=range] { width:100%; margin:3px 0 0; cursor:pointer; accent-color:#9775ff; }",
      ".brightness-hint { font-size:11px; color:#96a2bc; } .brightness-hint.error { color:#ff9aaa; }",
      ".action { width:100%; margin-top:15px; padding:13px; min-height:46px; border-radius:10px; font-weight:700; font-size:14px; color:white; background:linear-gradient(110deg,#7857ff,#598dff); }",
      ".action:hover:not(:disabled) { filter:brightness(1.12); }",
      ".hint { margin-top:10px; font-size:11px; color:#96a2bc; line-height:1.55; }",
      ".status { font-size:12px; line-height:1.45; margin-top:15px; color:#a8b8cf; }",
      ".status.error { color:#ff9aaa; } .empty { grid-column:1/-1; padding:28px 14px; color:#a9b1c7; font-size:12px; line-height:1.6; }",
      "@container(max-width:620px) { .items { max-height:520px; } .detail { min-height:0; } }",
      "@media(max-width:620px) { .items { max-height:520px; } }",
    ].join("\n");

    this.shadowRoot.innerHTML =
      "<style>" + css + "</style><ha-card>" +
      '<div class="head"><div><span class="eyebrow">Bibliothèque Govee</span>' +
      "<h2>" + playerEscape(this.config.title || "LED Player") + "</h2></div>" +
      '<div class="head-actions">' +
      '<button class="power" id="power" type="button" disabled title="État Marche / Arrêt du H70B3 via LAN">⏻ Marche / Arrêt</button>' +
      '</div></div>' +
      '<div class="filter-bar"><div class="filters">' +
      '<button type="button" class="filter" data-filter="all">Tout</button>' +
      '<button type="button" class="filter" data-filter="art">Images</button>' +
      '<button type="button" class="filter" data-filter="animation">GIF</button>' +
      '</div><button class="refresh" id="refresh" type="button">↻ Actualiser</button></div>' +
      '<div class="layout">' +
      '<section class="detail"><h3 id="selected-name">Sélectionnez une création</h3>' +
      '<div id="selected-desc" class="muted">Images et GIF enregistrés dans LED Studio</div>' +
      '<div class="preview-wrap"><canvas id="preview" width="20" height="26"></canvas></div>' +
      '<div class="meta-row"><span id="info-kind"></span><span id="info-brightness"></span></div>' +
      '<div class="brightness-control"><div class="brightness-head">' +
      '<label for="player-brightness">☀ Luminosité du rideau</label>' +
      '<strong id="brightness-value">' + this._brightness + ' %</strong></div>' +
      '<input id="player-brightness" type="range" min="1" max="100" step="1" value="' + this._brightness + '">' +
      '<small class="brightness-hint" id="brightness-hint">Valeur mémorisée dans Home Assistant pour les prochains envois.</small></div>' +
      '<button type="button" class="action" id="play" disabled>Envoyer sur le rideau</button>' +
      '<div id="hint" class="hint">Le GIF continue à jouer après la fermeture de la carte.</div>' +
      '<div class="status" id="status" role="status"></div>' +
      '</section><section class="gallery"><div class="items" id="items"></div></section>' +
      '</div></ha-card>';

    this.shadowRoot.getElementById("refresh").addEventListener("click", () => this._loadGallery());
    this.shadowRoot.getElementById("power").addEventListener("click", () => this._togglePower());
    this.shadowRoot.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        this._filter = button.dataset.filter;
        this._renderItems();
      });
    });
    const brightnessSlider = this.shadowRoot.getElementById("player-brightness");
    brightnessSlider.addEventListener("input", () => {
      this._brightnessTouched = true;
      this._brightness = playerClamp(Number(brightnessSlider.value), 1, 100);
      this._renderBrightness();
      this._drawPreview();
    });
    brightnessSlider.addEventListener("change", () => { void this._saveBrightness(); });
    this.shadowRoot.getElementById("play").addEventListener("click", () => this._sendSelected());
    this._renderItems();
    this._statusUpdate(this._status, this._error);
    this._renderPowerButton();
  }

  _renderBrightness() {
    const slider = this.shadowRoot?.getElementById("player-brightness");
    const output = this.shadowRoot?.getElementById("brightness-value");
    if (slider) slider.value = String(this._brightness);
    if (output) output.textContent = this._brightness + " %";
  }

  _brightnessHint(message, error = false) {
    const hint = this.shadowRoot?.getElementById("brightness-hint");
    if (!hint) return;
    hint.textContent = message;
    hint.classList.toggle("error", error);
  }

  async _loadBrightness() {
    if (this._brightnessLoaded || this._brightnessLoading || !this._hass?.callWS) return;
    this._brightnessLoading = true;
    try {
      const result = await this._hass.callWS({ type: "govee_led_control/player/brightness/get" });
      const value = Number(result.brightness);
      if (Number.isInteger(value) && value >= 1 && value <= 100 && !this._brightnessTouched) {
        this._brightness = value;
        this._renderBrightness();
        this._drawPreview();
      }
      this._brightnessLoaded = true;
      this._brightnessHint("Valeur mémorisée dans Home Assistant pour les prochains envois.");
    } catch (error) {
      this._brightnessHint("Lecture impossible : redémarrez Home Assistant si le paquet vient d'être mis à jour.", true);
    } finally {
      this._brightnessLoading = false;
    }
  }

  async _saveBrightness() {
    if (!this._hass?.callWS) {
      this._brightnessHint("Enregistrement impossible : Home Assistant est indisponible.", true);
      return;
    }
    const brightness = this._brightness;
    // Serialize successive slider releases so an older network request cannot
    // overwrite the most recent setting in the shared Home Assistant storage.
    const previous = this._brightnessSaveQueue || Promise.resolve();
    const save = previous.catch(() => {}).then(() => this._hass.callWS({
      type: "govee_led_control/player/brightness/set", brightness,
    }));
    this._brightnessSaveQueue = save;
    try {
      await save;
      this._brightnessLoaded = true;
      if (brightness === this._brightness) {
        this._brightnessHint("Luminosité " + brightness + " % enregistrée dans Home Assistant.");
      }
    } catch (error) {
      this._brightnessHint("Impossible de mémoriser la luminosité : " + (error?.message || "erreur réseau"), true);
    }
  }

  // Select a real HA light/switch controlling device power. The matrix entity
  // from this integration represents individual pixels, NOT the power switch:
  // toggling it would replace an autonomous GIF with a static 20x26 frame.
  _powerRequest(type, additional = {}) {
    const entryId = this._entryId("h70b3");
    if (!entryId) return null;
    const request = { type, config_entry_id: entryId, ...additional };
    if (this.config?.lan_ip) request.lan_ip = this.config.lan_ip.trim();
    return request;
  }

  _renderPowerButton() {
    const button = this.shadowRoot?.getElementById("power");
    if (!button) return;
    const known = typeof this._powerOn === "boolean";
    button.disabled = this._powerBusy || this._powerLoading || !known;
    button.classList.toggle("is-on", this._powerOn === true);
    button.classList.toggle("is-off", this._powerOn === false);
    button.textContent = this._powerBusy ? "⏳ En cours…" :
      this._powerLoading ? "⏳ État LAN…" :
      this._powerOn === true ? "⏻ Éteindre" :
      this._powerOn === false ? "⏻ Allumer" : "⏻ LAN";
    button.title = this._powerError || (
      known ? "Marche / arrêt direct via UDP 4003 (sans Bluetooth ni cloud)" :
      "Recherche du H70B3 via le réseau local"
    );
  }

  async _refreshPower() {
    if (this._powerLoading || this._powerBusy || !this._hass?.callWS) return;
    const request = this._powerRequest("govee_led_control/power/get");
    if (!request) {
      this._powerError = "Intégration H70B3 non trouvée dans Home Assistant";
      this._renderPowerButton();
      return;
    }
    this._powerLoading = true;
    this._nextPowerCheck = Date.now() + 15000;
    this._renderPowerButton();
    try {
      const reply = await this._hass.callWS(request);
      this._powerOn = reply.on;
      this._powerHost = reply.host;
      this._powerError = null;
    } catch (error) {
      this._powerOn = null;
      this._powerError = error?.message || "H70B3 LAN inaccessible";
    } finally {
      this._powerLoading = false;
      this._renderPowerButton();
    }
  }

  async _togglePower() {
    if (this._powerBusy || this._powerLoading || typeof this._powerOn !== "boolean") return;
    const request = this._powerRequest("govee_led_control/power/set", {
      on: !this._powerOn,
    });
    if (!request) return;
    this._powerBusy = true;
    this._renderPowerButton();
    try {
      const reply = await this._hass.callWS(request);
      this._powerOn = reply.on;
      this._powerHost = reply.host;
      this._powerError = null;
      this._statusUpdate(reply.verified
        ? (reply.on ? "Govee allumé via LAN." : "Govee éteint via LAN.")
        : "Commande LAN envoyée ; état non confirmé par le H70B3.",
        !reply.verified);
    } catch (error) {
      this._powerError = error?.message || "Commande LAN impossible";
      this._statusUpdate(this._powerError, true);
    } finally {
      this._powerBusy = false;
      this._nextPowerCheck = Date.now() + 15000;
      this._renderPowerButton();
    }
  }

  _statusUpdate(message, error = false) {
    this._status = message;
    this._error = error;
    const element = this.shadowRoot && this.shadowRoot.getElementById("status");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  async _loadGallery() {
    if (!this._hass || !this._hass.callWS || this._loading) return;
    this._loading = true;
    const refresh = this.shadowRoot.getElementById("refresh");
    if (refresh) refresh.disabled = true;
    try {
      const response = await this._hass.callWS({ type: "govee_led_control/gallery/list" });
      this._items = Array.isArray(response.items) ? response.items : [];
      this._items.sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
      if (!this._items.some((item) => item.id === this._selectedId)) {
        this._selectedId = this._items[0] && this._items[0].id || null;
      }
      this._renderItems();
      this._statusUpdate(this._items.length
        ? this._items.length + " création(s) enregistrée(s) dans Home Assistant."
        : "Aucune création : enregistrez vos images ou GIF dans LED Studio.");
    } catch (error) {
      this._statusUpdate(error && error.message || "Impossible de charger la galerie.", true);
    } finally {
      this._loading = false;
      if (refresh) refresh.disabled = false;
    }
  }

  _selected() {
    return this._items.find((item) => item.id === this._selectedId) || null;
  }

  _renderItems() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll("[data-filter]").forEach((button) =>
      button.classList.toggle("active", button.dataset.filter === this._filter)
    );
    const list = this.shadowRoot.getElementById("items");
    const filtered = this._items.filter((item) =>
      this._filter === "all" || item.kind === this._filter
    );
    if (!filtered.length) {
      list.innerHTML = '<div class="empty">' + (this._items.length
        ? "Aucune création de ce type."
        : "Votre galerie est vide. Enregistrez d'abord des créations dans LED Studio.") + "</div>";
    } else {
      list.innerHTML = filtered.map((item) => {
        const colors = playerColors(item);
        const type = item.kind === "animation" ? "GIF · " + (item.frames || []).length + " images" : "Image";
        const target = item.target === "h6069" ? "H6069" : "H70B3";
        const active = item.id === this._selectedId ? " active" : "";
        return '<button type="button" class="item' + active + '" data-id="' + playerEscape(item.id) + '">' +
          '<canvas class="thumb" data-thumb="' + playerEscape(item.id) + '"></canvas>' +
          '<span class="item-meta"><strong>' +
          playerEscape(item.name) + '</strong><small>' + type + ' · ' + target +
          "</small></span></button>";
      }).join("");
      list.querySelectorAll("[data-thumb]").forEach((canvas) => {
        const art = filtered.find((item) => item.id === canvas.dataset.thumb);
        if (art) this._paintCanvas(canvas, playerColors(art), art.target);
      });
      list.querySelectorAll("[data-id]").forEach((button) => {
        button.addEventListener("click", () => {
          this._selectedId = button.dataset.id;
          this._renderItems();
        });
      });
    }
    this._renderSelection();
  }

  _renderSelection() {
    this._clearPreviewTimer();
    const item = this._selected();
    const button = this.shadowRoot.getElementById("play");
    const title = this.shadowRoot.getElementById("selected-name");
    const info = this.shadowRoot.getElementById("selected-desc");
    const kind = this.shadowRoot.getElementById("info-kind");
    const brightness = this.shadowRoot.getElementById("info-brightness");
    const hint = this.shadowRoot.getElementById("hint");
    if (!item) {
      title.textContent = "Aucune création sélectionnée";
      info.textContent = "Enregistrez des images ou GIF depuis LED Studio.";
      kind.textContent = "";
      brightness.textContent = "";
      button.disabled = true;
      button.textContent = "▶ Afficher sur le rideau";
      hint.textContent = "";
      this._drawFrame([]);
      return;
    }
    title.textContent = item.name || "Sans nom";
    info.textContent = (item.target === "h6069" ? "Panneaux H6069" : "Rideau H70B3") +
      (item.kind === "animation" ? " · Animation enregistrée" : " · Image enregistrée");
    kind.textContent = item.kind === "animation"
      ? (item.frames || []).length + " images"
      : "Image fixe";
    brightness.textContent = "Création : " + (item.brightness || 100) + " %";
    button.disabled = this._busy;
    button.textContent = "Envoyer sur le rideau";
    hint.textContent = item.kind === "animation"
      ? "GIF autonome : un seul transfert Bluetooth. L'application Govee Home peut reprendre le contrôle."
      : "Affichage d'une image fixe enregistrée. Le Bluetooth est libéré après le transfert.";
    this._previewFrame = 0;
    this._drawPreview();
  }

  _drawPreview() {
    this._clearPreviewTimer();
    const item = this._selected();
    if (!item) return;
    const frames = item.kind === "animation" && Array.isArray(item.frames) ? item.frames : null;
    const current = frames && frames.length ? frames[this._previewFrame % frames.length] : null;
    this._drawFrame(current ? current.colors : item.colors);
    if (this.isConnected && !document.hidden && frames && frames.length > 1) {
      this._previewTimer = setTimeout(() => {
        this._previewFrame = (this._previewFrame + 1) % frames.length;
        this._drawPreview();
      }, playerClamp(Number(current.duration) || 100, 100, 2000));
    }
  }

  _drawFrame(colors) {
    const canvas = this.shadowRoot.getElementById("preview");
    if (!canvas) return;
    const item = this._selected();
    // Preview the light level without changing stored artwork or thumbnails.
    const factor = playerClamp(Number(this._brightness) || 100, 1, 100) / 100;
    const previewColors = Array.isArray(colors) ? colors.map((hex) => {
      if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
      const channel = (start) => Math.round(parseInt(hex.slice(start, start + 2), 16) * factor)
        .toString(16).padStart(2, "0");
      return "#" + channel(1) + channel(3) + channel(5);
    }) : colors;
    this._paintCanvas(canvas, previewColors, item && item.target);
  }

  _paintCanvas(canvas, colors, target) {
    if (!canvas) return;
    const isPanel = target === "h6069";
    const width = isPanel ? 8 : PLAYER_WIDTH;
    const height = isPanel ? Math.ceil(Math.max(colors && colors.length || 1, 1) / width) : PLAYER_HEIGHT;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    context.fillStyle = "#05060b";
    context.fillRect(0, 0, width, height);
    if (!Array.isArray(colors)) return;
    colors.forEach((color, index) => {
      if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return;
      context.fillStyle = color;
      context.fillRect(index % width, Math.floor(index / width), 1, 1);
    });
  }

  _clearPreviewTimer() {
    if (this._previewTimer !== undefined) {
      clearTimeout(this._previewTimer);
      this._previewTimer = undefined;
    }
  }

  _entryId(target) {
    const states = this._hass && this._hass.states || {};
    const requested = target === "h6069"
      ? this.config.h6069_transport_entity : this.config.h70b3_transport_entity;
    const model = target === "h6069" ? "H6069" : "H70B3";
    const configured = states[requested];
    if (configured && configured.attributes && configured.attributes.model === model &&
        configured.attributes.config_entry_id) return configured.attributes.config_entry_id;
    for (const [id, state] of Object.entries(states)) {
      if (!id.startsWith("sensor.") || !state.attributes) continue;
      if (state.attributes.model === model && state.attributes.config_entry_id) {
        return state.attributes.config_entry_id;
      }
    }
    return null;
  }

  async _sendSelected() {
    if (this._busy) return;
    const item = this._selected();
    if (!item || !this._hass || !this._hass.callService) return;
    const entryId = this._entryId(item.target);
    if (!entryId) {
      this._statusUpdate("Transport " + String(item.target).toUpperCase() +
        " introuvable. Vérifiez la configuration de l'intégration.", true);
      return;
    }
    const button = this.shadowRoot.getElementById("play");
    this._busy = true;
    button.disabled = true;
    button.textContent = "⏳ Envoi en cours…";
    this._statusUpdate("Envoi de « " + item.name + " »…");
    try {
      const brightness = playerClamp(Number(this._brightness) || 100, 1, 100);
      if (item.kind === "animation") {
        if (item.target !== "h70b3") throw new Error("Les GIF nécessitent un H70B3.");
        const data = encodePlayerGifFrames(item.frames, brightness);
        let binary = "";
        for (let i = 0; i < data.length; i += 0x4000) {
          binary += String.fromCharCode(...data.subarray(i, i + 0x4000));
        }
        await this._hass.callService("govee_led_control", "upload_native_gif", {
          config_entry_id: entryId, gif_base64: btoa(binary),
        });
      } else {
        await this._hass.callService("govee_led_control", "set_frame", {
          config_entry_id: entryId,
          colors: item.colors,
          brightness_percent: brightness,
          commit: true,
        });
      }
      this._statusUpdate(item.kind === "animation"
        ? "GIF lancé en lecture autonome · Bluetooth libéré."
        : "Image envoyée · Bluetooth libéré.");
    } catch (error) {
      this._statusUpdate(error && error.message || "Échec de l'envoi.", true);
    } finally {
      this._busy = false;
      this._renderSelection();
    }
  }
}

if (!customElements.get("govee-led-player")) {
  customElements.define("govee-led-player", GoveeLedPlayer);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "govee-led-player")) {
  window.customCards.push({
    type: "govee-led-player",
    name: "Govee LED Player",
    description: "Lecteur des images et GIF enregistrés dans LED Studio.",
    preview: true,
  });
}
