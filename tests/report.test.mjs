import { test } from "node:test";
import assert from "node:assert/strict";
import { recommend } from "../modules/performance-triage/scripts/lib/recommend.mjs";
import { reportToHtml, reportToMarkdown, timelineRows, fmtBytes, fmtMs, esc } from "../modules/performance-triage/scripts/lib/report-format.mjs";

const MB = 1024 * 1024;

/** A report shaped like collectReport() output for a struggling world. */
function sampleReport() {
  return {
    generatedAt: "2026-10-20T18:00:00.000Z",
    env: { core: "13.351", generation: 13, system: "dnd5e 5.3.3", user: "GM", isGM: true, browser: "Chrome 141", cores: 4, memory: 8, dpr: 2, screen: "1920x1080", gpu: "Intel UHD 620", maxTexture: 16384, webgl2: true },
    profile: { id: "none", idle: null, chatBatchSize: 100 },
    client: { fps: { target: 60, achieved: 22, samples: 10 }, resolutionScaling: true, canvasPerformance: { mode: 2, fps: 60, mipmap: "ON", msaa: false, smaa: true, lightSoftEdges: true } },
    timeline: { navigation: { responseEnd: 120, domInteractive: 900 }, marks: { scriptEval: 2500, init: 4100, setup: 19000, canvasReady: 31000, ready: 33000 } },
    network: {
      load: {
        total: { key: "total", count: 1900, transfer: 60 * MB, decoded: 140 * MB, scriptBytes: 40 * MB, cache: 10, revalidated: 1200, network: 690, opaque: 0, uncompressedText: 30 * MB, uncompressedCount: 800, duration: 1 },
        packages: [{ key: "module:<script>evil", count: 40, transfer: 9 * MB, decoded: 9 * MB, scriptBytes: 8 * MB, cache: 0, revalidated: 20, network: 20, opaque: 0, uncompressedText: 8 * MB, uncompressedCount: 4 }],
        protocols: { "http/1.1": 1900 },
        largest: [{ url: "http://localhost:30000/modules/x/big.js", key: "module:x", decoded: 8 * MB, transfer: 8 * MB, delivery: "network" }]
      }
    },
    longFrames: { supported: true, load: { frames: 40, duration: 9000, blocking: 7000, packages: [], worst: [] }, play: { frames: 12, duration: 2000, blocking: 1400, packages: [{ key: "module:midi-qol", count: 9, duration: 900, layout: 100 }], worst: [{ start: 40000, duration: 300, phase: "play", scripts: [{ key: "module:midi-qol", duration: 250, fn: "onUpdate", invoker: "", type: "" }] }] } },
    hooks: { installed: true, windowMs: 600000, packages: [{ pkg: "module:heavy", calls: 900, self: 4000, max: 180, hooks: 6 }], listeners: [{ pkg: "module:heavy", hook: "updateActor", calls: 300, total: 2500, self: 2400, max: 180 }] },
    payload: { sections: [{ key: "messages", bytes: 18 * MB, count: 6000 }, { key: "actors", bytes: 9 * MB, count: 900 }], packs: [{ key: "module:cpr", bytes: 5 * MB, packs: 12, entries: 9000 }] },
    canvas: { ready: true, textureMemory: 2 * 1024 * MB, textureMemorySource: "TextureLoader", textures: [{ src: "maps/huge.png", kind: "background", width: 12000, height: 9000, video: false, bytes: 12000 * 9000 * 4 }], scene: { name: "Keep", width: 12000, height: 9000, gridSize: 100, tokens: 30, lights: 40, animatedLights: 30, walls: 900, tiles: 4, videoTiles: 2, regions: 3, sounds: 2 } },
    modules: { active: 112, list: [], outdated: [{ id: "old-mod", version: "1.0", verified: "11" }], debug: [{ label: "CONFIG.debug.hooks", value: true, fix: "Run `CONFIG.debug.hooks = false`." }] },
    world: { counts: { actors: 900, items: 2000, messages: 6000 }, heavyActors: [{ name: "Lich", type: "npc", items: 200, effects: 40 }], packs: { count: 300, entries: 90000, byPackage: [] } },
    players: [{ id: "u1", name: "Sam", isGM: false, active: true, assigned: "default", profile: "none", summary: { fps: { target: 60, achieved: 14 }, cores: 2, memory: 4, loadSeconds: 120, gpu: "Intel HD 4000" } }],
    sampler: null,
    prep: { count: 900, totalMs: 9000, actors: [{ name: "Lich", type: "npc", ms: 85, items: 200, effects: 40 }] }
  };
}

test("recommend raises the expected findings, most severe first", () => {
  const findings = recommend(sampleReport());
  const titles = findings.map(f => f.title);
  assert.equal(findings[0].severity, "high");
  assert.ok(titles.some(t => t.includes("CONFIG.debug.hooks")));
  assert.ok(titles.includes("Files are served over HTTP/1.1"));
  assert.ok(titles.includes("Text files are sent uncompressed"));
  assert.ok(titles.includes("The browser re-checks most files on every load"));
  assert.ok(titles.some(t => t.startsWith("World data sent to every client")));
  assert.ok(titles.some(t => t.startsWith("Chat log has 6000")));
  assert.ok(titles.some(t => t.includes("not verified")));
  assert.ok(titles.includes("Modules with the most time spent in hook listeners"));
  assert.ok(titles.some(t => t.startsWith("Textures use about")));
  assert.ok(titles.includes("Very large images in this scene"));
  assert.ok(titles.some(t => t.startsWith("Sam may need the minimum profile")));
  assert.ok(titles.includes("Preparing all 900 world actors takes 9.0 s on this computer"));
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  for ( let i = 1; i < findings.length; i++ ) assert.ok(order[findings[i - 1].severity] <= order[findings[i].severity]);
});

test("recommend stays quiet on a healthy report", () => {
  const findings = recommend({
    env: { dpr: 1 }, profile: { id: "none" }, client: { fps: { target: 60, achieved: 59 } },
    network: { load: { total: { count: 400, uncompressedText: 0, revalidated: 0 }, protocols: { h2: 400 }, packages: [] } },
    modules: { active: 40, outdated: [], debug: [] }, world: { counts: { actors: 50, items: 100, messages: 200 } },
    canvas: { ready: true, textureMemory: 300 * MB, textures: [], scene: { videoTiles: 0, animatedLights: 2 } }
  });
  assert.deepEqual(findings, []);
});

test("recommend tolerates an empty report", () => {
  assert.deepEqual(recommend({}), []);
});

test("timelineRows orders phases and computes deltas", () => {
  const rows = timelineRows(sampleReport().timeline);
  assert.deepEqual(rows.map(r => r.label).slice(0, 4), ["Page received", "Page parsed", "Performance Triage loaded", "init"]);
  assert.equal(rows.find(r => r.label === "setup").delta, 19000 - 4100);
});

test("HTML output escapes untrusted names and renders every section", () => {
  const report = sampleReport();
  report.findings = recommend(report);
  const html = reportToHtml(report, { sampler: { available: false, reason: "policy" } });
  assert.ok(!html.includes("<script>evil"), "package names are escaped");
  assert.ok(html.includes("&lt;script&gt;evil"));
  for ( const id of ["timeline", "network", "longframes", "hooks", "payload", "cpu", "canvas", "world", "modules", "players"] ) {
    assert.ok(html.includes(`data-section="${id}"`), `section ${id}`);
  }
  assert.ok(html.includes("Document-Policy: js-profiling"));
  assert.ok(html.includes("data-action=\"toggleHookProfiler\""));
});

test("Markdown output is a shareable summary", () => {
  const report = sampleReport();
  report.findings = recommend(report);
  const md = reportToMarkdown(report);
  assert.ok(md.startsWith("# Performance Triage report"));
  assert.ok(md.includes("## Findings"));
  assert.ok(md.includes("| Package | Files | Transferred |"));
  assert.ok(md.includes("| heavy | updateActor | 300 |"), "hook rows are present");
});

test("formatters", () => {
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(1536), "1.5 KB");
  assert.equal(fmtBytes(3 * MB), "3.0 MB");
  assert.equal(fmtBytes(undefined), "–");
  assert.equal(fmtMs(12.4), "12 ms");
  assert.equal(fmtMs(2500), "2.5 s");
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

/** Shaped like a real report from a heavy dnd5e world on an older integrated GPU (names anonymized). */
function heavyWorldReport() {
  return {
    env: { generation: 13, dpr: 1, memory: 16, cores: 8 },
    profile: { id: "none", overridden: [] },
    client: { liveFps: 18, maxFPS: 60, canvasPerformance: { mode: 2, fps: 60 } },
    timeline: { marks: { init: 18273, i18nInit: 18762, setup: 41155, canvasReady: 54949, ready: 54981, readyComplete: 97800 } },
    longFrames: {
      supported: true,
      load: { frames: 34, duration: 78540, blocking: 73567, packages: [], worst: [
        { start: 54866, duration: 42926, phase: "load", scripts: [] },
        { start: 18870, duration: 22682, phase: "load", scripts: [] },
        { start: 49589, duration: 3021, phase: "load", scripts: [] }
      ] },
      play: { frames: 1, duration: 7506, blocking: 7456,
        packages: [{ key: "module:data-compressor", count: 1, duration: 7464, layout: 0 }],
        worst: [{ start: 98339, duration: 7506, phase: "play", scripts: [] }] }
    },
    modules: {
      active: 158, outdatedContent: 33, debug: [],
      outdated: [{ id: "old-code-module", version: "1.0", verified: "12" }],
      list: [{ id: "potato-or-not" }, { id: "force-client-settings" }, { id: "data-compressor" }]
    }
  };
}

test("startup freezes are reported with the phases they span and what to do next", () => {
  const findings = recommend(heavyWorldReport());
  const freezes = findings.filter(f => f.area === "Startup");
  assert.equal(freezes.length, 2, "only freezes over 5 s");
  assert.match(freezes[0].title, /42\.9 s/);
  assert.match(freezes[0].detail, /spanning canvasReady, ready.*hook profiler/);
  assert.match(freezes[1].detail, /spanning setup.*Time actor preparation/);
});

test("low live frame rate with no profile recommends Low and names the performance mode", () => {
  const f = recommend(heavyWorldReport()).find(x => x.title.startsWith("This client renders about 18 fps"));
  assert.ok(f);
  assert.equal(f.severity, "high");
  assert.match(f.detail, /High performance mode/);
});

test("content-only packs are not counted as unverified code", () => {
  const f = recommend(heavyWorldReport()).find(x => x.title.includes("not verified"));
  assert.match(f.title, /^1 active module with code is/);
  assert.match(f.detail, /33 content-only packs are also unverified/);
});

test("overlapping performance modules and overridden profile settings are flagged", () => {
  const report = heavyWorldReport();
  report.profile = { id: "low", overridden: [{ key: "core.performanceMode", wanted: 0, actual: 2 }] };
  const findings = recommend(report);
  const overlap = findings.find(f => f.title === "Other performance modules are active");
  assert.match(overlap.detail, /potato-or-not.*force-client-settings/);
  const drift = findings.find(f => f.title.startsWith("Something changed back"));
  assert.match(drift.detail, /core\.performanceMode is 2, profile wants 0/);
});

test("measured layer costs become a finding with advice for the most expensive layer", () => {
  const report = heavyWorldReport();
  report.frameCost = { baseline: 18, baselineEnd: 18.5, stable: true, rows: [
    { id: "primary", label: "Everything on the map", fps: 60, savedMs: 38.9, atLimit: true },
    { id: "tokenFilters", label: "Token filters", fps: 31, savedMs: 23.3, atLimit: false },
    { id: "tiles", label: "Tiles", fps: 20, savedMs: 5.6, atLimit: false },
    { id: "interface", label: "Interface", fps: 18.5, savedMs: 1.5, atLimit: false }
  ] };
  const f = recommend(report).find(x => x.area === "Scene" && x.title.startsWith("What costs the most"));
  assert.match(f.detail, /^Token filters: 23\.3 ms per frame; Tiles: 5\.6 ms per frame\.$/);
  assert.match(f.fix, /Token Magic FX/);
});

test("timeline and headline use the settled time, not the moment the ready hook fired", () => {
  const report = heavyWorldReport();
  const rows = timelineRows(report.timeline, 105845);
  assert.deepEqual(rows.slice(-3).map(r => r.label), ["ready hook fired", "ready handlers finished", "Settled (no long freeze for 2 s)"]);
  const html = reportToHtml({ ...report, findings: [] });
  assert.ok(html.includes("Time until usable"));
  assert.ok(html.includes("105.8 s"), "settled time shown in the headline");
});

test("findings carry the button for their next step, and drop it once that step is done", () => {
  const report = heavyWorldReport();
  report.world = { counts: {} };
  report.canvas = { ready: true, textures: [], scene: {} };
  report.hookProfilerEnabled = false;
  let findings = recommend(report);
  const ids = title => findings.find(f => f.title.startsWith(title)).actions.map(a => a.id);
  assert.deepEqual(ids("The page froze for 42.9 s"), ["toggleHookProfiler"]);
  assert.deepEqual(ids("The page froze for 22.7 s"), ["benchmarkActors"]);
  assert.deepEqual(ids("This client renders about 18 fps"), ["useLowProfile", "measureFrameCost"]);

  const html = reportToHtml({ ...report, findings });
  assert.ok(html.includes("data-action=\"useLowProfile\""));

  // After running the profiler, timing actors and measuring layers, those buttons go away
  Object.assign(report, { hookProfilerEnabled: true, prep: { count: 1, totalMs: 1, actors: [] },
    frameCost: { baseline: 18, baselineEnd: 18, stable: true, rows: [] } });
  findings = recommend(report);
  assert.deepEqual(ids("The page froze for 42.9 s"), []);
  assert.deepEqual(ids("The page froze for 22.7 s"), []);
  assert.deepEqual(ids("This client renders about 18 fps"), ["useLowProfile"]);
});

test("freezes name what the hook profiler and actor timing found, instead of asking to run them", () => {
  const report = heavyWorldReport();
  report.hookProfilerEnabled = true;
  report.hooks = { windowMs: 120000, packages: [
    { pkg: "module:sequencer", calls: 189, self: 40003, max: 39961, hooks: 8 },
    { pkg: "module:performance-triage", calls: 11, self: 862, max: 860, hooks: 6 }
  ], listeners: [
    { pkg: "module:sequencer", hook: "ready", calls: 2, total: 39961, self: 39956, max: 39961 },
    { pkg: "module:performance-triage", hook: "init", calls: 3, total: 861, self: 861, max: 860 }
  ] };
  report.prep = { count: 377, totalMs: 7210, actors: [{ name: "PC", type: "character", ms: 333, items: 171, effects: 2 }] };
  const findings = recommend(report);
  const ready = findings.find(f => f.title.startsWith("The page froze for 42.9 s"));
  assert.match(ready.detail, /sequencer's ready handler at 40\.0 s/);
  assert.deepEqual(ready.actions, []);
  const setup = findings.find(f => f.title.startsWith("The page froze for 22.7 s"));
  assert.match(setup.detail, /377 world actors takes 7\.2 s/);
  const hooks = findings.find(f => f.title === "Modules with the most time spent in hook listeners");
  assert.ok(!hooks.detail.includes("performance-triage"), "this module's own profiling cost is not a culprit");
  assert.ok(findings.some(f => f.title === "Preparing all 377 world actors takes 7.2 s on this computer"));
});

test("scene, settings and actor payload findings explain what is big", () => {
  const MB = 1024 * 1024;
  const report = heavyWorldReport();
  report.env.isGM = true;
  report.payload = {
    sections: [{ key: "scenes", bytes: 105 * MB, count: 128 }, { key: "actors", bytes: 23 * MB, count: 377 }, { key: "settings", bytes: 7 * MB, count: 1299 }],
    packs: [],
    detail: {
      scenes: { bytes: 105 * MB, tokenDelta: 80 * MB, parts: [{ key: "tokens", bytes: 90 * MB }, { key: "walls", bytes: 10 * MB }],
        largest: [{ name: "Castle Ravenloft", bytes: 12 * MB, tokens: 90, walls: 3000 }],
        tokens: {
          count: 1500, linked: 40, unlinked: 1460, deltaBytes: 80 * MB, items: 52000, withItems: 1200,
          parts: [{ key: "items", bytes: 78 * MB }, { key: "system", bytes: 2 * MB }],
          same: { items: 50000, bytes: 75 * MB }, added: { items: 1000, duplicates: 300, examples: [{ scene: "Vallaki", token: "Guard", items: ["Spear"] }] }, linkedDelta: { tokens: 6, bytes: 3 * MB }, missingActor: { tokens: 0, bytes: 0 },
          largest: [{ scene: "Vallaki", name: "Guard", linked: false, bytes: MB, delta: MB, items: 60, same: 60, effects: 0 }],
          byActor: [{ actor: "Vistani Bandit", tokens: 40, bytes: 20 * MB, items: 2400, same: 2400 }, { actor: null, tokens: 3, bytes: MB, items: 90, same: 0 }]
        } },
      settings: { bytes: 7 * MB, byPackage: [{ key: "some-module", bytes: 6 * MB, count: 3 }],
        largest: [{ key: "some-module.cache", bytes: 5 * MB }, { key: "core.time", bytes: 10 }] },
      actors: { bytes: 23 * MB, largest: [{ name: "Strahd", type: "npc", bytes: MB, items: 58 }] }
    }
  };
  const findings = recommend(report);
  const scenes = findings.find(f => f.title.startsWith("Scenes are 105.0 MB"));
  assert.match(scenes.detail, /tokens 90\.0 MB.*own actor data \(their "delta"\) is 80\.0 MB.*Castle Ravenloft 12\.0 MB \(90 tokens, 3000 walls\)/);
  const copies = findings.find(f => f.title === "Unlinked tokens store 78.0 MB of their own item copies");
  assert.match(copies.detail, /1200 of 1460 unlinked tokens store their own copies of 52000 items\. 1000 differ from the sidebar actor's version of the same item, 1000 are items the sidebar actor doesn't have, and 50000 are identical to it apart from timestamps\. 300 of the added items share a name and type/);
  assert.deepEqual(copies.actions.map(a => a.id), ["openScenePlan", "openTokenCensus"], "the GM gets the planner buttons");
  assert.match(copies.detail, /probably show that item twice: Guard on Vallaki \(Spear\)\./);
  assert.match(copies.fix, /only replace tokens the party hasn't met/, "few additions: replacing is an option");

  // In the measured world nearly every copy was an item the sidebar actor lacks: replacing tokens would lose them
  report.payload.detail.scenes.tokens = { ...report.payload.detail.scenes.tokens, same: { items: 2, bytes: 1 },
    added: { items: 51000, duplicates: 43, examples: [] } };
  const own = recommend(report).find(f => f.title.startsWith("Unlinked tokens store"));
  assert.match(own.fix, /Don't replace these tokens.*exist only on the tokens/);
  assert.match(copies.detail, /Vistani Bandit \(40 tokens, 20\.0 MB\); a deleted actor \(3 tokens, 1\.0 MB\)/);
  assert.ok(findings.some(f => f.title === "6 linked tokens still store 3.0 MB of actor data"));
  assert.match(findings.find(f => f.title.startsWith("World settings are")).detail,
    /some-module 6\.0 MB\. Largest settings: some-module\.cache 5\.0 MB\. /);
  assert.match(findings.find(f => f.title.startsWith("World actors are")).detail, /Strahd 1\.0 MB \(58 items\)/);
  const html = reportToHtml({ ...report, findings });
  for ( const caption of ["Largest scenes", "Token data by the sidebar actor", "Largest tokens", "Largest world settings"] ) {
    assert.ok(html.includes(caption), caption);
  }
});

test("the wait for world data is a timeline phase, a headline number and a finding", () => {
  const report = heavyWorldReport();
  report.timeline = {
    navigation: { domContentLoaded: 619 },
    marks: { scriptEval: 455, init: 11618, setup: 21454, ready: 23391, readyComplete: 24007 }
  };
  report.longFrames.load.worst = [{ start: 10334, duration: 1388, phase: "load", scripts: [] }];
  report.payload = { sections: [{ key: "scenes", bytes: 140 * 1024 * 1024, count: 128 }], packs: [], detail: {} };
  const findings = recommend(report);
  const wait = findings.find(f => f.title === "This computer waited 9.7 s for the world data");
  assert.equal(wait.severity, "medium");
  assert.match(wait.detail, /from 0\.6 s to 10\.3 s after load.*\(140\.0 MB\)/);
  assert.deepEqual(wait.actions, [], "payload already measured: nothing to turn on");
  const rows = timelineRows(report.timeline, null, 10334);
  assert.deepEqual(rows.slice(0, 3).map(r => r.label), ["Performance Triage loaded", "World data arrived (estimated)", "init"]);
  assert.equal(rows[1].delta, 10334 - 455);
  const html = reportToHtml({ ...report, findings });
  assert.ok(html.includes("Waiting for the server") && html.includes("9.7 s"));
});

test("a known listener in a freeze gets an explanation, and leftover textures are told apart from the scene's", () => {
  const report = heavyWorldReport();
  report.hooks = { installed: true, windowMs: 60000, packages: [],
    listeners: [{ pkg: "module:sequencer", hook: "ready", calls: 1, self: 10104, max: 10104 }] };
  report.timeline = { marks: { ready: 24829, readyComplete: 36016 } };
  report.longFrames.load.worst = [{ start: 24800, duration: 11213, phase: "load", scripts: [] }];
  report.canvas = { ready: true, textureMemory: 9.8 * 1024 * 1024 * 1024, sceneTextureMemory: 160 * 1024 * 1024, textures: [] };
  const findings = recommend(report);
  const freeze = findings.find(f => f.title.startsWith("The page froze for 11.2 s"));
  assert.match(freeze.detail, /sequencer's ready handler at 10\.1 s.*on the GM only, that reads every token's actor on every scene/);
  const tex = findings.find(f => f.title.startsWith("Textures use about"));
  assert.match(tex.detail, /This scene's own images are about 160\.0 MB; the rest are textures kept from scenes/);
  assert.match(tex.fix, /reload to free it/);
});

test("items repeated on many tokens are named, with their flags, and token names show under their actor", () => {
  const MB = 1024 * 1024;
  const report = heavyWorldReport();
  report.env.isGM = true;
  report.payload = {
    sections: [{ key: "scenes", bytes: 62 * MB, count: 89 }], packs: [],
    detail: { scenes: { bytes: 62 * MB, tokenDelta: 50 * MB, parts: [{ key: "tokens", bytes: 55 * MB }], largest: [],
      tokens: {
        count: 751, linked: 102, unlinked: 649, deltaBytes: 50 * MB, items: 10345, withItems: 635,
        parts: [{ key: "items", bytes: 47.7 * MB }], same: { items: 0, bytes: 0 },
        added: { items: 10293, duplicates: 41, examples: [] }, linkedDelta: { tokens: 0, bytes: 0 }, missingActor: { tokens: 0, bytes: 0 },
        largest: [],
        byActor: [{ actor: "Mongrelfolk", tokens: 72, bytes: 4.3 * MB, items: 1080, same: 0,
          names: [{ name: "Mongrelfolk", count: 4 }, { name: "Clovin Belview", count: 1 }], distinctNames: 30 }],
        repeated: { items: 9000, bytes: 40 * MB, top: [
          { name: "Shove", type: "feat", tokens: 640, bytes: 4 * MB, flags: ["chris-premades"] },
          { name: "Dash", type: "feat", tokens: 640, bytes: 3 * MB, flags: ["chris-premades", "midi-qol"] }
        ] }
      } } }
  };
  const findings = recommend(report);
  const f = findings.find(x => x.title.startsWith("Unlinked tokens store"));
  assert.match(f.detail, /40\.0 MB of it is the same items repeated on many tokens: Shove \(640 tokens\), Dash \(640 tokens\)\. They carry flags from chris-premades, midi-qol/);
  assert.match(f.fix, /one copy per actor instead of one per token/);
  const html = reportToHtml({ ...report, findings });
  assert.ok(html.includes("Mongrelfolk ×4, Clovin Belview, and 28 more"));
  assert.ok(html.includes("Items repeated on many tokens: 9000 copies, 40.0 MB"));
});


test("settings of inactive modules, repeated setting entries and actors on no scene become advice", () => {
  const report = heavyWorldReport();
  report.env.isGM = true;
  report.payload = {
    sections: [{ key: "actors", bytes: 23 * MB, count: 377 }, { key: "settings", bytes: 7 * MB, count: 1326 }], packs: [],
    detail: {
      settings: { bytes: 7 * MB, byPackage: [{ key: "autoanimations", bytes: 4.2 * MB, count: 23 }],
        largest: [{ key: "autoanimations.aaAutorec-ontoken", bytes: 2 * MB, entries: 900, sameLabel: 400, identical: 380 },
          { key: "beneos-module.beneos-database-local-storage", bytes: 1.9 * MB }],
        unowned: { bytes: 1.95 * MB, count: 4, packages: [{ key: "beneos-module", bytes: 1.9 * MB, count: 3, state: "missing" },
          { key: "tiny", bytes: 1000, count: 1, state: "inactive" }] } },
      actors: { bytes: 23 * MB, largest: [{ name: "Lunet", type: "character", bytes: 1.1 * MB, items: 171 }],
        playerOwned: { count: 9, bytes: 5 * MB },
        unused: { count: 300, bytes: 15 * MB, byType: [{ type: "npc", count: 280, bytes: 12 * MB }, { type: "character", count: 20, bytes: 3 * MB }] } }
    }
  };
  report.longFrames.play.packages = [{ key: "module:performance-triage", count: 48, duration: 2834, layout: 28 },
    { key: "module:midi-qol", count: 9, duration: 900, layout: 100 }];
  const findings = recommend(report);
  const unowned = findings.find(f => f.title === "1.9 MB of world settings belong to modules that aren't active");
  assert.ok(unowned, findings.map(f => f.title).join("\n"));
  assert.equal(unowned.severity, "medium");
  assert.match(unowned.detail, /^beneos-module \(not installed\): 1\.9 MB in 3 settings\. /, "tiny groups aren't listed");
  assert.match(unowned.fix, /getSetting\("<key>"\)\?\.delete\(\), for example with beneos-module\.beneos-database-local-storage\./);
  const settings = findings.find(f => f.title === "World settings are 7.0 MB");
  assert.match(settings.detail, /autoanimations\.aaAutorec-ontoken 2\.0 MB \(900 entries, 400 repeat a label\)/);
  assert.match(settings.fix, /imported more than once/);
  const actors = findings.find(f => f.title === "World actors are 23.0 MB of the world data");
  assert.match(actors.detail, /300 actors \(15\.0 MB\) are on no world scene and no player owns them: npc 280 \(12\.0 MB\), character 20 \(3\.0 MB\)\./);
  assert.match(actors.fix, /keeping IDs/);
  assert.deepEqual(actors.actions.map(a => a.id), ["openTokenCensus"]);
  const frames = findings.find(f => f.title === "Modules that started long frames during play");
  assert.match(frames.detail, /^midi-qol: 900 ms in 9 scripts\. Performance Triage's own 2834 ms is left out/);
  const html = reportToHtml({ ...report, findings });
  assert.ok(html.includes("World settings of packages that aren&#39;t active"));
  assert.ok(html.includes("Actors on no world scene that no player owns: 300 (15.0 MB)"));
});

test("this module's own long frames alone raise no finding", () => {
  const report = sampleReport();
  report.longFrames.play.packages = [{ key: "module:performance-triage", count: 48, duration: 2834, layout: 28 }];
  assert.ok(!recommend(report).some(f => f.title === "Modules that started long frames during play"));
});
