/**
 * Pure aggregation helpers for browser performance entries.
 * Everything here works on plain objects so it can be exercised in Node tests.
 */
import { packageFromUrl, isTextResource, TRANSPARENT_PACKAGES } from "./attribution.mjs";

/** Keep the N largest items by a numeric score without retaining everything. */
export class TopN {
  constructor(n, score) {
    this.n = n;
    this.score = score;
    this.items = [];
  }

  add(item) {
    const s = this.score(item);
    const items = this.items;
    if ( (items.length >= this.n) && (s <= this.score(items[items.length - 1])) ) return;
    let i = items.length;
    while ( (i > 0) && (this.score(items[i - 1]) < s) ) i--;
    items.splice(i, 0, item);
    if ( items.length > this.n ) items.pop();
  }
}

/**
 * Classify how a resource was delivered.
 * Uses responseStatus/deliveryType where the browser provides them (Chromium 109+), otherwise falls back to sizes.
 * @returns {"cache"|"revalidated"|"network"|"opaque"}
 */
export function deliveryOf(e) {
  if ( e.deliveryType === "cache" ) return "cache";
  if ( e.responseStatus === 304 ) return "revalidated";
  const transfer = e.transferSize ?? 0;
  const decoded = e.decodedBodySize ?? 0;
  if ( (transfer === 0) && (decoded === 0) ) return "opaque"; // Cross-origin without Timing-Allow-Origin, or empty
  if ( transfer === 0 ) return "cache";
  if ( (e.encodedBodySize ?? 0) > 0 && (transfer < 1024) && (transfer < e.encodedBodySize) ) return "revalidated";
  return "network";
}

function emptyResourceBucket(key) {
  return {
    key, count: 0, transfer: 0, encoded: 0, decoded: 0, duration: 0,
    scriptBytes: 0, cache: 0, revalidated: 0, network: 0, opaque: 0, uncompressedText: 0, uncompressedCount: 0
  };
}

/** Incrementally aggregates PerformanceResourceTiming entries by package. */
export class ResourceAggregator {
  constructor(origin) {
    this.origin = origin;
    this.packages = new Map();
    this.protocols = new Map();
    this.largest = new TopN(25, r => r.decoded);
    this.total = emptyResourceBucket("total");
    this.seen = 0;
  }

  add(e) {
    this.seen++;
    const key = packageFromUrl(e.name, this.origin);
    let b = this.packages.get(key);
    if ( !b ) this.packages.set(key, b = emptyResourceBucket(key));
    const delivery = deliveryOf(e);
    for ( const bucket of [b, this.total] ) {
      bucket.count++;
      bucket.transfer += e.transferSize ?? 0;
      bucket.encoded += e.encodedBodySize ?? 0;
      bucket.decoded += e.decodedBodySize ?? 0;
      bucket.duration += Math.max(0, e.duration ?? 0); // Some cached entries report a negative duration
      bucket[delivery]++;
      if ( (e.initiatorType === "script") || /\.m?js(\?|#|$)/.test(e.name) ) bucket.scriptBytes += e.decodedBodySize ?? 0;
      const encoded = e.encodedBodySize ?? 0;
      if ( (delivery === "network") && (encoded > 2048) && (encoded === e.decodedBodySize) && isTextResource(e.name) ) {
        bucket.uncompressedText += encoded;
        bucket.uncompressedCount++;
      }
    }
    if ( e.nextHopProtocol ) this.protocols.set(e.nextHopProtocol, (this.protocols.get(e.nextHopProtocol) ?? 0) + 1);
    this.largest.add({ url: e.name, key, decoded: e.decodedBodySize ?? 0, transfer: e.transferSize ?? 0, delivery });
  }

  toJSON() {
    return {
      seen: this.seen,
      total: this.total,
      packages: [...this.packages.values()].sort((a, b) => b.decoded - a.decoded),
      protocols: Object.fromEntries(this.protocols),
      largest: this.largest.items
    };
  }
}

/** Aggregates Long Animation Frame entries (Chromium 123+), attributing script time to packages. */
export class LongFrameAggregator {
  constructor(origin) {
    this.origin = origin;
    this.frames = 0;
    this.duration = 0;
    this.blocking = 0;
    this.byPackage = new Map();
    this.worst = new TopN(10, f => f.duration);
  }

  add(e, phase) {
    this.frames++;
    this.duration += e.duration;
    this.blocking += e.blockingDuration ?? 0;
    const scripts = [];
    for ( const s of e.scripts ?? [] ) {
      // Early Chromium builds exposed "url:line:col" as sourceLocation before sourceURL shipped
      const url = s.sourceURL || String(s.sourceLocation ?? "").replace(/(:\d+){1,2}$/, "");
      const key = packageFromUrl(url, this.origin);
      let b = this.byPackage.get(key);
      if ( !b ) this.byPackage.set(key, b = { key, count: 0, duration: 0, layout: 0 });
      b.count++;
      b.duration += s.duration ?? 0;
      b.layout += s.forcedStyleAndLayoutDuration ?? 0;
      // Invokers can contain whole data: URIs; keep stored strings short
      scripts.push({
        key, duration: Math.round(s.duration ?? 0), invoker: String(s.invoker ?? "").slice(0, 200),
        type: s.invokerType ?? "", fn: String(s.sourceFunctionName ?? "").slice(0, 80)
      });
    }
    scripts.sort((a, b) => b.duration - a.duration);
    this.worst.add({ start: Math.round(e.startTime), duration: Math.round(e.duration), phase, scripts: scripts.slice(0, 5) });
  }

  toJSON() {
    return {
      frames: this.frames,
      duration: this.duration,
      blocking: this.blocking,
      packages: [...this.byPackage.values()].sort((a, b) => b.duration - a.duration),
      worst: this.worst.items
    };
  }
}

/**
 * Attribute a JS Self-Profiling trace to packages.
 * "self" is the package whose code was literally executing; "responsible" is the innermost package frame on the stack,
 * skipping transparent libraries, so core work done on behalf of a module is charged to that module.
 * @param {object} trace      The ProfilerTrace returned by Profiler#stop()
 * @param {string} origin
 * @param {number} interval   The requested sample interval in ms
 */
export function analyzeTrace(trace, origin, interval = 10) {
  const resourceKeys = (trace.resources ?? []).map(url => packageFromUrl(url, origin));
  const frameKey = f => ((f?.resourceId === undefined) ? null : resourceKeys[f.resourceId]);
  const samples = trace.samples ?? [];
  const result = { sampledMs: 0, idleMs: 0, packages: new Map(), functions: new Map() };
  const bucket = key => {
    let b = result.packages.get(key);
    if ( !b ) result.packages.set(key, b = { key, self: 0, responsible: 0, inclusive: 0 });
    return b;
  };

  for ( let i = 0; i < samples.length; i++ ) {
    const s = samples[i];
    const next = samples[i + 1];
    const dt = next ? Math.min(next.timestamp - s.timestamp, interval * 5) : interval;
    result.sampledMs += dt;
    if ( s.stackId === undefined ) {
      result.idleMs += dt;
      continue;
    }
    let selfKey = null;
    let responsible = null;
    let topName = null;
    const seen = new Set();
    for ( let id = s.stackId; id !== undefined; id = trace.stacks[id]?.parentId ) {
      const frame = trace.frames[trace.stacks[id]?.frameId];
      const key = frameKey(frame);
      if ( !key ) continue;
      if ( selfKey === null ) {
        selfKey = key;
        topName = `${frame.name || "(anonymous)"} [${key}]`;
      }
      if ( (responsible === null) && (key !== "core") && !TRANSPARENT_PACKAGES.has(key) ) responsible = key;
      seen.add(key);
    }
    selfKey ??= "native";
    bucket(selfKey).self += dt;
    bucket(responsible ?? selfKey).responsible += dt;
    for ( const key of seen ) bucket(key).inclusive += dt;
    if ( topName ) result.functions.set(topName, (result.functions.get(topName) ?? 0) + dt);
  }

  return {
    sampledMs: result.sampledMs,
    idleMs: result.idleMs,
    packages: [...result.packages.values()].sort((a, b) => b.responsible - a.responsible),
    functions: [...result.functions.entries()].map(([name, ms]) => ({ name, ms }))
      .sort((a, b) => b.ms - a.ms).slice(0, 25)
  };
}
