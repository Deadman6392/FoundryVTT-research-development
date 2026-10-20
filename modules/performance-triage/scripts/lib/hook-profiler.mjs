/**
 * Opt-in hook listener profiler.
 *
 * Wraps Hooks.on / Hooks.once / Hooks.off so every listener registered afterwards is timed and attributed to the
 * package that registered it (found from the registration stack trace, once, at registration time).
 * Timing uses a preallocated stack so nested hooks report exclusive ("self") time without per-call allocations.
 * Only the synchronous part of a listener is measured; that is the part that blocks the frame.
 *
 * Nothing in here runs unless the profiler is explicitly enabled, because wrapping costs a little on every hook call.
 */
import { packageFromStack } from "./attribution.mjs";

export const BEFORE_PROFILER = "(registered before profiler)";

export function createHookProfiler({ hooks, selfKey, origin, now = () => performance.now() }) {
  const records = new Map();
  const wrapperOf = new WeakMap();
  const wrappers = new WeakSet();
  let startedAt = now();
  let installed = false;
  let original = null;

  // Preallocated timing stack: start times and accumulated child time per depth
  const MAX_DEPTH = 256;
  const starts = new Float64Array(MAX_DEPTH);
  const childs = new Float64Array(MAX_DEPTH);
  let depth = 0;

  function record(pkg, hook) {
    const key = `${pkg}\u0000${hook}`;
    let r = records.get(key);
    if ( !r ) records.set(key, r = { pkg, hook, calls: 0, total: 0, self: 0, max: 0 });
    return r;
  }

  function wrap(hook, pkg, fn) {
    const rec = record(pkg, hook);
    const timed = function() {
      if ( depth >= MAX_DEPTH ) return fn.apply(this, arguments);
      const d = depth++;
      starts[d] = now();
      childs[d] = 0;
      try {
        return fn.apply(this, arguments);
      } finally {
        const elapsed = now() - starts[d];
        depth = d;
        if ( d > 0 ) childs[d - 1] += elapsed;
        rec.calls++;
        rec.total += elapsed;
        rec.self += elapsed - childs[d];
        if ( elapsed > rec.max ) rec.max = elapsed;
      }
    };
    wrappers.add(timed);
    let byHook = wrapperOf.get(fn);
    if ( !byHook ) wrapperOf.set(fn, byHook = new Map());
    byHook.set(hook, timed);
    return timed;
  }

  function attribute() {
    return packageFromStack(new Error().stack, selfKey, origin);
  }

  function install() {
    if ( installed ) return true;
    original = { on: hooks.on, once: hooks.once, off: hooks.off };
    try {
      hooks.on = function(hook, fn, options) {
        if ( (typeof fn !== "function") || wrappers.has(fn) ) return original.on.call(this, hook, fn, options);
        return original.on.call(this, hook, wrap(hook, attribute(), fn), options);
      };
      hooks.once = function(hook, fn) {
        if ( (typeof fn !== "function") || wrappers.has(fn) ) return original.once.call(this, hook, fn);
        return original.once.call(this, hook, wrap(hook, attribute(), fn));
      };
      hooks.off = function(hook, fn) {
        if ( typeof fn === "function" ) fn = wrapperOf.get(fn)?.get(hook) ?? fn;
        return original.off.call(this, hook, fn);
      };
    } catch(err) {
      // Hooks is frozen or its methods are read-only in this core version; put back anything we did replace
      for ( const [name, fn] of Object.entries(original) ) {
        try {
          if ( hooks[name] !== fn ) hooks[name] = fn;
        } catch { /* Nothing was replaced for this method */ }
      }
      console.warn("performance-triage | Hook profiler could not be installed", err);
      return false;
    }
    installed = true;

    // Listeners registered before we loaded (core, the system, earlier libraries) can still be timed, just not attributed
    try {
      for ( const [hook, entries] of Object.entries(hooks.events ?? {}) ) {
        for ( const entry of entries ) {
          if ( (typeof entry?.fn !== "function") || wrappers.has(entry.fn) ) continue;
          entry.fn = wrap(hook, BEFORE_PROFILER, entry.fn);
        }
      }
    } catch(err) {
      console.warn("performance-triage | Could not wrap pre-existing hook listeners", err);
    }
    return true;
  }

  function stats() {
    const rows = [...records.values()].filter(r => r.calls > 0);
    const byPackage = new Map();
    for ( const r of rows ) {
      let p = byPackage.get(r.pkg);
      if ( !p ) byPackage.set(r.pkg, p = { pkg: r.pkg, calls: 0, self: 0, max: 0, hooks: 0 });
      p.calls += r.calls;
      p.self += r.self;
      p.hooks++;
      if ( r.max > p.max ) p.max = r.max;
    }
    return {
      installed,
      windowMs: now() - startedAt,
      listeners: rows.sort((a, b) => b.self - a.self),
      packages: [...byPackage.values()].sort((a, b) => b.self - a.self)
    };
  }

  function reset() {
    for ( const r of records.values() ) r.calls = r.total = r.self = r.max = 0;
    startedAt = now();
  }

  return { install, stats, reset, get installed() { return installed; } };
}
