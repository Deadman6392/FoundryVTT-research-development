/**
 * Render a collected report as HTML (for the report window) or Markdown (for sharing).
 * Pure string building with explicit escaping; no Foundry globals so it can be tested in Node.
 */
import { splitKey } from "./attribution.mjs";
import { suggestProfile } from "./profiles.mjs";
import { describeSummary } from "./recommend.mjs";
import { settledAt } from "./frames.mjs";

/* -------------------------------------------- */
/*  Formatting helpers                          */
/* -------------------------------------------- */

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ENTITIES[c]);

export function fmtBytes(b) {
  if ( !Number.isFinite(b) ) return "–";
  if ( b < 1024 ) return `${b} B`;
  if ( b < 1024 * 1024 ) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtMs(n) {
  if ( !Number.isFinite(n) ) return "–";
  if ( Math.abs(n) < 1000 ) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(1)} s`;
}

export const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Display name for a package key: modules by id, other kinds with their type ("dnd5e (system)", "core"). */
const pkg = key => {
  const { type, id } = splitKey(key ?? "unknown");
  return ((type === "module") || (type === id)) ? id : `${id} (${type})`;
};

const PHASE_ORDER = [
  ["responseEnd", "Page received"], ["domInteractive", "Page parsed"], ["scriptEval", "Performance Triage loaded"],
  ["init", "init"], ["i18nInit", "i18nInit"], ["setup", "setup"], ["canvasInit", "canvasInit"],
  ["canvasReady", "canvasReady (first scene drawn)"], ["ready", "ready hook fired"],
  ["readyComplete", "ready handlers finished"], ["settled", "Settled (no long freeze for 2 s)"]
];

/** When startup really finished, counting freezes that continue right after the ready handlers. */
export function settledTime(report) {
  const frames = [...(report.longFrames?.load?.worst ?? []), ...(report.longFrames?.play?.worst ?? [])];
  return settledAt(report.timeline?.marks?.readyComplete, frames);
}

/** Ordered startup phases with absolute time and time since the previous phase. */
export function timelineRows(timeline, settled = null) {
  const all = { ...(timeline?.navigation ?? {}), ...(timeline?.marks ?? {}) };
  if ( Number.isFinite(settled) && (settled > (all.readyComplete ?? 0)) ) all.settled = settled;
  const rows = [];
  let previous = 0;
  for ( const [key, label] of PHASE_ORDER ) {
    const at = all[key];
    if ( !Number.isFinite(at) ) continue;
    rows.push({ label, at, delta: at - previous });
    previous = at;
  }
  return rows;
}

/* -------------------------------------------- */
/*  Table model shared by HTML and Markdown     */
/* -------------------------------------------- */

/** Each section yields { title, intro?, tables: [{caption?, head, rows}], notes?, actions? } */
function sections(report, opts = {}) {
  const out = [];
  const tl = timelineRows(report.timeline, settledTime(report));
  out.push({
    id: "timeline",
    title: "Startup timeline",
    intro: "Time since the browser started loading the page. Large gaps point at the phase to investigate. "
      + "\"ready hook fired\" is when Foundry starts calling ready handlers; the game is usable once they finish.",
    tables: [{ head: ["Phase", "At", "Since previous"], rows: tl.map(r => [r.label, fmtMs(r.at), fmtMs(r.delta)]) }]
  });

  // Network
  const net = report.network?.load;
  if ( net?.total ) {
    const t = net.total;
    const head = ["Package", "Files", "Transferred", "Size", "JS", "Cached", "Revalidated", "Uncompressed text"];
    const row = p => [pkg(p.key), p.count, fmtBytes(p.transfer), fmtBytes(p.decoded), fmtBytes(p.scriptBytes),
      pct(p.cache, p.count), pct(p.revalidated, p.count), fmtBytes(p.uncompressedText)];
    const protocols = Object.entries(net.protocols ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "unknown";
    out.push({
      id: "network",
      title: "Files loaded during startup",
      intro: `${t.count} files, ${fmtBytes(t.transfer)} over the network, ${fmtBytes(t.decoded)} after decompression. `
        + `Protocols: ${protocols}.`
        + (report.network.truncated ? " Some early files (mostly stylesheets) are missing: the browser had already "
          + "dropped their timings before this module loaded." : ""),
      tables: [
        { caption: "By package (largest first)", head, rows: [...(net.packages ?? []).slice(0, 20).map(row), ["Total", ...row(t).slice(1)]] },
        { caption: "Largest files", head: ["File", "Package", "Size", "Delivery"],
          rows: (net.largest ?? []).slice(0, 10).map(f => [shortUrl(f.url), pkg(f.key), fmtBytes(f.decoded), f.delivery]) }
      ]
    });
  }

  // Long frames
  const lf = report.longFrames;
  if ( lf ) {
    const tables = [];
    for ( const [phase, data] of [["Startup", lf.load], ["Play", lf.play]] ) {
      if ( !data?.frames ) continue;
      tables.push({
        caption: `${phase}: ${plural(data.frames, "long frame")}, ${fmtMs(data.duration)} total, ${fmtMs(data.blocking)} blocking`,
        head: ["Script source", "Scripts", "Time", "Forced layout"],
        rows: (data.packages ?? []).slice(0, 12).map(p => [pkg(p.key), p.count, fmtMs(p.duration), fmtMs(p.layout)])
      });
    }
    const worst = [...(lf.load?.worst ?? []), ...(lf.play?.worst ?? [])].sort((a, b) => b.duration - a.duration);
    if ( worst.length ) {
      tables.push({
        caption: "Worst frames",
        head: ["At", "Length", "Phase", "Top scripts"],
        rows: worst.slice(0, 10).map(f => [fmtMs(f.start), fmtMs(f.duration), f.phase,
          f.scripts.map(s => `${pkg(s.key)} ${shortInvoker(s.fn || s.invoker)} ${s.duration} ms`).join("; ")])
      });
    }
    out.push({
      id: "longframes",
      title: "Long frames (stutters)",
      intro: lf.supported
        ? "Frames that took over 50 ms, attributed to the script that started them. Hooks and wrappers run inside "
          + "Foundry's own code, so long frames often name core even when a module did the work; the hook profiler "
          + "and actor timing break those down."
        : "This browser does not report long animation frames (Chrome, Edge and the Foundry desktop app do).",
      tables
    });
  }

  // Hook profiler
  const hk = report.hooks;
  out.push({
    id: "hooks",
    title: "Hook listener profiler",
    intro: hk
      ? `Synchronous time spent in hook listeners over the last ${fmtMs(hk.windowMs)}, attributed to the package `
        + "that registered each listener. \"Self\" excludes time spent in nested hooks."
      : "Off. When enabled (requires a reload), every hook listener is timed and attributed to its module. It adds a "
        + "small cost to every hook call, so turn it off again when you are done.",
    tables: hk ? [
      { caption: "By package", head: ["Package", "Hooks", "Calls", "Self time", "Worst call"],
        rows: hk.packages.slice(0, 25).map(p => [pkg(p.pkg), p.hooks, p.calls, fmtMs(p.self), fmtMs(p.max)]) },
      { caption: "Most expensive listeners", head: ["Package", "Hook", "Calls", "Self time", "Average", "Worst"],
        rows: hk.listeners.slice(0, 40).map(l => [pkg(l.pkg), l.hook, l.calls, fmtMs(l.self),
          `${(l.self / Math.max(l.calls, 1)).toFixed(2)} ms`, fmtMs(l.max)]) }
    ] : [],
    actions: hk
      ? [["resetHooks", "Reset counters"], ["toggleHookProfiler", "Disable profiler (reload)"]]
      : [["toggleHookProfiler", "Enable profiler (reload)"]]
  });

  // Startup payload
  if ( report.payload ) {
    const p = report.payload;
    out.push({
      id: "payload",
      title: "World data sent to every client",
      intro: "Approximate serialized size of the initial world data, measured at init.",
      tables: [
        { head: ["Section", "Size", "Documents"], rows: p.sections.slice(0, 15).map(s => [s.key, fmtBytes(s.bytes), s.count || ""]) },
        { caption: "Compendium indexes by package", head: ["Package", "Size", "Packs", "Entries"],
          rows: p.packs.slice(0, 15).map(x => [pkg(x.key), fmtBytes(x.bytes), x.packs, x.entries]) }
      ]
    });
  }

  // CPU profile
  const sp = report.sampler;
  const support = opts.sampler;
  out.push({
    id: "cpu",
    title: "CPU profile",
    intro: sp
      ? `${sp.seconds} s recorded at ${sp.recordedAt}: ${fmtMs(sp.sampledMs - sp.idleMs)} busy of ${fmtMs(sp.sampledMs)}. `
        + "\"Responsible\" charges core work to the module that asked for it."
      : (support?.available
        ? "Records what the CPU is doing for 20 seconds. Play normally while it runs (move tokens, roll attacks)."
        : (support?.reason === "policy"
          ? "Your browser supports CPU sampling, but the server must send the header Document-Policy: js-profiling. See docs/hosting.md."
          : "CPU sampling needs a Chromium browser (Chrome, Edge) or the Foundry desktop app.")),
    tables: sp ? [
      { head: ["Package", "Responsible", "Self", "Inclusive"],
        rows: sp.packages.slice(0, 20).map(p => [pkg(p.key), fmtMs(p.responsible), fmtMs(p.self), fmtMs(p.inclusive)]) },
      { caption: "Hottest functions", head: ["Function", "Self time"], rows: sp.functions.slice(0, 15).map(f => [f.name, fmtMs(f.ms)]) }
    ] : [],
    actions: support?.available ? [["recordProfile", "Record 20 s CPU profile"]] : []
  });

  // Canvas
  const cv = report.canvas;
  const cl = report.client ?? {};
  const env = report.env ?? {};
  const perf = cl.canvasPerformance;
  const gpuRows = [
    ["GPU", env.gpu ?? "–"], ["WebGL 2", env.webgl2 ? "yes" : "no"], ["Max texture size", env.maxTexture ?? "–"],
    ["Device pixel ratio", env.dpr], ["Renderer resolution", cl.rendererResolution ?? "–"],
    ["Performance mode", perf ? ["Low", "Medium", "High", "Maximum"][perf.mode] ?? perf.mode : "–"],
    ["Frame cap", perf ? (perf.fps || "uncapped") : "–"],
    ["Measured frame rate", cl.fps ? `${cl.fps.achieved} fps over the first minute (target ${cl.fps.target})`
      : (Number.isFinite(cl.liveFps) ? `${cl.liveFps} fps when this report opened` : "not measured yet")],
    ["Soft light edges / SMAA / MSAA / mipmaps", perf ? [perf.lightSoftEdges, perf.smaa, perf.msaa, perf.mipmap].map(String).join(" / ") : "–"]
  ];
  const tables = [{ caption: "This client", head: ["", ""], rows: gpuRows }];
  if ( cv?.ready ) {
    const s = cv.scene;
    tables.push({
      caption: `Scene: ${s.name}`, head: ["", ""],
      rows: [
        ["Canvas size", `${s.width}x${s.height} px, grid ${s.gridSize}`],
        ["Tokens / tiles (video) / walls", `${s.tokens} / ${s.tiles} (${s.videoTiles}) / ${s.walls}`],
        ["Lights (animated) / sounds / regions", `${s.lights} (${s.animatedLights}) / ${s.sounds} / ${s.regions}`],
        ["Texture memory", `${fmtBytes(cv.textureMemory)} (${cv.textureMemorySource})`]
      ]
    });
    tables.push({
      caption: "Largest textures on this scene", head: ["Image", "Kind", "Dimensions", "GPU memory"],
      rows: cv.textures.slice(0, 10).map(t => [shortUrl(t.src), t.video ? `${t.kind} (video)` : t.kind, `${t.width}x${t.height}`, fmtBytes(t.bytes)])
    });
  }
  const fc = report.frameCost;
  if ( fc?.rows ) {
    tables.push({
      caption: `What each layer costs on this computer (${fc.scene}: ${fc.baseline} fps with everything visible, `
        + `${fc.baselineEnd} fps at the end${fc.stable ? "" : "; drifted, treat as rough"})`,
      head: ["Hidden for the test", "Frame rate", "Time saved per frame"],
      rows: fc.rows.map(r => [r.label, `${r.fps} fps`, `${r.atLimit ? "at least " : ""}${r.savedMs} ms`])
    });
  }
  out.push({
    id: "canvas",
    title: "Canvas and GPU",
    intro: cv?.ready
      ? "\"Measure layer costs\" hides each part of the canvas for a few seconds and counts frames. It takes about "
        + "30 seconds; the map will flicker, and nothing is saved or changed for anyone else."
      : "",
    tables,
    actions: cv?.ready ? [["measureFrameCost", "Measure layer costs (about 30 s)"]] : []
  });

  // World
  const w = report.world;
  if ( w ) {
    const t = [{ head: ["Collection", "Documents"], rows: Object.entries(w.counts).map(([k, v]) => [k, v]) }];
    if ( w.heavyActors?.length ) {
      t.push({ caption: "Actors with the most embedded documents", head: ["Actor", "Type", "Items", "Effects"],
        rows: w.heavyActors.map(a => [a.name, a.type, a.items, a.effects]) });
    }
    if ( w.packs ) {
      t.push({ caption: `Compendiums: ${w.packs.count} packs, ${w.packs.entries} index entries`, head: ["Package", "Packs", "Entries"],
        rows: w.packs.byPackage.map(p => [pkg(p.key), p.packs, p.entries]) });
    }
    if ( report.prep ) {
      t.push({ caption: `Actor preparation: ${report.prep.count} actors in ${fmtMs(report.prep.totalMs)}`,
        head: ["Actor", "Type", "Time", "Items", "Effects"],
        rows: report.prep.actors.slice(0, 15).map(a => [a.name, a.type, fmtMs(a.ms), a.items, a.effects]) });
    }
    out.push({
      id: "world", title: "World contents", tables: t,
      actions: [["benchmarkActors", "Time actor preparation"]]
    });
  }

  // Modules
  const m = report.modules;
  if ( m?.list ) {
    const t = [];
    if ( m.outdated?.length ) {
      t.push({ caption: `Modules with code not verified for Foundry ${report.env?.generation}`
        + (m.outdatedContent ? ` (plus ${plural(m.outdatedContent, "content-only pack")}, which run no code)` : ""),
        head: ["Module", "Version", "Verified for"],
        rows: m.outdated.map(x => [x.id, x.version, x.verified || "?"]) });
    }
    if ( m.debug?.length ) t.push({ caption: "Debug output enabled", head: ["Setting", "Value"], rows: m.debug.map(d => [d.label, JSON.stringify(d.value)]) });
    out.push({ id: "modules", title: `Modules (${m.active} active)`, tables: t });
  }

  // Players
  if ( report.players?.length ) {
    out.push({
      id: "players",
      title: "Players",
      intro: "What each client shared about itself on its last load. Assign profiles in Client Profiles.",
      tables: [{
        head: ["User", "Online", "Assigned", "Running", "Last report", "Suggested"],
        rows: report.players.map(p => [p.name + (p.isGM ? " (GM)" : ""), p.active ? "yes" : "no", p.assigned, p.profile,
          describeSummary(p.summary), suggestProfile(p.summary) ?? "–"])
      }],
      actions: [["openProfiles", "Client profiles"]]
    });
  }
  return out;
}

/** Browser invoker names can embed whole data: URIs (an image's onload); keep them readable. */
function shortInvoker(text) {
  const s = String(text ?? "").replace(/data:[^"'\])]{16,}/g, "data:…");
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

function shortUrl(url) {
  try {
    const u = new URL(url, "http://x/");
    return decodeURIComponent(u.pathname).replace(/^\//, "");
  } catch {
    return String(url ?? "");
  }
}

/* -------------------------------------------- */
/*  HTML                                        */
/* -------------------------------------------- */

const SEVERITY_LABEL = { high: "High", medium: "Medium", low: "Low", info: "Info" };

function htmlTable({ caption, head, rows }) {
  if ( !rows?.length ) return "";
  const cap = caption ? `<caption>${esc(caption)}</caption>` : "";
  const th = head.some(h => h) ? `<thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>` : "";
  const body = rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<table class="ptriage-table">${cap}${th}<tbody>${body}</tbody></table>`;
}

function htmlActions(actions) {
  if ( !actions?.length ) return "";
  return `<div class="ptriage-actions">${actions.map(([action, label]) =>
    `<button type="button" data-action="${esc(action)}">${esc(label)}</button>`).join("")}</div>`;
}

export function reportToHtml(report, opts = {}) {
  const env = report.env ?? {};
  const load = report.network?.load?.total;
  const lfFrames = (report.longFrames?.load?.frames ?? 0) + (report.longFrames?.play?.frames ?? 0);
  const idle = report.profile?.idle;
  const marks = report.timeline?.marks ?? {};
  const usable = settledTime(report) ?? marks.readyComplete ?? marks.ready;
  const fps = report.client?.fps?.achieved ?? report.client?.liveFps;
  const cards = [
    ["Time until usable", fmtMs(usable)],
    ["Frame rate", Number.isFinite(fps) ? `${fps} fps` : "–"],
    ["Files at startup", load ? `${load.count} (${fmtBytes(load.transfer)})` : "–"],
    ["Long frames", report.longFrames?.supported ? String(lfFrames) : "n/a"],
    ["Texture memory", report.canvas?.ready ? fmtBytes(report.canvas.textureMemory) : "–"],
    ["Profile", `${report.profile?.id ?? "none"}${idle ? (idle.throttled ? " (idle: throttled)" : " (idle throttle on)") : ""}`],
    ["Active modules", String(report.modules?.active ?? "–")]
  ].map(([k, v]) => `<div class="ptriage-card"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");

  const findings = report.findings?.length
    ? `<ol class="ptriage-findings">${report.findings.map(f => `<li class="sev-${esc(f.severity)}">
        <span class="ptriage-badge">${esc(SEVERITY_LABEL[f.severity])}</span> <span class="ptriage-area">${esc(f.area)}</span>
        <strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p>${f.fix ? `<p class="ptriage-fix">${esc(f.fix)}</p>` : ""}</li>`).join("")}</ol>`
    : "<p>No findings. If the game still feels slow, enable the hook profiler and play for a while, then refresh.</p>";

  const body = sections(report, opts).map(s => `<details class="ptriage-section" data-section="${esc(s.id)}"${opts.open?.has(s.id) ? " open" : ""}>
      <summary>${esc(s.title)}</summary>${s.intro ? `<p>${esc(s.intro)}</p>` : ""}
      ${s.tables.map(htmlTable).join("")}${htmlActions(s.actions)}</details>`).join("");

  return `<header class="ptriage-header">
      <p>${esc(`Foundry ${env.core} · ${env.system} · ${env.browser ?? ""}`)}</p>
      <div class="ptriage-cards">${cards}</div>
      <div class="ptriage-actions">
        <button type="button" data-action="refresh"><i class="fa-solid fa-rotate"></i> Refresh</button>
        <button type="button" data-action="copyMarkdown"><i class="fa-solid fa-copy"></i> Copy as Markdown</button>
        <button type="button" data-action="downloadJson"><i class="fa-solid fa-download"></i> Download JSON</button>
      </div>
    </header>
    <h3>Findings</h3>${findings}${body}`;
}

/* -------------------------------------------- */
/*  Markdown                                    */
/* -------------------------------------------- */

const mdCell = c => String(c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function mdTable({ caption, head, rows }) {
  if ( !rows?.length ) return "";
  const lines = [];
  if ( caption ) lines.push(`**${caption}**`, "");
  const h = head.some(x => x) ? head : head.map(() => " ");
  lines.push(`| ${h.map(mdCell).join(" | ")} |`, `|${h.map(() => " --- ").join("|")}|`);
  for ( const r of rows ) lines.push(`| ${r.map(mdCell).join(" | ")} |`);
  return `${lines.join("\n")}\n`;
}

export function reportToMarkdown(report, opts = {}) {
  const env = report.env ?? {};
  const lines = [
    `# Performance Triage report`,
    "",
    `Generated ${report.generatedAt} by ${env.user}${env.isGM ? " (GM)" : ""}.`,
    `Foundry ${env.core}, ${env.system}, ${report.modules?.active ?? "?"} active modules. Browser: ${env.browser}. `
      + `${env.cores ?? "?"} threads, ${env.memory ?? "?"} GB reported memory, ${env.screen} @ ${env.dpr}x.`,
    `Profile: ${report.profile?.id ?? "none"}; chat batch size ${report.profile?.chatBatchSize ?? "default"}.`,
    "",
    "## Findings",
    ""
  ];
  if ( !report.findings?.length ) lines.push("None.", "");
  for ( const f of report.findings ?? [] ) {
    lines.push(`- **[${SEVERITY_LABEL[f.severity]}] ${f.title}** (${f.area}). ${f.detail}${f.fix ? ` *Fix:* ${f.fix}` : ""}`);
  }
  lines.push("");
  for ( const s of sections(report, opts) ) {
    lines.push(`## ${s.title}`, "");
    if ( s.intro ) lines.push(s.intro, "");
    for ( const t of s.tables ) {
      const md = mdTable(t);
      if ( md ) lines.push(md);
    }
  }
  return lines.join("\n");
}
