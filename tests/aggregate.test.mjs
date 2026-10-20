import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TopN, deliveryOf, ResourceAggregator, LongFrameAggregator, analyzeTrace, measurePayload
} from "../modules/performance-triage/scripts/lib/aggregate.mjs";

const ORIGIN = "http://localhost:30000";
const res = (path, o = {}) => ({
  name: `${ORIGIN}${path}`, initiatorType: "script", transferSize: 0, encodedBodySize: 0, decodedBodySize: 0,
  duration: 10, nextHopProtocol: "http/1.1", ...o
});

test("TopN keeps the largest items in order", () => {
  const top = new TopN(3, x => x);
  for ( const n of [5, 1, 9, 3, 7, 2] ) top.add(n);
  assert.deepEqual(top.items, [9, 7, 5]);
});

test("deliveryOf distinguishes cache hits, revalidations, network and opaque", () => {
  assert.equal(deliveryOf({ deliveryType: "cache" }), "cache");
  assert.equal(deliveryOf({ responseStatus: 304, transferSize: 300 }), "revalidated");
  assert.equal(deliveryOf({ transferSize: 0, decodedBodySize: 500 }), "cache");
  assert.equal(deliveryOf({ transferSize: 0, decodedBodySize: 0 }), "opaque");
  assert.equal(deliveryOf({ transferSize: 400, encodedBodySize: 90000, decodedBodySize: 90000 }), "revalidated");
  assert.equal(deliveryOf({ transferSize: 30500, encodedBodySize: 30000, decodedBodySize: 120000 }), "network");
});

test("ResourceAggregator groups by package and flags uncompressed text", () => {
  const agg = new ResourceAggregator(ORIGIN);
  agg.add(res("/modules/big/big.js", { transferSize: 500300, encodedBodySize: 500000, decodedBodySize: 500000 }));
  agg.add(res("/modules/big/style.css", { initiatorType: "link", transferSize: 20300, encodedBodySize: 20000, decodedBodySize: 80000 }));
  agg.add(res("/systems/dnd5e/dnd5e.mjs", { transferSize: 0, decodedBodySize: 2000000, nextHopProtocol: "h2" }));
  const json = agg.toJSON();
  const big = json.packages.find(p => p.key === "module:big");
  assert.equal(big.count, 2);
  assert.equal(big.uncompressedText, 500000);
  assert.equal(big.uncompressedCount, 1);
  assert.equal(big.scriptBytes, 500000);
  assert.equal(json.packages[0].key, "system:dnd5e", "sorted by decoded size");
  assert.equal(json.total.count, 3);
  assert.equal(json.total.cache, 1);
  assert.deepEqual(json.protocols, { "http/1.1": 2, h2: 1 });
});

test("LongFrameAggregator attributes script time to packages", () => {
  const lf = new LongFrameAggregator(ORIGIN);
  lf.add({
    startTime: 1000, duration: 180, blockingDuration: 130,
    scripts: [
      { sourceURL: `${ORIGIN}/modules/midi-qol/dist/midi-qol.js`, duration: 120, invoker: "Hooks.callAll", invokerType: "user-callback", sourceFunctionName: "onUpdate" },
      { sourceURL: `${ORIGIN}/scripts/foundry.mjs`, duration: 40, forcedStyleAndLayoutDuration: 15 }
    ]
  }, "play");
  const json = lf.toJSON();
  assert.equal(json.frames, 1);
  assert.equal(json.blocking, 130);
  assert.equal(json.packages[0].key, "module:midi-qol");
  assert.equal(json.packages[1].layout, 15);
  assert.equal(json.worst[0].scripts[0].fn, "onUpdate");
});

test("analyzeTrace charges core work to the innermost non-transparent package", () => {
  const trace = {
    resources: [`${ORIGIN}/scripts/foundry.mjs`, `${ORIGIN}/modules/heavy/heavy.js`, `${ORIGIN}/modules/lib-wrapper/src/index.js`],
    frames: [
      { name: "render", resourceId: 0 },   // 0 core
      { name: "wrapper", resourceId: 1 },  // 1 heavy
      { name: "call", resourceId: 2 },     // 2 lib-wrapper
      { name: "original", resourceId: 0 }  // 3 core
    ],
    stacks: [
      { frameId: 0 },                // 0: core render
      { frameId: 1, parentId: 0 },   // 1: heavy wrapper called by core
      { frameId: 2, parentId: 1 },   // 2: lib-wrapper forwarding
      { frameId: 3, parentId: 2 }    // 3: core original running
    ],
    samples: [
      { timestamp: 0, stackId: 3 },
      { timestamp: 10, stackId: 3 },
      { timestamp: 20, stackId: 0 },
      { timestamp: 30 }
    ]
  };
  const out = analyzeTrace(trace, ORIGIN, 10);
  const by = Object.fromEntries(out.packages.map(p => [p.key, p]));
  assert.equal(out.sampledMs, 40);
  assert.equal(out.idleMs, 10);
  assert.equal(by["module:heavy"].responsible, 20, "core original under heavy's wrapper is charged to heavy");
  assert.equal(by["core"].self, 30);
  assert.equal(by["core"].responsible, 10);
  assert.equal(by["module:lib-wrapper"].responsible, 0, "lib-wrapper is transparent");
  assert.equal(by["module:lib-wrapper"].inclusive, 20);
});

test("measurePayload sizes sections and groups compendium indexes by package", () => {
  const out = measurePayload({
    actors: [{ name: "A" }, { name: "B" }],
    messages: new Array(3).fill({ content: "x".repeat(100) }),
    packs: [
      { packageType: "module", packageName: "cpr", index: [{ _id: 1 }, { _id: 2 }] },
      { packageType: "module", packageName: "cpr", index: [{ _id: 3 }] },
      { packageType: "system", packageName: "dnd5e", index: [] }
    ]
  });
  assert.equal(out.sections[0].key, "messages");
  const cpr = out.packs.find(p => p.key === "module:cpr");
  assert.equal(cpr.packs, 2);
  assert.equal(cpr.entries, 3);
});
