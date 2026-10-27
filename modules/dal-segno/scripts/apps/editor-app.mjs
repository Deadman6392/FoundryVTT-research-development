/**
 * Section editor for one playlist sound: mark an intro, a loop and an ending (or any sections, with gaps for the
 * parts to skip) on a waveform, fine-tune them in a zoomed view, and preview them on this computer only. Loaded on
 * demand. Saving writes one flag on the sound.
 *
 * The waveform comes from decoding the file at 11 kHz in an OfflineAudioContext, about 0.4 MB of memory per minute,
 * kept only while the window is open. Files over 20 minutes get a plain timeline instead of a waveform.
 */
import { ARRANGEMENT_FLAG, MODULE_ID } from "../constants.mjs";
import { matchLoopEnd, mixToMono, peaks } from "../lib/peaks.mjs";
import { clock, esc, injectStyle } from "./style.mjs";

const { ApplicationV2 } = foundry.applications.api;

const RATE = 11025;
const WAVE_MAX_SECONDS = 20 * 60;
const ZOOM_SPAN = 0.75;
const GRAB_PX = 7;
const PREVIEW_TICK = 100;

let api;

/** A file's length from its metadata, without downloading it. */
function mediaDuration(src) {
  return new Promise((resolve, reject) => {
    const el = new Audio();
    el.preload = "metadata";
    el.addEventListener("loadedmetadata", () => {
      resolve(el.duration);
      el.removeAttribute("src");
      el.load();
    }, { once: true });
    el.addEventListener("error", () => reject(new Error(el.error?.message || src)), { once: true });
    el.src = src;
  });
}

export class EditorApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["dal-segno-app", "dal-segno-editor"],
    window: { title: "DALSEGNO.Editor.Title", icon: "fa-solid fa-scissors", resizable: true },
    position: { width: 780, height: "auto" },
    actions: {
      select: EditorApp.#onSelect,
      setStart: EditorApp.#onSetStart,
      setEnd: EditorApp.#onSetEnd,
      remove: EditorApp.#onRemove,
      up: EditorApp.#onUp,
      down: EditorApp.#onDown,
      add: EditorApp.#onAdd,
      preset: EditorApp.#onPreset,
      nudge: EditorApp.#onNudge,
      match: EditorApp.#onMatch,
      preview: EditorApp.#onPreview,
      seam: EditorApp.#onSeam,
      stopPreview: EditorApp.#onStopPreview,
      save: EditorApp.#onSave,
      savePlay: EditorApp.#onSavePlay,
      revert: EditorApp.#onRevert
    }
  };

  static #windows = new Map();

  /** Open the editor for a sound, one window per sound. */
  static open(sound, moduleApi) {
    api = moduleApi;
    if ( !api.canControl() ) return null;
    let app = this.#windows.get(sound.uuid);
    if ( !app ) {
      app = new this({ id: `${MODULE_ID}-editor-${sound.id}` });
      app.sound = sound;
      app.#reset();
      app.#loadAudio();
      this.#windows.set(sound.uuid, app);
    }
    return app.render({ force: true });
  }

  /** @type {PlaylistSound} */
  sound;

  sections = [];

  seam = 0;

  duration = null;

  /** The marker being edited: a section index and which edge. */
  selected = { index: 0, edge: "start" };

  /** Where previews start, in file seconds. */
  cursor = 0;

  samples = null;

  waveNote = "";

  #logic = null;

  #drag = null;

  #overview = null;

  #preview = null;

  #previewDeck = null;

  #previewTimer = null;

  get title() {
    return `${game.i18n.localize("DALSEGNO.Editor.Title")}: ${this.sound?.name ?? ""}`;
  }

  #reset() {
    const saved = this.sound.getFlag(MODULE_ID, ARRANGEMENT_FLAG);
    this.sections = (saved?.sections ?? []).map(s => ({ label: s.label ?? "", start: Number(s.start) || 0, end: s.end ?? null, loop: Boolean(s.loop) }));
    this.seam = Number(saved?.seam) || 0;
    if ( saved?.duration ) this.duration = saved.duration;
    this.selected = { index: 0, edge: "start" };
  }

  async #loadAudio() {
    this.waveNote = game.i18n.localize("DALSEGNO.Editor.Loading");
    try {
      this.duration = await mediaDuration(this.sound.path);
      if ( this.rendered ) this.render();
      if ( this.duration > WAVE_MAX_SECONDS ) {
        this.waveNote = game.i18n.localize("DALSEGNO.Editor.TooLong");
        return;
      }
      const response = await fetch(this.sound.path);
      if ( !response.ok ) throw new Error(`${response.status} ${response.statusText}`);
      const decoded = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await response.arrayBuffer());
      this.samples = mixToMono(Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c)));
      this.duration = decoded.duration;
      this.#overview = null;
      this.waveNote = "";
    } catch(err) {
      this.waveNote = game.i18n.format("DALSEGNO.Editor.NoWave", { error: err?.message ?? String(err) });
    }
    if ( this.rendered ) this.render();
  }

  /** The end of a section in seconds, resolving "end of file". */
  #end(section) {
    return section.end ?? this.duration ?? section.start;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _renderHTML() {
    injectStyle();
    this.#logic ??= await api.loadLogic();
    const t = key => esc(game.i18n.localize(key));
    const rows = this.sections.map((s, i) => {
      const selected = i === this.selected.index;
      const end = (s.end === null) ? "" : s.end.toFixed(3);
      return `<tr data-action="select" data-index="${i}" class="${selected ? "dsg-selected" : ""}">
          <td>${i + 1}</td>
          <td><input type="text" name="label-${i}" value="${esc(s.label)}" placeholder="${esc(game.i18n.format("DALSEGNO.Deck.Section", { n: i + 1 }))}"></td>
          <td><div class="dsg-row"><input type="number" name="start-${i}" value="${s.start.toFixed(3)}" min="0" step="0.001">
            <a data-action="setStart" data-index="${i}" data-tooltip="${t("DALSEGNO.Editor.SetToCursor")}"><i class="fa-solid fa-location-crosshairs"></i></a></div></td>
          <td><div class="dsg-row"><input type="number" name="end-${i}" value="${end}" min="0" step="0.001" placeholder="${t("DALSEGNO.Editor.FileEnd")}">
            <a data-action="setEnd" data-index="${i}" data-tooltip="${t("DALSEGNO.Editor.SetToCursor")}"><i class="fa-solid fa-location-crosshairs"></i></a></div></td>
          <td><input type="checkbox" name="loop-${i}"${s.loop ? " checked" : ""} aria-label="${t("DALSEGNO.Editor.Loop")}"></td>
          <td class="dsg-row">
            <a data-action="up" data-index="${i}" aria-label="${t("DALSEGNO.Editor.Up")}"><i class="fa-solid fa-arrow-up"></i></a>
            <a data-action="down" data-index="${i}" aria-label="${t("DALSEGNO.Editor.Down")}"><i class="fa-solid fa-arrow-down"></i></a>
            <a data-action="remove" data-index="${i}" aria-label="${t("DALSEGNO.Editor.Remove")}"><i class="fa-solid fa-trash"></i></a>
          </td>
        </tr>`;
    }).join("");
    const previewing = Boolean(this.#previewTimer);
    return `<div class="dsg-row">
        <span class="dsg-title dsg-grow">${esc(this.sound.name)}</span>
        <span class="dsg-muted">${clock(this.duration)}</span>
      </div>
      <canvas class="dsg-wave" aria-label="${t("DALSEGNO.Editor.Waveform")}"></canvas>
      ${this.waveNote ? `<p class="dsg-hint">${esc(this.waveNote)}</p>` : ""}
      <canvas class="dsg-zoom" aria-label="${t("DALSEGNO.Editor.Zoom")}"></canvas>
      <div class="dsg-row dsg-actions">
        <button type="button" data-action="${previewing ? "stopPreview" : "preview"}"><i class="fa-solid ${previewing ? "fa-stop" : "fa-play"}"></i> ${t(previewing ? "DALSEGNO.Editor.Stop" : "DALSEGNO.Editor.Preview")}</button>
        <button type="button" data-action="seam" data-tooltip="${t("DALSEGNO.Editor.SeamHint")}"><i class="fa-solid fa-repeat"></i> ${t("DALSEGNO.Editor.Seam")}</button>
        <span class="dsg-grow"></span>
        <button type="button" data-action="nudge" data-amount="-0.1">−100 ms</button>
        <button type="button" data-action="nudge" data-amount="-0.01">−10 ms</button>
        <button type="button" data-action="nudge" data-amount="0.01">+10 ms</button>
        <button type="button" data-action="nudge" data-amount="0.1">+100 ms</button>
        <button type="button" data-action="match" data-tooltip="${t("DALSEGNO.Editor.MatchHint")}"${this.samples ? "" : " disabled"}><i class="fa-solid fa-wand-magic-sparkles"></i> ${t("DALSEGNO.Editor.Match")}</button>
      </div>
      <p class="dsg-hint">${t("DALSEGNO.Editor.Hint")}</p>
      <table>
        <thead><tr><th>#</th><th>${t("DALSEGNO.Editor.Label")}</th><th>${t("DALSEGNO.Editor.Start")}</th><th>${t("DALSEGNO.Editor.End")}</th><th>${t("DALSEGNO.Editor.Loop")}</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="dsg-hint">${t("DALSEGNO.Editor.NoSections")}</td></tr>`}</tbody>
      </table>
      <div class="dsg-row dsg-actions">
        <button type="button" data-action="add"><i class="fa-solid fa-plus"></i> ${t("DALSEGNO.Editor.Add")}</button>
        <button type="button" data-action="preset" data-preset="ilo">${t("DALSEGNO.Editor.PresetILO")}</button>
        <button type="button" data-action="preset" data-preset="loop">${t("DALSEGNO.Editor.PresetLoop")}</button>
        <button type="button" data-action="preset" data-preset="clear">${t("DALSEGNO.Editor.PresetClear")}</button>
        <span class="dsg-grow"></span>
        <label for="${this.id}-seam">${t("DALSEGNO.Editor.Crossfade")}</label>
        <input type="number" id="${this.id}-seam" name="seam" value="${this.seam}" min="0" max="4" step="0.01" style="width:4.5rem" data-tooltip="${t("DALSEGNO.Editor.CrossfadeHint")}">
      </div>
      <footer>
        <button type="button" data-action="save"><i class="fa-solid fa-floppy-disk"></i> ${t("DALSEGNO.Editor.Save")}</button>
        <button type="button" data-action="savePlay"><i class="fa-solid fa-play"></i> ${t("DALSEGNO.Editor.SavePlay")}</button>
        <button type="button" data-action="revert"><i class="fa-solid fa-rotate-left"></i> ${t("DALSEGNO.Editor.Revert")}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("change", event => this.#onChange(event));
    this.element.addEventListener("pointerdown", event => this.#onPointerDown(event));
    this.element.addEventListener("pointermove", event => this.#onPointerMove(event));
    this.element.addEventListener("pointerup", () => (this.#drag = null));
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#draw();
  }

  _onClose(options) {
    super._onClose(options);
    this.#stopPreview(false);
    this.#preview?.dispose();
    this.#preview = null;
    this.samples = null;
    this.#overview = null;
    EditorApp.#windows.delete(this.sound.uuid);
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  #colors() {
    const style = getComputedStyle(this.element);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return {
      accent: read("--dsg-accent", "#ee9b3a"),
      wave: read("--fxr-text", "") || style.color || "#ddd",
      go: read("--dsg-go", "#5fb35f"),
      stop: read("--dsg-stop", "#c4553e"),
      muted: read("--dsg-muted", "#999")
    };
  }

  /** A canvas sized to its box at the screen's pixel density. */
  #prepare(canvas) {
    const ratio = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if ( (canvas.width !== width) || (canvas.height !== height) ) {
      canvas.width = width;
      canvas.height = height;
    }
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, width, height);
    return { g, width, height, ratio };
  }

  #draw(playhead = null) {
    if ( !this.element ) return;
    const colors = this.#colors();
    this.#drawOverview(colors, playhead);
    this.#drawZoom(colors, playhead);
  }

  #drawOverview(colors, playhead) {
    const canvas = this.element.querySelector("canvas.dsg-wave");
    if ( !canvas || !this.duration ) return;
    const { g, width, height, ratio } = this.#prepare(canvas);
    const x = time => (time / this.duration) * width;
    this.#drawSections(g, x, 0, this.duration, height, ratio, colors);
    if ( this.samples ) {
      if ( this.#overview?.width !== width ) this.#overview = { width, data: peaks(this.samples, width) };
      this.#drawPeaks(g, this.#overview.data, width, height, colors.wave);
    }
    else this.#midline(g, width, height, colors.muted);
    this.#drawMarkers(g, x, height, ratio, colors, 0, this.duration);
    this.#line(g, x(this.cursor), height, colors.muted, ratio, [4 * ratio, 3 * ratio]);
    if ( playhead !== null ) this.#line(g, x(playhead), height, colors.accent, 2 * ratio);
  }

  #drawZoom(colors, playhead) {
    const canvas = this.element.querySelector("canvas.dsg-zoom");
    if ( !canvas || !this.duration ) return;
    const { g, width, height, ratio } = this.#prepare(canvas);
    const center = this.#markerTime() ?? this.cursor;
    const from = center - ZOOM_SPAN;
    const to = center + ZOOM_SPAN;
    const x = time => ((time - from) / (to - from)) * width;
    this.#drawSections(g, x, from, to, height, ratio, colors);
    if ( this.samples ) {
      const data = peaks(this.samples, width, Math.round(from * RATE), Math.round(to * RATE));
      this.#drawPeaks(g, data, width, height, colors.wave);
    }
    else this.#midline(g, width, height, colors.muted);
    this.#drawMarkers(g, x, height, ratio, colors, from, to);
    if ( playhead !== null && (playhead >= from) && (playhead <= to) ) this.#line(g, x(playhead), height, colors.accent, 2 * ratio);
    g.fillStyle = colors.muted;
    g.font = `${11 * ratio}px sans-serif`;
    g.fillText(`${center.toFixed(3)} s`, 4 * ratio, height - (4 * ratio));
  }

  #drawSections(g, x, from, to, height, ratio, colors) {
    g.font = `${11 * ratio}px sans-serif`;
    for ( const [i, s] of this.sections.entries() ) {
      const start = Math.max(from, s.start);
      const end = Math.min(to, this.#end(s));
      if ( end <= start ) continue;
      g.globalAlpha = s.loop ? 0.3 : 0.16;
      g.fillStyle = colors.accent;
      g.fillRect(x(start), 0, x(end) - x(start), height);
      g.globalAlpha = 0.9;
      g.fillStyle = colors.wave;
      g.fillText(`${i + 1}${s.label ? ` ${s.label}` : ""}${s.loop ? " ⟳" : ""}`, x(start) + (3 * ratio), 12 * ratio);
    }
    g.globalAlpha = 1;
  }

  #drawPeaks(g, data, width, height, color) {
    const mid = height / 2;
    g.fillStyle = color;
    g.globalAlpha = 0.85;
    for ( let px = 0; px < width; px++ ) {
      const min = data[px * 2];
      const max = data[(px * 2) + 1];
      const top = mid - (max * mid * 0.95);
      const bottom = mid - (min * mid * 0.95);
      g.fillRect(px, top, 1, Math.max(1, bottom - top));
    }
    g.globalAlpha = 1;
  }

  #midline(g, width, height, color) {
    g.fillStyle = color;
    g.fillRect(0, height / 2, width, 1);
  }

  #drawMarkers(g, x, height, ratio, colors, from, to) {
    for ( const [i, s] of this.sections.entries() ) {
      for ( const edge of ["start", "end"] ) {
        const time = (edge === "start") ? s.start : this.#end(s);
        if ( (time < from) || (time > to) ) continue;
        const selected = (i === this.selected.index) && (edge === this.selected.edge);
        this.#line(g, x(time), height, (edge === "start") ? colors.go : colors.stop, (selected ? 3 : 1.5) * ratio);
      }
    }
  }

  #line(g, px, height, color, lineWidth, dash = []) {
    g.save();
    g.strokeStyle = color;
    g.lineWidth = lineWidth;
    g.setLineDash(dash);
    g.beginPath();
    g.moveTo(px, 0);
    g.lineTo(px, height);
    g.stroke();
    g.restore();
  }

  /* -------------------------------------------- */
  /*  Editing                                     */
  /* -------------------------------------------- */

  #markerTime() {
    const s = this.sections[this.selected.index];
    if ( !s ) return null;
    return (this.selected.edge === "start") ? s.start : this.#end(s);
  }

  /** Move the selected marker, keeping its section at least 50 ms long and inside the file. */
  #setMarker(time) {
    const s = this.sections[this.selected.index];
    if ( !s ) return;
    const limit = this.duration ?? Infinity;
    if ( this.selected.edge === "start" ) s.start = Math.max(0, Math.min(time, this.#end(s) - 0.05));
    else {
      const end = Math.min(limit, Math.max(time, s.start + 0.05));
      s.end = (end >= limit - 0.0005) ? null : end;
    }
    this.#syncInputs(this.selected.index);
    this.#draw();
  }

  #syncInputs(i) {
    const s = this.sections[i];
    const start = this.element?.querySelector(`input[name="start-${i}"]`);
    const end = this.element?.querySelector(`input[name="end-${i}"]`);
    if ( start ) start.value = s.start.toFixed(3);
    if ( end ) end.value = (s.end === null) ? "" : s.end.toFixed(3);
  }

  #onChange(event) {
    const el = event.target;
    if ( el.name === "seam" ) {
      this.seam = Math.min(4, Math.max(0, Number(el.value) || 0));
      return;
    }
    const m = /^(label|start|end|loop)-(\d+)$/.exec(el.name ?? "");
    const s = m && this.sections[Number(m[2])];
    if ( !s ) return;
    if ( m[1] === "label" ) s.label = el.value.slice(0, 40);
    else if ( m[1] === "loop" ) s.loop = el.checked;
    else if ( m[1] === "start" ) s.start = Math.max(0, Number(el.value) || 0);
    else s.end = (el.value === "") ? null : Math.max(s.start + 0.05, Number(el.value) || 0);
    this.selected = { index: Number(m[2]), edge: (m[1] === "end") ? "end" : "start" };
    this.#draw();
  }

  /** Time under the pointer on one of the canvases. */
  #timeAt(event, canvas) {
    const box = canvas.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    if ( canvas.classList.contains("dsg-zoom") ) {
      const center = this.#markerTime() ?? this.cursor;
      return (center - ZOOM_SPAN) + (fraction * 2 * ZOOM_SPAN);
    }
    return fraction * (this.duration ?? 0);
  }

  #onPointerDown(event) {
    const canvas = event.target.closest?.("canvas");
    if ( !canvas || !this.duration ) return;
    const time = this.#timeAt(event, canvas);
    if ( canvas.classList.contains("dsg-zoom") ) {
      if ( this.sections[this.selected.index] ) {
        this.#drag = { canvas, origin: time - this.#markerTime() };
        canvas.setPointerCapture(event.pointerId);
      }
      return;
    }
    // Grab the nearest marker within a few pixels; otherwise move the preview cursor there
    const perPixel = this.duration / canvas.clientWidth;
    let best = null;
    for ( const [index, s] of this.sections.entries() ) {
      for ( const edge of ["start", "end"] ) {
        const distance = Math.abs(((edge === "start") ? s.start : this.#end(s)) - time) / perPixel;
        if ( (distance <= GRAB_PX) && (!best || (distance < best.distance)) ) best = { index, edge, distance };
      }
    }
    if ( best ) {
      this.selected = { index: best.index, edge: best.edge };
      this.#drag = { canvas, origin: 0 };
      canvas.setPointerCapture(event.pointerId);
      this.#highlightRow();
    }
    else this.cursor = time;
    this.#draw();
  }

  #onPointerMove(event) {
    if ( !this.#drag ) return;
    const time = this.#timeAt(event, this.#drag.canvas) - this.#drag.origin;
    this.#setMarker(time);
  }

  #highlightRow() {
    for ( const row of this.element.querySelectorAll("tr[data-index]") ) {
      row.classList.toggle("dsg-selected", Number(row.dataset.index) === this.selected.index);
    }
  }

  static #onSelect(event, target) {
    if ( event.target.closest("input, a") ) return;
    this.selected = { index: Number(target.dataset.index), edge: "start" };
    this.#highlightRow();
    this.#draw();
  }

  static #onSetStart(event, target) {
    this.selected = { index: Number(target.dataset.index), edge: "start" };
    this.#setMarker(this.cursor);
    this.#highlightRow();
  }

  static #onSetEnd(event, target) {
    this.selected = { index: Number(target.dataset.index), edge: "end" };
    this.#setMarker(this.cursor);
    this.#highlightRow();
  }

  static #onRemove(event, target) {
    this.sections.splice(Number(target.dataset.index), 1);
    this.selected = { index: Math.max(0, Math.min(this.selected.index, this.sections.length - 1)), edge: "start" };
    this.render();
  }

  static #onUp(event, target) {
    const i = Number(target.dataset.index);
    if ( i < 1 ) return;
    [this.sections[i - 1], this.sections[i]] = [this.sections[i], this.sections[i - 1]];
    this.selected = { index: i - 1, edge: "start" };
    this.render();
  }

  static #onDown(event, target) {
    const i = Number(target.dataset.index);
    if ( i >= this.sections.length - 1 ) return;
    [this.sections[i + 1], this.sections[i]] = [this.sections[i], this.sections[i + 1]];
    this.selected = { index: i + 1, edge: "start" };
    this.render();
  }

  static #onAdd() {
    const last = this.sections.at(-1);
    const start = last ? Math.min(this.#end(last), Math.max(0, (this.duration ?? 10) - 1)) : this.cursor;
    const end = Math.min(this.duration ?? (start + 10), start + 10);
    this.sections.push({ label: "", start, end: (end >= (this.duration ?? Infinity)) ? null : end, loop: false });
    this.selected = { index: this.sections.length - 1, edge: "start" };
    this.render();
  }

  static #onPreset(event, target) {
    const d = this.duration;
    const name = key => game.i18n.localize(key);
    switch ( target.dataset.preset ) {
      case "ilo":
        if ( !d ) return;
        this.sections = [
          { label: name("DALSEGNO.Editor.Intro"), start: 0, end: +(d * 0.15).toFixed(3), loop: false },
          { label: name("DALSEGNO.Editor.Loop"), start: +(d * 0.15).toFixed(3), end: +(d * 0.85).toFixed(3), loop: true },
          { label: name("DALSEGNO.Editor.Ending"), start: +(d * 0.85).toFixed(3), end: null, loop: false }
        ];
        ui.notifications.info(game.i18n.localize("DALSEGNO.Editor.PresetAdjust"));
        break;
      case "loop":
        this.sections = [{ label: name("DALSEGNO.Editor.Loop"), start: 0, end: null, loop: true }];
        break;
      case "clear":
        this.sections = [];
        break;
    }
    this.selected = { index: 0, edge: "start" };
    this.render();
  }

  static #onNudge(event, target) {
    const time = this.#markerTime();
    if ( time === null ) return;
    // Shift for a tenth of the step (1 or 10 ms)
    const amount = Number(target.dataset.amount) * (event.shiftKey ? 0.1 : 1);
    this.#setMarker(time + amount);
  }

  static #onMatch() {
    const s = this.sections[this.selected.index];
    if ( !s || !this.samples ) return;
    if ( !s.loop ) {
      ui.notifications.warn(game.i18n.localize("DALSEGNO.Editor.MatchNeedsLoop"));
      return;
    }
    const { end, score } = matchLoopEnd(this.samples, RATE, s.start, this.#end(s));
    this.selected = { index: this.selected.index, edge: "end" };
    this.#setMarker(end);
    ui.notifications.info(game.i18n.format("DALSEGNO.Editor.Matched", { end: end.toFixed(3), score: Math.round(score * 100) }));
  }

  /* -------------------------------------------- */
  /*  Preview (this computer only)                */
  /* -------------------------------------------- */

  /** The sections as they stand, as an arrangement, or null for the whole file. */
  #arrangement() {
    const L = this.#logic;
    return L.arrangement.normalizeArrangement({ sections: this.sections, seam: this.seam }, this.duration ?? undefined);
  }

  async #startPreview(from) {
    const L = this.#logic;
    this.#preview ??= await api.createEngine(() => {});
    const track = { src: this.sound.path, name: this.sound.name, duration: this.duration, arrangement: this.#arrangement() };
    let deck = L.deck.normalizeDeck({ track, volume: 1, fade: 0 });
    const arr = L.deck.trackArrangement(deck.track);
    const now = game.time.serverTime;
    const parked = L.transport.seek(deck.transport, arr, this.duration ?? undefined, now, 0, from);
    deck = { ...deck, transport: L.transport.play(parked, arr, this.duration ?? undefined, now, 150) };
    this.#previewDeck = deck;
    await this.#preview.apply(deck);
    clearInterval(this.#previewTimer);
    this.#previewTimer = setInterval(() => {
      const p = L.transport.positionAt(deck.transport, arr, this.duration ?? undefined, game.time.serverTime);
      if ( p.ended ) return this.#stopPreview();
      this.#draw(p.pos);
    }, PREVIEW_TICK);
    this.render();
  }

  #stopPreview(rerender = true) {
    clearInterval(this.#previewTimer);
    this.#previewTimer = null;
    if ( this.#preview && this.#previewDeck ) {
      const L = this.#logic;
      const arr = L.deck.trackArrangement(this.#previewDeck.track);
      this.#preview.apply({ ...this.#previewDeck, transport: L.transport.stopped(arr, game.time.serverTime) });
    }
    if ( rerender && this.rendered ) this.render();
  }

  static #onPreview() {
    return this.#startPreview(this.cursor);
  }

  static #onSeam() {
    // The selected section if it loops, else the first that does: start three seconds before it goes round
    const loop = this.sections[this.selected.index]?.loop ? this.sections[this.selected.index] : this.sections.find(s => s.loop);
    if ( !loop ) {
      ui.notifications.warn(game.i18n.localize("DALSEGNO.Editor.MatchNeedsLoop"));
      return;
    }
    return this.#startPreview(Math.max(loop.start, this.#end(loop) - 3));
  }

  static #onStopPreview() {
    this.#stopPreview();
  }

  /* -------------------------------------------- */
  /*  Saving                                      */
  /* -------------------------------------------- */

  async #save() {
    const arr = this.#arrangement();
    const data = arr ? { sections: arr.sections, seam: arr.seam, duration: this.duration ?? null } : null;
    await api.saveArrangement(this.sound, data);
    ui.notifications.info(game.i18n.format(arr ? "DALSEGNO.Editor.Saved" : "DALSEGNO.Editor.Cleared", { name: this.sound.name }));
    return data;
  }

  static #onSave() {
    return this.#save();
  }

  static async #onSavePlay() {
    await this.#save();
    this.#stopPreview(false);
    return api.load(this.sound, { play: true });
  }

  static #onRevert() {
    this.#reset();
    this.render();
  }
}
