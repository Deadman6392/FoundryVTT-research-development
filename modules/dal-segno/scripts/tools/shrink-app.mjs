/**
 * GM window that shrinks a long file (an hour of ambience saved from a video, say) into a small Opus file, uploads it
 * to the world's data and can add it to a playlist. Everything runs in the GM's browser, on a file from their own
 * computer or one already in Foundry's data; nothing else is sent anywhere. Loaded on demand.
 */
import { MODULE_ID } from "../constants.mjs";
import { clock, esc, injectStyle } from "../apps/style.mjs";
import { canShrink, probe, shrink } from "./transcode.mjs";

const { ApplicationV2 } = foundry.applications.api;

const QUALITIES = [
  [48000, "DALSEGNO.Shrink.Q48"],
  [64000, "DALSEGNO.Shrink.Q64"],
  [96000, "DALSEGNO.Shrink.Q96"],
  [128000, "DALSEGNO.Shrink.Q128"]
];

/** "1:02:03", "2:03" or "123.5" to seconds; empty or unreadable gives the fallback. */
export function parseTime(value, fallback) {
  const text = String(value ?? "").trim();
  if ( !text ) return fallback;
  const parts = text.split(":").map(Number);
  if ( parts.some(n => !Number.isFinite(n) || (n < 0)) ) return fallback;
  return parts.reduce((total, n) => (total * 60) + n, 0);
}

const megabytes = bytes => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export class ShrinkApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-shrink`,
    tag: "form",
    classes: ["dal-segno-app", "dal-segno-shrink", "standard-form"],
    window: { title: "DALSEGNO.Shrink.Title", icon: "fa-solid fa-file-zipper", resizable: true },
    position: { width: 540, height: "auto" },
    form: { handler: ShrinkApp.#onSubmit, closeOnSubmit: false },
    actions: { cancel: ShrinkApp.#onCancel, deck: ShrinkApp.#onDeck }
  };

  static #instance;

  static open() {
    if ( !game.user.isGM ) return null;
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  /** @type {Blob|null} */
  file = null;

  fileName = "";

  info = null;

  values = { start: "", end: "", channels: 2, bitrate: 96000, folder: `worlds/${game.world?.id ?? "world"}/dal-segno`, name: "", playlist: "" };

  progress = null;

  result = null;

  error = "";

  #controller = null;

  async _renderHTML() {
    injectStyle();
    const t = key => esc(game.i18n.localize(key));
    if ( !canShrink() ) return `<p>${t("DALSEGNO.Shrink.Unsupported")}</p>`;
    const busy = this.progress !== null;
    const v = this.values;
    const info = this.info;
    const kept = info?.duration ? Math.max(0, parseTime(v.end, info.duration) - parseTime(v.start, 0)) : null;
    const estimate = kept ? megabytes((kept * v.bitrate) / 8) : "–";
    const playlists = game.playlists.contents.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(p => `<option value="${p.id}"${p.id === v.playlist ? " selected" : ""}>${esc(p.name)}</option>`).join("");
    const qualities = QUALITIES.map(([rate, key]) => `<option value="${rate}"${rate === Number(v.bitrate) ? " selected" : ""}>${t(key)}</option>`).join("");
    return `<p class="dsg-hint">${t("DALSEGNO.Shrink.Intro")}</p>
      <div class="form-group">
        <label>${t("DALSEGNO.Shrink.Local")}</label>
        <div class="form-fields"><input type="file" name="file" accept="audio/*,video/*,.mkv,.m4a,.opus,.flac,.ogg"${busy ? " disabled" : ""}></div>
      </div>
      <div class="form-group">
        <label>${t("DALSEGNO.Shrink.Server")}</label>
        <div class="form-fields"><file-picker name="serverPath" value=""${busy ? " disabled" : ""}></file-picker></div>
      </div>
      ${info ? `<dl>
        <dt>${t("DALSEGNO.Shrink.File")}</dt><dd>${esc(this.fileName)} (${megabytes(this.file.size)})</dd>
        <dt>${t("DALSEGNO.Shrink.Audio")}</dt><dd>${esc(info.codecName)}${info.sampleRate ? `, ${info.sampleRate} Hz, ${info.channels} ${t("DALSEGNO.Shrink.Channels")}` : ""}${info.whole ? ` · ${t("DALSEGNO.Shrink.Whole")}` : ""}</dd>
        <dt>${t("DALSEGNO.Shrink.Length")}</dt><dd>${clock(info.duration)}</dd>
      </dl>` : ""}
      ${(info && !info.decodable) ? `<p class="dsg-hint">${t("DALSEGNO.Shrink.CantRead")}</p>` : ""}
      <div class="form-group">
        <label>${t("DALSEGNO.Shrink.Keep")}</label>
        <div class="form-fields">
          <input type="text" name="start" value="${esc(v.start)}" placeholder="0:00" style="width:6rem">
          <span>${t("DALSEGNO.Shrink.To")}</span>
          <input type="text" name="end" value="${esc(v.end)}" placeholder="${info ? clock(info.duration) : t("DALSEGNO.Shrink.TheEnd")}" style="width:6rem">
        </div>
      </div>
      <div class="form-group">
        <label>${t("DALSEGNO.Shrink.Output")}</label>
        <div class="form-fields">
          <select name="channels"><option value="2"${Number(v.channels) === 2 ? " selected" : ""}>${t("DALSEGNO.Shrink.Stereo")}</option><option value="1"${Number(v.channels) === 1 ? " selected" : ""}>${t("DALSEGNO.Shrink.Mono")}</option></select>
          <select name="bitrate">${qualities}</select>
        </div>
        <p class="hint">${esc(game.i18n.format("DALSEGNO.Shrink.Estimate", { size: estimate }))}</p>
      </div>
      <div class="form-group">
        <label>${t("DALSEGNO.Shrink.Folder")}</label>
        <div class="form-fields"><file-picker name="folder" type="folder" value="${esc(v.folder)}"></file-picker></div>
      </div>
      <div class="form-group">
        <label>${t("DALSEGNO.Shrink.Name")}</label>
        <div class="form-fields"><input type="text" name="name" value="${esc(v.name)}" placeholder="music.ogg"></div>
      </div>
      <div class="form-group">
        <label>${t("DALSEGNO.Shrink.Playlist")}</label>
        <div class="form-fields"><select name="playlist"><option value="">${t("DALSEGNO.Shrink.NoPlaylist")}</option>${playlists}</select></div>
      </div>
      ${busy ? `<progress class="dsg-progress" max="1" value="${this.progress}"></progress>` : ""}
      ${this.error ? `<p class="dsg-hint" style="color:var(--dsg-stop)">${esc(this.error)}</p>` : ""}
      ${this.result ? `<p>${esc(this.result.message)}</p>` : ""}
      <footer class="form-footer">
        ${busy ? `<button type="button" data-action="cancel"><i class="fa-solid fa-xmark"></i> ${t("DALSEGNO.Shrink.Cancel")}</button>`
          : `<button type="submit"${this.file && info?.decodable ? "" : " disabled"}><i class="fa-solid fa-file-zipper"></i> ${t("DALSEGNO.Shrink.Go")}</button>`}
        ${this.result?.sound ? `<button type="button" data-action="deck"><i class="fa-solid fa-compact-disc"></i> ${t("DALSEGNO.Shrink.ToDeck")}</button>` : ""}
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("change", event => this.#onChange(event));
  }

  _onClose(options) {
    super._onClose(options);
    this.#controller?.abort();
  }

  /** Keep what was typed across re-renders. */
  #remember() {
    const form = this.element;
    if ( !form ) return;
    for ( const name of ["start", "end", "channels", "bitrate", "name", "playlist"] ) {
      const el = form.querySelector(`[name="${name}"]`);
      if ( el ) this.values[name] = el.value;
    }
    const folder = form.querySelector("file-picker[name=\"folder\"]");
    if ( folder?.value ) this.values.folder = folder.value;
  }

  async #onChange(event) {
    const el = event.target;
    this.#remember();
    if ( el.name === "file" && el.files?.[0] ) return this.#choose(el.files[0], el.files[0].name);
    if ( (el.name === "serverPath") && el.value ) {
      try {
        const response = await fetch(el.value);
        if ( !response.ok ) throw new Error(`${response.status} ${response.statusText}`);
        return this.#choose(await response.blob(), decodeURIComponent(el.value.split("/").pop()));
      } catch(err) {
        this.error = err.message;
        return this.render();
      }
    }
    if ( ["start", "end", "bitrate"].includes(el.name) ) this.render();
  }

  async #choose(blob, name) {
    this.file = blob;
    this.fileName = name;
    this.result = null;
    this.error = "";
    this.values.name = `${name.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "").trim() || "audio"}.ogg`;
    try {
      this.info = await probe(blob);
      if ( (this.info.channels === 1) && (Number(this.values.channels) === 2) ) this.values.channels = 1;
    } catch(err) {
      this.info = null;
      this.error = game.i18n.format("DALSEGNO.Shrink.ReadFailed", { error: err.message });
    }
    this.render();
  }

  static async #onSubmit() {
    if ( !this.file || (this.progress !== null) ) return;
    this.#remember();
    const v = this.values;
    const start = parseTime(v.start, 0);
    const end = parseTime(v.end, Infinity);
    const folder = String(v.folder || "").replace(/\/+$/, "");
    const name = String(v.name || "audio.ogg").replace(/[\\/]/g, "").replace(/\.[^.]*$/, "") + ".ogg";
    this.#controller = new AbortController();
    this.progress = 0;
    this.error = "";
    this.result = null;
    this.render();
    let lastDraw = 0;
    try {
      const { blob, seconds } = await shrink(this.file, {
        channels: Number(v.channels) === 1 ? 1 : 2,
        bitrate: Number(v.bitrate) || 96000,
        start,
        end,
        signal: this.#controller.signal,
        onProgress: fraction => {
          this.progress = fraction;
          const bar = this.element?.querySelector(".dsg-progress");
          const now = performance.now();
          if ( bar && (now - lastDraw > 250) ) {
            bar.value = fraction;
            lastDraw = now;
          }
        }
      });
      const path = await this.#upload(folder, name, blob);
      const sound = await this.#addToPlaylist(v.playlist, name, path);
      this.result = {
        sound,
        message: game.i18n.format("DALSEGNO.Shrink.Done", { path, size: megabytes(blob.size), was: megabytes(this.file.size), length: clock(seconds) })
          + (sound ? ` ${game.i18n.format("DALSEGNO.Shrink.Added", { playlist: sound.parent.name })}` : "")
      };
    } catch(err) {
      this.error = (err.name === "AbortError") ? game.i18n.localize("DALSEGNO.Shrink.Cancelled") : game.i18n.format("DALSEGNO.Shrink.Failed", { error: err.message });
    } finally {
      this.progress = null;
      this.#controller = null;
      if ( this.rendered ) this.render();
    }
  }

  async #upload(folder, name, blob) {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    // Create each level of the folder; one that already exists is fine
    const parts = folder.split("/").filter(Boolean);
    for ( let i = 1; i <= parts.length; i++ ) {
      try {
        await FilePicker.createDirectory("data", parts.slice(0, i).join("/"));
      } catch {}
    }
    const file = new File([blob], name, { type: "audio/ogg" });
    const response = await FilePicker.upload("data", folder, file, {}, { notify: false });
    if ( response === false ) throw new Error(game.i18n.localize("DALSEGNO.Shrink.UploadFailed"));
    return response?.path ?? `${folder}/${name}`;
  }

  async #addToPlaylist(id, name, path) {
    const playlist = game.playlists.get(id);
    if ( !playlist ) return null;
    const [sound] = await playlist.createEmbeddedDocuments("PlaylistSound", [{ name: name.replace(/\.ogg$/, ""), path, volume: 0.5 }]);
    return sound ?? null;
  }

  static #onCancel() {
    this.#controller?.abort();
  }

  static #onDeck() {
    const sound = this.result?.sound;
    if ( sound ) game.modules.get(MODULE_ID).api.load(sound, { play: false }).then(() => game.modules.get(MODULE_ID).api.openDeck());
  }
}
