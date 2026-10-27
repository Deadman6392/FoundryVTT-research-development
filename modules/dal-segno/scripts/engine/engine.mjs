/**
 * One deck's sound on this client. The entry point imports this file the first time a deck has something to play,
 * so a client that never hears the deck never downloads the engine.
 *
 * Everything outside the browser's audio API is passed in (the server clock, where sound goes, how a path becomes a
 * URL), so the same engine runs in Foundry and in a plain test page.
 */
import { chooseVoice, pitchRatio } from "../lib/deck.mjs";
import { BufferVoice } from "./buffer-voice.mjs";
import { StreamVoice } from "./stream-voice.mjs";
import { FxChain } from "./fx.mjs";

export class Engine {
  /**
   * @param {object} options
   * @param {() => number} options.serverNow                  The shared clock, in milliseconds
   * @param {(channel: string) => Promise<{ctx: AudioContext, destination: AudioNode}>} options.output
   * @param {(src: string) => string} options.resolve          A track path to a URL
   * @param {string} options.workletUrl                        URL of pitch-processor.mjs
   * @param {() => {precise: boolean, lite: boolean}} options.prefs   This computer's playback choices
   * @param {(kind: string, detail?: any) => void} [options.onStatus]
   */
  constructor({ serverNow, output, resolve, workletUrl, prefs, onStatus }) {
    this.serverNow = serverNow;
    this.output = output;
    this.resolve = resolve;
    this.workletUrl = workletUrl;
    this.prefs = prefs;
    this.onStatus = onStatus ?? (() => {});
    this.ctx = null;
    this.fx = null;
    this.voice = null;
    this.deck = null;
    this.status = "idle";
    this.token = 0;
  }

  report(status, detail) {
    this.status = status;
    this.onStatus(status, detail);
  }

  /**
   * Server time to the audio-context time at which a sample must be scheduled to be heard then. Accounts for the
   * sound card's output latency, so a player on Bluetooth headphones hears the same moment as everyone else, and for
   * the effect chain's own delay. Uses the context's reported output latency where the browser gives one (Chromium,
   * Firefox); otherwise its output timestamp, which in headless Chromium was up to 150 ms stale for a while after the
   * context started, so it is only the fallback.
   */
  toContext(serverMs) {
    const ctx = this.ctx;
    const serverNow = this.serverNow();
    let heard = ctx.currentTime - (ctx.outputLatency || 0);
    if ( !ctx.outputLatency ) {
      const stamp = ctx.getOutputTimestamp?.();
      if ( stamp?.performanceTime > 0 ) heard = stamp.contextTime + ((performance.now() - stamp.performanceTime) / 1000);
      else heard -= ctx.baseLatency || 0;
    }
    return heard + ((serverMs - serverNow) / 1000) - (this.fx?.latency ?? 0);
  }

  /**
   * Make this client's sound match a deck. Safe to call with every change; only what changed is touched.
   * @param {object} deck   A normalized deck
   */
  async apply(deck) {
    const token = ++this.token;
    this.deck = deck;
    const track = deck.track;
    if ( !track ) {
      this.#drop(deck.fade);
      this.report("idle");
      return;
    }
    const prefs = this.prefs();
    const kind = chooseVoice(track, { precise: prefs.precise });
    const { ctx, destination } = await this.output(track.channel);
    if ( token !== this.token ) return;
    if ( ctx !== this.ctx ) {
      this.#drop(0);
      this.fx?.dispose();
      this.ctx = ctx;
      this.fx = new FxChain(ctx, destination, { workletUrl: this.workletUrl, lite: prefs.lite });
    }
    this.fx.lite = prefs.lite;

    if ( !this.voice || (this.voice.src !== track.src) || (this.voice.kind !== kind) ) {
      const previous = this.voice;
      const audible = Boolean(previous?.active);
      this.voice = this.#create(kind, track);
      this.report("loading");
      try {
        await this.voice.load();
      } catch(err) {
        if ( token !== this.token ) return;
        if ( kind !== "buffer" ) {
          this.voice = null;
          previous?.release(deck.fade);
          this.report("error", err?.message ?? String(err));
          return;
        }
        // Couldn't decode (an unusual codec, or not enough memory): stream it instead
        console.warn("Dal Segno | Decoding failed, streaming instead.", err);
        this.voice = this.#create("stream", track);
        try {
          await this.voice.load();
        } catch(err2) {
          if ( token !== this.token ) return;
          this.voice = null;
          this.report("error", err2?.message ?? String(err2));
          return;
        }
      }
      if ( token !== this.token ) return;
      // A new track starts a little in the future so every client can load it; the old one plays on until then and
      // the two crossfade at that moment
      const playing = deck.transport.status === "playing";
      const startsIn = playing ? Math.max(0, deck.transport.at - this.serverNow()) : 0;
      if ( previous ) {
        const fade = audible ? deck.fade : 0.05;
        if ( audible && (startsIn > 0) ) setTimeout(() => previous.release(fade), startsIn);
        else previous.release(fade);
      }
      if ( audible && playing ) this.voice.fadeIn(deck.fade, this.toContext(Math.max(deck.transport.at, this.serverNow())));
    }
    else await this.voice.load();
    if ( token !== this.token ) return;

    await this.fx.set(deck.fx, { ratio: pitchRatio(deck.fx, deck.transport.rate, this.voice.kind), volume: deck.volume });
    if ( token !== this.token ) return;
    this.voice.sync(deck);
    this.report(deck.transport.status === "playing" ? "playing" : "ready", { kind: this.voice.kind, duration: this.voice.duration });
  }

  #create(kind, track) {
    const Kind = (kind === "buffer") ? BufferVoice : StreamVoice;
    return new Kind(this, track);
  }

  #drop(fade) {
    this.voice?.release(fade);
    this.voice = null;
  }

  /** Stop and free everything (the module was turned off, or the page is closing). */
  dispose() {
    this.token++;
    this.#drop(0.05);
    setTimeout(() => this.fx?.dispose(), 200);
  }
}
