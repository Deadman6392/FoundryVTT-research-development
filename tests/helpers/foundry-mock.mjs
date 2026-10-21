/**
 * A deliberately small stand-in for the parts of Foundry VTT this repository's modules touch.
 * It mirrors Foundry's observable behavior where it matters (client settings stored in localStorage as JSON strings,
 * hooks called in registration order, Hooks.events exposing {hook, id, fn, once} entries) and nothing more.
 */

/** Create an independent Hooks class; each has its own listener registry, like Foundry's single global one. */
export function createMockHooks() {
  let events = {};
  let ids = 0;
  return class Hooks {
    static get events() {
      return events;
    }

    static on(hook, fn, { once = false } = {}) {
      const id = ++ids;
      (events[hook] ??= []).push({ hook, id, fn, once });
      return id;
    }

    static once(hook, fn) {
      return this.on(hook, fn, { once: true });
    }

    static off(hook, fn) {
      const entries = events[hook];
      if ( !entries ) return;
      const i = entries.findIndex(e => (typeof fn === "number" ? e.id === fn : e.fn === fn));
      if ( i >= 0 ) entries.splice(i, 1);
    }

    static callAll(hook, ...args) {
      for ( const entry of [...(events[hook] ?? [])] ) {
        if ( entry.once ) this.off(hook, entry.id);
        entry.fn(...args);
      }
      return true;
    }

    static call(hook, ...args) {
      for ( const entry of [...(events[hook] ?? [])] ) {
        if ( entry.once ) this.off(hook, entry.id);
        if ( entry.fn(...args) === false ) return false;
      }
      return true;
    }

    static reset() {
      events = {};
    }
  };
}

export class MemoryStorage {
  #map = new Map();
  get length() { return this.#map.size; }
  key(i) { return [...this.#map.keys()][i] ?? null; }
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}

class MockSettings {
  constructor(localStorage) {
    this.settings = new Map();
    this.menus = new Map();
    this.world = new Map();
    this.storage = new Map([["client", localStorage]]);
  }

  register(ns, key, config) {
    this.settings.set(`${ns}.${key}`, { ...config, namespace: ns, key });
  }

  registerMenu(ns, key, config) {
    this.menus.set(`${ns}.${key}`, config);
  }

  get(ns, key) {
    const id = `${ns}.${key}`;
    const config = this.settings.get(id);
    if ( !config ) throw new Error(`"${id}" is not a registered game setting`);
    if ( config.scope === "client" ) {
      const raw = this.storage.get("client").getItem(id);
      return raw === null ? structuredClone(config.default) : JSON.parse(raw);
    }
    return this.world.has(id) ? structuredClone(this.world.get(id)) : structuredClone(config.default);
  }

  async set(ns, key, value) {
    const id = `${ns}.${key}`;
    const config = this.settings.get(id);
    if ( !config ) throw new Error(`"${id}" is not a registered game setting`);
    if ( config.scope === "client" ) this.storage.get("client").setItem(id, JSON.stringify(value));
    else this.world.set(id, structuredClone(value));
    config.onChange?.(value);
    return value;
  }
}

function expandObject(obj) {
  const out = {};
  for ( const [k, v] of Object.entries(obj) ) {
    const parts = k.split(".");
    let target = out;
    for ( const p of parts.slice(0, -1) ) target = target[p] ??= {};
    target[parts.at(-1)] = v;
  }
  return out;
}

/**
 * Install Foundry-like globals. Returns handles the test can inspect.
 * @param {object} opts
 * @param {string} [opts.userId]
 * @param {number} [opts.role]           User role (4 = gamemaster)
 * @param {string[]} [opts.activeModules]
 * @param {boolean} [opts.browser]       Running in a real browser: keep its window, document, storage and location
 */
export function installFoundry({ userId = "player1", role = 1, activeModules = [], browser = false } = {}) {
  const localStorage = browser ? globalThis.localStorage : new MemoryStorage();
  const notifications = [];
  const reloads = { count: 0 };
  const dialogs = [];
  const settings = new MockSettings(localStorage);
  const modules = new Map([["performance-triage", { id: "performance-triage", active: true, compatibility: { verified: "13" } }]]);
  for ( const id of activeModules ) modules.set(id, { id, active: true });

  const ticker = { maxFPS: 60, minFPS: 10, FPS: 60 };
  const win = browser ? globalThis.window : new EventTarget();
  const doc = browser ? globalThis.document
    : Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true, head: { append() {} }, getElementById: () => null });

  if ( !browser ) {
    // Module code uses long-lived intervals (idle checks) and a one-minute timer (load history); unref them so a
    // test process can exit when its tests end. A browser page doesn't wait for timers either.
    const setIntervalReal = globalThis.setInterval;
    globalThis.setInterval = (fn, ms, ...args) => setIntervalReal(fn, ms, ...args).unref();
    const setTimeoutReal = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => {
      const t = setTimeoutReal(fn, ms, ...args);
      return (ms >= 10_000) ? t.unref() : t;
    };
    Object.assign(globalThis, {
      localStorage,
      window: win,
      document: doc,
      screen: { width: 1920, height: 1080 },
      location: { origin: "http://localhost:30000" }
    });
  }

  const Hooks = createMockHooks();
  Object.assign(globalThis, {
    Hooks,
    CONST: { USER_ROLES: { PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 } },
    CONFIG: { ChatMessage: { batchSize: 100 }, debug: {} },
    ui: { notifications: { info: m => notifications.push(["info", m]), warn: m => notifications.push(["warn", m]), error: m => notifications.push(["error", m]) } },
    canvas: { ready: true, app: { ticker, renderer: {} }, performance: { fps: 60 } },
    foundry: {
      applications: {
        api: {
          ApplicationV2: class {},
          DialogV2: { confirm: async opts => { dialogs.push(opts); return false; } }
        },
        sidebar: { apps: { SupportDetails: { getWebGLRendererInfo: () => "Mock GPU" } } }
      },
      utils: { debouncedReload: () => reloads.count++, expandObject, saveDataToFile() {} },
      canvas: { animation: { CanvasAnimation: { animations: {} } }, TextureLoader: { approximateTotalMemoryUsage: 0 } }
    },
    game: {
      userId,
      user: null,
      version: "13.351",
      release: { generation: 13 },
      data: { users: [{ _id: userId, role }, { _id: "gm1", role: 4 }] },
      settings,
      modules,
      i18n: { localize: k => k, format: (k, d) => `${k} ${JSON.stringify(d)}` }
    }
  });

  /** Register core client settings the way Foundry would before the setup hook. */
  function registerCoreSettings() {
    const core = {
      performanceMode: null, maxFPS: 60, pixelRatioResolutionScaling: true, lightAnimation: true,
      visionAnimation: true, mipmap: true, tokenDragPreview: true, chatBubbles: true, scrollingStatusText: true,
      animateRollTable: true, noCanvas: false
    };
    for ( const [key, def] of Object.entries(core) ) settings.register("core", key, { scope: "client", default: def });
  }

  return { Hooks, localStorage, notifications, reloads, dialogs, settings, modules, ticker, window: win, document: doc, registerCoreSettings };
}
