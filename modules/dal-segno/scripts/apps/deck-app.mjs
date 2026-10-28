/**
 * The GM's deck: pick a track from the world's playlists, play it for everyone, move between its sections, seek,
 * change speed, pitch and effects. Loaded on demand.
 *
 * Every control writes the deck once, when it is released (a slider's change, not each step of a drag), because a
 * write goes to every client. While the window is open and something plays, one timer moves the clock and playhead
 * once a second; a CSS transition glides the playhead between ticks without any script.
 */
import { MODULE_ID } from "../constants.mjs";
import { clock, esc, injectStyle } from "./style.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** Where this GM's choice of jump timing is remembered, on this computer only. */
const TIMING_KEY = `${MODULE_ID}.timing`;

let api;

export class DeckApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-deck`,
    classes: ["dal-segno-app", "dal-segno-deck"],
    window: { title: "DALSEGNO.Deck.Title", icon: "fa-solid fa-compact-disc", resizable: true },
    position: { width: 470, height: "auto" },
    actions: {
      toggle: DeckApp.#onToggle,
      stop: DeckApp.#onStop,
      restart: DeckApp.#onRestart,
      next: DeckApp.#onNext,
      ending: DeckApp.#onEnding,
      cancel: DeckApp.#onCancel,
      goto: DeckApp.#onGoto,
      seek: DeckApp.#onSeek,
      cue: DeckApp.#onCue,
      start: DeckApp.#onStart,
      edit: DeckApp.#onEdit,
      editCurrent: DeckApp.#onEditCurrent,
      resetFx: DeckApp.#onResetFx,
      shrink: DeckApp.#onShrink
    }
  };

  static #instance;

  /** Open (or bring forward) the deck. */
  static open(moduleApi) {
    api = moduleApi;
    if ( !api.canControl() ) return null;
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  /** Playlist shown in the library, and the text filtering it. */
  playlistId = null;

  filter = "";

  timing = DeckApp.#storedTiming();

  #hooks = [];

  #ticker = null;

  #logic = null;

  static #storedTiming() {
    try {
      return (globalThis.localStorage?.getItem(TIMING_KEY) === "now") ? "now" : "boundary";
    } catch {
      return "boundary";
    }
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _renderHTML() {
    injectStyle();
    this.#logic ??= await api.loadLogic();
    const t = key => esc(game.i18n.localize(key));
    const deck = api.deck;
    const track = deck?.track ?? null;
    this.playlistId ??= track?.playlist ?? game.playlists.find(p => p.sounds.size)?.id ?? null;
    return `${this.#libraryHTML(t, track)}
      ${track ? this.#nowHTML(t, deck) : `<p class="dsg-hint">${t("DALSEGNO.Deck.Empty")}</p>`}
      ${deck ? this.#soundHTML(t, deck) : ""}
      <footer class="dsg-row">
        <span class="dsg-grow dsg-hint">${t("DALSEGNO.Deck.Keys")}</span>
        <button type="button" data-action="shrink" class="dsg-grow"><i class="fa-solid fa-file-zipper"></i> ${t("DALSEGNO.Deck.Shrink")}</button>
      </footer>`;
  }

  #libraryHTML(t, track) {
    const playlists = game.playlists.contents.filter(p => p.sounds.size)
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    const options = playlists.map(p => `<option value="${p.id}"${p.id === this.playlistId ? " selected" : ""}>${esc(p.name)}</option>`).join("");
    const playlist = game.playlists.get(this.playlistId);
    const order = playlist?.playbackOrder ?? [];
    const sounds = playlist ? [...playlist.sounds].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : [];
    const rows = sounds.map(sound => {
      const current = (track?.sound === sound.id) && (track?.playlist === playlist.id);
      const arranged = Boolean(sound.getFlag(MODULE_ID, "arrangement"));
      return `<li data-action="cue" data-sound-id="${sound.id}" class="${current ? "dsg-current" : ""}" data-tooltip="${t("DALSEGNO.Deck.CueHint")}">
          <span class="dsg-name">${esc(sound.name)}</span>
          ${arranged ? `<i class="fa-solid fa-sliders dsg-muted" data-tooltip="${t("DALSEGNO.Sidebar.Arranged")}"></i>` : ""}
          <a data-action="edit" data-sound-id="${sound.id}" aria-label="${t("DALSEGNO.Deck.Edit")}" data-tooltip="${t("DALSEGNO.Deck.Edit")}"><i class="fa-solid fa-scissors"></i></a>
          <a data-action="start" data-sound-id="${sound.id}" aria-label="${t("DALSEGNO.Deck.PlayNow")}" data-tooltip="${t("DALSEGNO.Deck.PlayNow")}"><i class="fa-solid fa-play"></i></a>
        </li>`;
    }).join("");
    return `<section class="dsg-panel">
        <div class="dsg-row">
          <select name="playlist" class="dsg-grow" aria-label="${t("DALSEGNO.Deck.Playlist")}">${options}</select>
          <input type="search" name="filter" class="dsg-grow" placeholder="${t("DALSEGNO.Deck.Filter")}" aria-label="${t("DALSEGNO.Deck.Filter")}">
        </div>
        <ol class="dsg-tracks">${rows || `<li class="dsg-muted">${t("DALSEGNO.Deck.NoSounds")}</li>`}</ol>
      </section>`;
  }

  #nowHTML(t, deck) {
    const L = this.#logic;
    const track = deck.track;
    const arr = L.deck.trackArrangement(track);
    const status = api.status;
    const badge = (status.status === "loading") ? t("DALSEGNO.Deck.Loading")
      : (status.status === "error") ? t("DALSEGNO.Deck.Error")
        : (status.detail?.kind === "buffer") ? t("DALSEGNO.Deck.Precise")
          : (status.detail?.kind === "stream") ? t("DALSEGNO.Deck.Streamed") : "";
    const badgeHint = (status.status === "error") ? esc(status.detail ?? "")
      : (status.detail?.kind === "buffer") ? t("DALSEGNO.Deck.PreciseHint") : t("DALSEGNO.Deck.StreamedHint");
    const chips = (arr.sections.length > 1) || arr.sections[0].loop ? arr.sections.map((s, i) => {
      const label = esc(s.label || game.i18n.format("DALSEGNO.Deck.Section", { n: i + 1 }));
      return `<button type="button" class="dsg-chip" data-action="goto" data-index="${i}" data-tooltip="${t("DALSEGNO.Deck.GotoHint")}">`
        + `${label}${s.loop ? " <i class=\"fa-solid fa-repeat\"></i>" : ""}</button>`;
    }).join("") : "";
    const duration = api.duration;
    const regions = Number.isFinite(duration) ? arr.sections.map((s, i) => {
      const end = L.arrangement.sectionEnd(s, duration);
      const left = (s.start / duration) * 100;
      const width = ((end - s.start) / duration) * 100;
      const label = esc(s.label || (i + 1));
      return `<div class="dsg-region${s.loop ? " dsg-loop" : ""}" style="left:${left}%;width:${width}%"><span>${label}</span></div>`;
    }).join("") : "";
    const playing = deck.transport.status === "playing";
    const hasJump = Boolean(deck.transport.jump) && (deck.transport.jump.at > game.time.serverTime);
    const last = arr.sections.length - 1;
    return `<section class="dsg-panel">
        <div class="dsg-row">
          <span class="dsg-title dsg-grow">${esc(track.name)}</span>
          <span class="dsg-badge${(status.status === "error") ? " dsg-error" : ""}" data-tooltip="${badgeHint}">${badge}</span>
          <button type="button" class="dsg-icon" data-action="editCurrent" aria-label="${t("DALSEGNO.Deck.Edit")}" data-tooltip="${t("DALSEGNO.Deck.Edit")}"><i class="fa-solid fa-scissors"></i></button>
        </div>
        <div class="dsg-chips">${chips}</div>
        <div class="dsg-timeline" data-action="seek" data-tooltip="${t("DALSEGNO.Deck.SeekHint")}">${regions}<div class="dsg-playhead"></div></div>
        <div class="dsg-row">
          <span class="dsg-time dsg-grow"></span>
          <select name="timing" aria-label="${t("DALSEGNO.Deck.Timing")}" data-tooltip="${t("DALSEGNO.Deck.TimingHint")}">
            <option value="boundary"${this.timing === "boundary" ? " selected" : ""}>${t("DALSEGNO.Deck.AtBoundary")}</option>
            <option value="now"${this.timing === "now" ? " selected" : ""}>${t("DALSEGNO.Deck.Now")}</option>
          </select>
        </div>
        <div class="dsg-row dsg-transport">
          <button type="button" class="dsg-icon" data-action="restart" aria-label="${t("DALSEGNO.Deck.Restart")}" data-tooltip="${t("DALSEGNO.Deck.Restart")}"><i class="fa-solid fa-backward-step"></i></button>
          <button type="button" class="dsg-icon dsg-big" data-action="toggle" aria-label="${t(playing ? "DALSEGNO.Deck.Pause" : "DALSEGNO.Deck.Play")}" data-tooltip="${t(playing ? "DALSEGNO.Deck.Pause" : "DALSEGNO.Deck.Play")}"><i class="fa-solid ${playing ? "fa-pause" : "fa-play"}"></i></button>
          <button type="button" class="dsg-icon" data-action="stop" aria-label="${t("DALSEGNO.Deck.Stop")}" data-tooltip="${t("DALSEGNO.Deck.Stop")}"><i class="fa-solid fa-stop"></i></button>
          <button type="button" class="dsg-icon" data-action="next" aria-label="${t("DALSEGNO.Deck.Next")}" data-tooltip="${t("DALSEGNO.Deck.NextHint")}"${last ? "" : " disabled"}><i class="fa-solid fa-forward-step"></i></button>
          <button type="button" class="dsg-icon" data-action="ending" aria-label="${t("DALSEGNO.Deck.Ending")}" data-tooltip="${t("DALSEGNO.Deck.EndingHint")}"${last ? "" : " disabled"}><i class="fa-solid fa-flag-checkered"></i></button>
          ${hasJump ? `<button type="button" class="dsg-icon" data-action="cancel" aria-label="${t("DALSEGNO.Deck.Cancel")}" data-tooltip="${t("DALSEGNO.Deck.Cancel")}"><i class="fa-solid fa-xmark"></i></button>` : ""}
        </div>
      </section>`;
  }

  #soundHTML(t, deck) {
    const fx = deck.fx;
    const slider = (name, label, value, min, max, step, shown) => `<label for="${MODULE_ID}-${name}">${t(label)}</label>
      <input type="range" id="${MODULE_ID}-${name}" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}">
      <output data-for="${name}">${shown}</output>`;
    const st = v => `${(v > 0) ? "+" : ""}${v}`;
    return `<details class="dsg-panel"${this.fxOpen ? " open" : ""} data-section="fx">
        <summary>${t("DALSEGNO.Deck.Sound")}</summary>
        <div class="dsg-sliders">
          ${slider("rate", "DALSEGNO.Fx.Rate", deck.transport.rate, 0.5, 2, 0.01, `${deck.transport.rate.toFixed(2)}×`)}
          <span></span><label class="dsg-row"><input type="checkbox" name="keepPitch"${fx.keepPitch ? " checked" : ""}> ${t("DALSEGNO.Fx.KeepPitch")}</label><span></span>
          ${slider("pitch", "DALSEGNO.Fx.Pitch", fx.pitch, -12, 12, 0.5, st(fx.pitch))}
          ${slider("bass", "DALSEGNO.Fx.Bass", fx.bass, -12, 12, 1, `${st(fx.bass)} dB`)}
          ${slider("treble", "DALSEGNO.Fx.Treble", fx.treble, -12, 12, 1, `${st(fx.treble)} dB`)}
          ${slider("muffle", "DALSEGNO.Fx.Muffle", fx.muffle, 0, 1, 0.05, `${Math.round(fx.muffle * 100)}%`)}
          ${slider("reverb", "DALSEGNO.Fx.Reverb", fx.reverb, 0, 1, 0.05, `${Math.round(fx.reverb * 100)}%`)}
        </div>
        <p class="dsg-hint">${t("DALSEGNO.Fx.Hint")}</p>
        <div class="dsg-row"><button type="button" data-action="resetFx"><i class="fa-solid fa-rotate-left"></i> ${t("DALSEGNO.Fx.Reset")}</button></div>
      </details>
      <details class="dsg-panel"${this.optionsOpen ? " open" : ""} data-section="options">
        <summary>${t("DALSEGNO.Deck.Options")}</summary>
        <div class="dsg-sliders">
          ${slider("volume", "DALSEGNO.Deck.Volume", deck.volume, 0, 1, 0.01, `${Math.round(deck.volume * 100)}%`)}
          ${slider("fade", "DALSEGNO.Deck.Fade", deck.fade, 0, 6, 0.5, `${deck.fade} s`)}
        </div>
        <label class="dsg-row"><input type="checkbox" name="autoNext"${deck.autoNext ? " checked" : ""}> ${t("DALSEGNO.Deck.AutoNext")}</label>
        <label class="dsg-row"><input type="checkbox" name="loopQueue"${deck.loopQueue ? " checked" : ""}> ${t("DALSEGNO.Deck.LoopQueue")}</label>
      </details>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    if ( this.filter ) {
      const input = content.querySelector("input[name=\"filter\"]");
      if ( input ) input.value = this.filter;
      this.#filter(this.filter);
    }
    this.#tick(true);
  }

  #filter(text) {
    const needle = text.trim().toLowerCase();
    for ( const li of this.element?.querySelectorAll(".dsg-tracks li[data-sound-id]") ?? [] ) {
      li.hidden = Boolean(needle) && !li.querySelector(".dsg-name")?.textContent.toLowerCase().includes(needle);
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#hooks = [
      ["dalSegno.deckChanged", Hooks.on("dalSegno.deckChanged", () => this.render())],
      ["dalSegno.status", Hooks.on("dalSegno.status", () => this.render())]
    ];
    this.element.addEventListener("change", event => this.#onChange(event));
    this.element.addEventListener("input", event => this.#onInput(event));
    this.element.addEventListener("toggle", event => {
      const section = event.target.dataset?.section;
      if ( section === "fx" ) this.fxOpen = event.target.open;
      if ( section === "options" ) this.optionsOpen = event.target.open;
    }, true);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const playing = api.deck?.transport.status === "playing";
    if ( playing && !this.#ticker ) this.#ticker = setInterval(() => this.#tick(), 1000);
    if ( !playing && this.#ticker ) {
      clearInterval(this.#ticker);
      this.#ticker = null;
    }
  }

  _onClose(options) {
    super._onClose(options);
    for ( const [hook, id] of this.#hooks ) Hooks.off(hook, id);
    this.#hooks = [];
    clearInterval(this.#ticker);
    this.#ticker = null;
  }

  /** Move the clock, playhead and current-section mark to now. */
  #tick(jump = false) {
    const root = this.element;
    const deck = api.deck;
    if ( !root || !deck?.track || !this.#logic ) return;
    const L = this.#logic;
    const arr = L.deck.trackArrangement(deck.track);
    const duration = api.duration;
    const now = game.time.serverTime;
    const p = L.transport.positionAt(deck.transport, arr, duration, now);
    const time = root.querySelector(".dsg-time");
    if ( time ) {
      const section = arr.sections[p.section];
      const name = section?.label || game.i18n.format("DALSEGNO.Deck.Section", { n: p.section + 1 });
      let text = `${clock(p.pos)} / ${clock(duration)}${(arr.sections.length > 1) || section?.loop ? ` · ${name}` : ""}`;
      const jump = deck.transport.jump;
      if ( jump && (jump.at > now) ) {
        const target = arr.sections[jump.section]?.label || game.i18n.format("DALSEGNO.Deck.Section", { n: jump.section + 1 });
        text += ` → ${target} ${game.i18n.format("DALSEGNO.Deck.In", { seconds: Math.ceil((jump.at - now) / 1000) })}`;
      }
      time.textContent = text;
    }
    for ( const chip of root.querySelectorAll(".dsg-chip") ) {
      const i = Number(chip.dataset.index);
      chip.classList.toggle("dsg-here", i === p.section);
      chip.classList.toggle("dsg-next", Boolean(deck.transport.jump && (deck.transport.jump.at > now) && (deck.transport.jump.section === i)));
    }
    const line = root.querySelector(".dsg-timeline");
    const head = root.querySelector(".dsg-playhead");
    if ( line && head && Number.isFinite(duration) ) {
      const x = (p.pos / duration) * line.clientWidth;
      const previous = Number(head.dataset.x ?? 0);
      // Glide forwards between ticks; snap when the playhead goes back (a loop going round) or on a redraw
      head.classList.toggle("dsg-glide", !jump && (x >= previous) && (deck.transport.status === "playing"));
      const ahead = (deck.transport.status === "playing") ? ((deck.transport.rate / duration) * line.clientWidth) : 0;
      head.style.setProperty("--dsg-x", `${Math.min(line.clientWidth, x + (head.classList.contains("dsg-glide") ? ahead : 0))}px`);
      head.dataset.x = String(x);
    }
  }

  /* -------------------------------------------- */
  /*  Controls                                    */
  /* -------------------------------------------- */

  #onInput(event) {
    const el = event.target;
    if ( el.name === "filter" ) {
      this.filter = el.value;
      this.#filter(el.value);
      return;
    }
    const out = this.element.querySelector(`output[data-for="${el.name}"]`);
    if ( !out ) return;
    const v = Number(el.value);
    const signed = `${(v > 0) ? "+" : ""}${v}`;
    out.textContent = { rate: `${v.toFixed(2)}×`, pitch: signed, bass: `${signed} dB`, treble: `${signed} dB`,
      muffle: `${Math.round(v * 100)}%`, reverb: `${Math.round(v * 100)}%`, volume: `${Math.round(v * 100)}%`, fade: `${v} s` }[el.name] ?? el.value;
  }

  #onChange(event) {
    const el = event.target;
    const value = (el.type === "checkbox") ? el.checked : Number(el.value);
    switch ( el.name ) {
      case "playlist":
        this.playlistId = el.value;
        return this.render();
      case "timing":
        this.timing = (el.value === "now") ? "now" : "boundary";
        try {
          globalThis.localStorage?.setItem(TIMING_KEY, this.timing);
        } catch {}
        return;
      case "rate": return api.setRate(value);
      case "keepPitch": case "pitch": case "bass": case "treble": case "muffle": case "reverb":
        return api.setFx({ [el.name]: value });
      case "volume": case "fade": case "autoNext": case "loopQueue":
        return api.configure({ [el.name]: value });
    }
  }

  #sound(target) {
    return game.playlists.get(this.playlistId)?.sounds.get(target.closest("[data-sound-id]")?.dataset.soundId) ?? null;
  }

  static #onToggle() {
    return api.toggle();
  }

  static #onStop() {
    return api.stop();
  }

  static async #onRestart() {
    const L = this.#logic;
    const track = api.deck?.track;
    if ( !track ) return;
    return api.seek(L.deck.trackArrangement(track).sections[0].start);
  }

  static #onNext(event) {
    return api.next({ now: event.shiftKey || (this.timing === "now") });
  }

  static #onEnding(event) {
    return api.ending({ now: event.shiftKey || (this.timing === "now") });
  }

  static #onCancel() {
    return api.cancel();
  }

  static #onGoto(event, target) {
    return api.goto(Number(target.dataset.index), { now: event.shiftKey || (this.timing === "now") });
  }

  static #onSeek(event, target) {
    const duration = api.duration;
    if ( !Number.isFinite(duration) ) return;
    const box = target.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    return api.seek(fraction * duration);
  }

  static #onCue(event, target) {
    const sound = this.#sound(target);
    if ( sound ) return api.load(sound, { play: event.shiftKey });
  }

  static #onStart(event, target) {
    event.stopPropagation();
    const sound = this.#sound(target);
    if ( sound ) return api.load(sound, { play: true });
  }

  static #onEdit(event, target) {
    event.stopPropagation();
    const sound = this.#sound(target);
    if ( sound ) return api.openEditor(sound);
  }

  static #onEditCurrent() {
    const track = api.deck?.track;
    const sound = game.playlists.get(track?.playlist)?.sounds.get(track?.sound);
    if ( sound ) return api.openEditor(sound);
    ui.notifications.info(game.i18n.localize("DALSEGNO.Deck.NotInPlaylist"));
  }

  static #onResetFx() {
    return api.resetSound();
  }

  static #onShrink() {
    return api.openShrink();
  }
}
