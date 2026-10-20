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
  assert.ok(titles.includes("Some actors are expensive to prepare"));
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
