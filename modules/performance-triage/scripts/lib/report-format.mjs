/**
 * Render a collected report as HTML (for the report window) or Markdown (for sharing).
 * Pure string building with explicit escaping; no Foundry globals so it can be tested in Node.
 */
import { splitKey } from "./attribution.mjs";
import { suggestProfile } from "./profiles.mjs";
import { describeSummary } from "./recommend.mjs";
import { settledAt, worldDataWait } from "./frames.mjs";
import { median } from "./history.mjs";

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
  ["worldData", "World data arrived (estimated)"], ["init", "init"], ["i18nInit", "i18nInit"], ["setup", "setup"], ["canvasInit", "canvasInit"],
  ["canvasReady", "canvasReady (first scene drawn)"], ["ready", "ready hook fired"],
  ["readyComplete", "ready handlers finished"], ["settled", "Settled (no long freeze for 2 s)"]
];

/** When startup really finished, counting freezes that continue right after the ready handlers. */
export function settledTime(report) {
  const frames = [...(report.longFrames?.load?.worst ?? []), ...(report.longFrames?.play?.worst ?? [])];
  return settledAt(report.timeline?.marks?.readyComplete, frames);
}

/** How long the page waited on the server for the world data, when the long frames show it. */
export function worldWait(report) {
  return worldDataWait(report.timeline, report.longFrames?.load?.worst);
}

/** Ordered startup phases with absolute time and time since the previous phase. */
export function timelineRows(timeline, settled = null, worldData = null) {
  const all = { ...(timeline?.navigation ?? {}), ...(timeline?.marks ?? {}) };
  if ( Number.isFinite(settled) && (settled > (all.readyComplete ?? 0)) ) all.settled = settled;
  if ( Number.isFinite(worldData) ) all.worldData = worldData;
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
  const tl = timelineRows(report.timeline, settledTime(report), worldWait(report)?.to);
  out.push({
    id: "timeline",
    title: "Startup timeline",
    intro: "Time since the browser started loading the page. Large gaps point at the phase to investigate. "
      + "Before \"World data arrived\" the page is idle, waiting on the server and the network; after it, this "
      + "computer is building the world. \"ready hook fired\" is when Foundry starts calling ready handlers; the "
      + "game is usable once they finish.",
    tables: [{ head: ["Phase", "At", "Since previous"], rows: tl.map(r => [r.label, fmtMs(r.at), fmtMs(r.delta)]) },
      ...historyTables(report.history, report.env?.user)]
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
      intro: "Approximate serialized size of the initial world data, measured at init"
        + (Number.isFinite(p.ms) ? ` in ${fmtMs(p.ms)}. The measurement only runs while the hook profiler is on.` : "."),
      tables: [
        { head: ["Section", "Size", "Documents"], rows: p.sections.slice(0, 15).map(s => [s.key, fmtBytes(s.bytes), s.count || ""]) },
        ...payloadDetailTables(p.detail ?? {}),
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
    ["Render scale", `${Math.round((cl.renderScale ?? 1) * 100)}%`],
    ["Lighting resolution", lightingResolution(cl)],
    ["Performance mode", perf ? ["Low", "Medium", "High", "Maximum"][perf.mode] ?? perf.mode : "–"],
    ["Frame cap", perf ? (perf.fps || "uncapped") : "–"],
    ["Measured frame rate", cl.fps ? `${cl.fps.achieved} fps over the first minute (target ${cl.fps.target})`
      : (Number.isFinite(cl.liveFps) ? `${cl.liveFps} fps when this report opened` : "not measured yet")],
    ["Soft light edges / SMAA / MSAA / mipmaps", perf ? [perf.lightSoftEdges, perf.smaa, perf.msaa, perf.mipmap].map(String).join(" / ") : "–"]
  ];
  const tables = [{ caption: "This client", head: ["", ""], rows: gpuRows }];
  const autoChanges = cl.lightingAuto?.history ?? [];
  if ( autoChanges.length ) {
    tables.push({
      caption: "Automatic lighting resolution on this computer: steps down are kept only when the frame rate rose",
      head: ["Scene", "Minutes after loading", "Change", "Frame rate before", "After"],
      rows: autoChanges.map(h => [h.scene || "–", Math.round(h.at / 6000) / 10,
        `${Math.round(h.from * 100)}% → ${Math.round(h.to * 100)}%${h.kept === false ? " (undone: no faster)" : ""}`,
        `${h.before} fps`, Number.isFinite(h.after) ? `${h.after} fps` : "–"])
    });
  }
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
    const lc = cv.lightCoverage;
    if ( lc?.count ) {
      tables.push({
        caption: `Lights on this scene: ${lc.count} drawn, covering ${lc.cover}x the scene's area; they reach `
          + `${Math.round(lc.lit * 100)}% of it, ${lc.overlap} lights deep on average`
          + (lc.unwalled ? `; ${lc.unwalled} ignore walls` : ""),
        head: ["Largest lights", "Radius", "Walls", "Share of all light area", "Other lights over the same area"],
        rows: lc.largest.map(l => [l.kind === "token" ? `Token: ${l.name}` : "Light", s.gridSize ? `${Math.round((l.radius / s.gridSize) * 10) / 10} grid` : `${l.radius} px`,
          l.walls ? "yes" : "ignored", `${Math.round(l.share * 100)}%`, l.overlap])
      });
    }
    tables.push({
      caption: "Largest textures on this scene", head: ["Image", "Kind", "Dimensions", "GPU memory"],
      rows: cv.textures.slice(0, 10).map(t => [shortUrl(t.src), t.video ? `${t.kind} (video)` : t.kind, `${t.width}x${t.height}`, fmtBytes(t.bytes)])
    });
  }
  const fc = report.frameCost;
  if ( fc?.rows ) {
    tables.push({
      caption: `What each layer costs on this computer (${fc.scene}: ${fc.baseMs} ms to draw a frame with everything `
        + `visible, ${fc.baseMsEnd} ms at the end${fc.stable ? "" : ", so treat these as rough"}; ${fc.baseline} fps uncapped)`,
      head: ["Hidden or changed for the test", "Time to draw a frame", "Time saved per frame"],
      rows: fc.rows.map(r => [r.parent ? `↳ ${r.label}` : r.label, `${r.ms} ms`, `${r.savedMs} ms`])
    });
  }
  out.push({
    id: "canvas",
    title: "Canvas and GPU",
    intro: cv?.ready
      ? "\"Measure layer costs\" hides each part of the canvas for a moment and times how long a frame takes to "
        + "draw, waiting for the graphics card to finish each one, so it works whatever the frame cap or the screen's "
        + "refresh rate. It takes about 30 seconds, longer when lighting or the interface cost enough to be broken "
        + "down into their parts; the map will flicker, and nothing is saved or changed for anyone else."
      : "",
    tables,
    actions: cv?.ready ? [["measureFrameCost", "Measure layer costs (30 to 60 s)"],
      ...((report.env?.isGM && cv.lightCoverage?.largest?.some(l => l.kind === "light")) ? [["selectLargestLights", "Select the largest lights"]] : [])] : []
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
      const tok = report.prep.tokens;
      if ( tok?.count ) {
        t.push({ caption: `Unlinked token actors: ${tok.count} on all scenes in ${fmtMs(tok.totalMs)}`,
          head: ["Token", "Scene", "Time", "Items", "Effects"],
          rows: tok.rows.slice(0, 15).map(a => [a.name, a.scene, fmtMs(a.ms), a.items, a.effects]) });
      }
      if ( tok?.byScene?.length ) {
        t.push({ caption: "Unlinked token actors by scene", head: ["Scene", "Tokens", "Time"],
          rows: tok.byScene.slice(0, 10).map(s => [s.name, s.tokens, fmtMs(s.ms)]) });
      }
    }
    out.push({
      id: "world", title: "World contents", tables: t,
      actions: [["benchmarkActors", "Time actor preparation"],
        ...(report.env?.isGM ? [["openScenePlan", "Plan scene archiving"], ["openTokenCensus", "Actors and tokens"]] : [])]
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

  // Frame rate during play
  const play = report.play;
  if ( play ) {
    const t = [...playTables(play.current, "this session"), ...playTables(play.previous, "the previous session")];
    out.push({
      id: "play",
      title: "Frame rate during play",
      intro: play.tracking
        ? "Measured on every computer while the GM has it on: the frame rate in five-second stretches while this "
          + "window had focus (not while idle-throttled); stutters, which are frames over 50 ms and over 2.5 times the "
          + "scene's normal frame time; and, for each token move on the scene being viewed, the time frames took "
          + "beyond the scene's normal frame time until two seconds after the move's animation ended."
        : "Not being measured. The GM can turn on Measure frame rate during play in this module's settings.",
      tables: t,
      actions: (report.env?.isGM && !play.tracking) ? [["enableTrackPlay", "Measure frame rate during play"]] : []
    });
  }

  // Players
  if ( report.players?.length ) {
    out.push({
      id: "players",
      title: "Players",
      intro: "What each client shared about itself on its last load. Assign profiles in Client Profiles.",
      tables: [{
        head: ["User", "Online", "Assigned", "Running", "Last report", "Slowest scene last session", "Suggested"],
        rows: report.players.map(p => [p.name + (p.isGM ? " (GM)" : ""), p.active ? "yes" : "no", p.assigned, p.profile,
          describeSummary(p.summary), slowestScene(p.summary?.play), suggestProfile(p.summary) ?? "–"])
      }],
      actions: [["openProfiles", "Client profiles"]]
    });
  }
  return out;
}

/** "50% (illumination 50%, light colours 50%)", or what the setting asked for when the layers weren't read. */
function lightingResolution(cl) {
  const asked = `${cl.lightingAuto ? "Automatic, now " : ""}${Math.round((cl.lightingScale ?? 1) * 100)}%`;
  const actual = cl.lightingResolution;
  if ( !actual ) return asked;
  const parts = Object.entries(actual).map(([k, v]) => `${k === "coloration" ? "light colours" : k} ${Math.round(v * 100)}%`);
  return `${asked} (${parts.join(", ")} of the canvas)`;
}

/** "Castle: about 22 of 60 fps" for the slowest scene with a minute or more measured. */
export function slowestScene(play) {
  const s = (play?.scenes ?? []).filter(x => (x.minutes >= 1) && Number.isFinite(x.fps))
    .sort((a, b) => (a.fps / (a.target || 60)) - (b.fps / (b.target || 60)))[0];
  return s ? `${s.name}: about ${Math.round(s.fps)} of ${s.target || 60} fps` : "–";
}

function playTables(data, label) {
  if ( !data?.scenes?.length && !data?.moves ) return [];
  const t = [];
  if ( data.scenes?.length ) {
    t.push({
      caption: `Frame rate by scene, ${label}${data.at ? ` (${new Date(data.at).toLocaleString()})` : ""}`,
      head: ["Scene", "Minutes", "Cap", "Median", "Lowest tenth", "Stutters a minute", "Token moves", "Median move stall"],
      rows: data.scenes.map(x => [x.name, x.minutes, x.target || "none", Number.isFinite(x.fps) ? `${Math.round(x.fps)} fps` : "–",
        Number.isFinite(x.low) ? `${Math.round(x.low)} fps` : "–", x.stuttersPerMin ?? x.longPerMin, x.moves,
        Number.isFinite(x.moveMs) ? fmtMs(x.moveMs) : "–"])
    });
  }
  const mv = data.moves;
  if ( mv?.packages?.length ) {
    t.push({
      caption: `Script time in long frames after token moves (drawing the canvas left out), ${label}: ${mv.count} moves, median stall `
        + `${fmtMs(mv.medianMs)}, worst ${fmtMs(mv.worstMs)}, about ${mv.fps} fps while tokens moved`,
      head: ["Package", "Script time", "Share"],
      rows: mv.packages.map(p => [pkg(p.key), fmtMs(p.ms), pct(p.ms, mv.packages.reduce((a, x) => a + x.ms, 0))])
    });
  }
  return t;
}

/** Earlier loads on this computer, newest first, recorded a minute after each load. */
function historyTables(history, user) {
  if ( !history?.length ) return [];
  const when = at => {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? "–" : d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  };
  // Several logins can share one browser (a GM testing as a player), and a GM's load differs from a player's
  const mine = history.filter(h => !h.user || !user || (h.user === user));
  const usable = median(mine.map(h => h.usable));
  return [{
    caption: `Load history in this browser: ${history.length} load${history.length === 1 ? "" : "s"}; median time `
      + `until usable${user ? ` for ${user}` : ""} ${fmtMs(usable)}. Server waits vary between loads, so compare several.`,
    head: ["When", "User", "Until usable", "Waiting for server", "Building (init to setup)", "Ready handlers", "Scenes",
      "Tokens", "World data", "Frame rate", "Profile"],
    rows: history.map(h => [when(h.at), h.user ? `${h.user}${h.gm ? " (GM)" : ""}` : "–", fmtMs(h.usable), fmtMs(h.wait), fmtMs(h.build), fmtMs(h.readyHandlers),
      h.scenes ?? "–", h.tokens ?? "–", Number.isFinite(h.worldBytes) ? fmtBytes(h.worldBytes) : "–",
      Number.isFinite(h.fps) ? `${h.fps} fps` : "–", h.profile ?? "–"])
  }];
}

/** Breakdown tables for the parts of the world data that are usually largest. */
function payloadDetailTables(detail) {
  const tables = [];
  const sc = detail.scenes;
  if ( sc ) {
    tables.push({
      caption: `Scenes by part (unlinked tokens' own actor data: ${fmtBytes(sc.tokenDelta)})`,
      head: ["Part", "Size"], rows: sc.parts.map(x => [x.key, fmtBytes(x.bytes)])
    });
    tables.push({
      caption: "Largest scenes", head: ["Scene", "Size", "Tokens", "Walls"],
      rows: sc.largest.map(x => [x.name, fmtBytes(x.bytes), x.tokens, x.walls])
    });
    const tk = sc.tokens;
    if ( tk?.count ) {
      const split = tk.added
        ? ` ${tk.items - tk.same.items - tk.added.items} differ from the sidebar actor's item, ${tk.added.items} are `
          + `items the sidebar actor doesn't have (${tk.added.duplicates} with the same name and type as one it does), `
          + `${tk.same.items} (${fmtBytes(tk.same.bytes)}) are identical apart from timestamps.`
        : ` ${tk.same.items} of those copies (${fmtBytes(tk.same.bytes)}) match the sidebar actor's item exactly apart `
          + "from timestamps.";
      tables.push({
        caption: `Tokens: ${tk.count} on all scenes, ${tk.unlinked} unlinked. ${tk.withItems} store their own copies of `
          + `${tk.items} items.${split}`,
        head: ["Token data", "Size"],
        rows: [
          ...tk.parts.map(x => [`delta: ${x.key}`, fmtBytes(x.bytes)]),
          ["Linked tokens that still store items or effects", `${tk.linkedDelta.tokens} (${fmtBytes(tk.linkedDelta.bytes)})`],
          ["Unlinked tokens whose actor no longer exists", `${tk.missingActor.tokens} (${fmtBytes(tk.missingActor.bytes)})`]
        ]
      });
      tables.push({
        caption: "Token data by the sidebar actor the tokens are based on (tokens are often renamed)",
        head: ["Actor", "Tokens", "Size", "Item copies", "Token names"],
        rows: tk.byActor.map(g => [g.actor ?? "(no actor)", g.tokens, fmtBytes(g.bytes), g.items,
          (g.names ?? []).map(n => (n.count > 1 ? `${n.name} ×${n.count}` : n.name)).join(", ")
            + ((g.distinctNames ?? 0) > (g.names?.length ?? 0) ? `, and ${g.distinctNames - g.names.length} more` : "")])
      });
      if ( tk.repeated?.top?.length ) {
        tables.push({
          caption: `Items repeated on many tokens: ${tk.repeated.items} copies, ${fmtBytes(tk.repeated.bytes)}. Same `
            + "name, type and size on at least 5 tokens, and not on the sidebar actor.",
          head: ["Item", "Type", "Tokens", "Size", "Flags from"],
          rows: tk.repeated.top.map(r => [r.name, r.type, r.tokens, fmtBytes(r.bytes), r.flags.join(", ") || "–"])
        });
      }
      tables.push({
        caption: "Largest tokens", head: ["Token", "Scene", "Linked", "Size", "Item copies", "Effects"],
        rows: tk.largest.map(t => [t.name, t.scene, t.linked ? "yes" : "no", fmtBytes(t.bytes), t.items, t.effects])
      });
    }
  }
  if ( detail.actors ) {
    tables.push({
      caption: "Largest world actors", head: ["Actor", "Type", "Size", "Items"],
      rows: detail.actors.largest.map(a => [a.name, a.type, fmtBytes(a.bytes), a.items])
    });
    const { unused, playerOwned } = detail.actors;
    if ( unused?.count ) {
      tables.push({
        caption: `Actors on no world scene that no player owns: ${unused.count} (${fmtBytes(unused.bytes)}). `
          + `Player-owned actors: ${playerOwned.count} (${fmtBytes(playerOwned.bytes)}).`,
        head: ["Type", "Actors", "Size"],
        rows: unused.byType.map(t => [t.type || "–", t.count, fmtBytes(t.bytes)])
      });
    }
  }
  if ( detail.settings ) {
    tables.push({
      caption: "World settings by package", head: ["Package", "Size", "Settings"],
      rows: detail.settings.byPackage.map(g => [g.key, fmtBytes(g.bytes), g.count])
    });
    if ( detail.settings.unowned?.packages?.length ) {
      tables.push({
        caption: "World settings of packages that aren't active (still sent to every client)",
        head: ["Package", "State", "Size", "Settings"],
        rows: detail.settings.unowned.packages.map(g => [g.key, (g.state === "inactive") ? "disabled" : "not installed",
          fmtBytes(g.bytes), g.count])
      });
    }
    if ( detail.settings.largest?.length ) {
      tables.push({
        caption: "Largest world settings. Entries that repeat a label can mean a list was imported twice.",
        head: ["Setting", "Size", "Entries", "Repeat a label", "Identical"],
        rows: detail.settings.largest.map(x => [x.key, fmtBytes(x.bytes), x.entries ?? "–", x.sameLabel ?? "–",
          x.identical ?? "–"])
      });
    }
  }
  return tables;
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
  const wait = worldWait(report);
  const fps = report.client?.fps?.achieved ?? report.client?.liveFps;
  const cards = [
    ["Time until usable", fmtMs(usable)],
    ...(wait ? [["Waiting for the server", fmtMs(wait.ms)]] : []),
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
        <strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p>${f.fix ? `<p class="ptriage-fix">${esc(f.fix)}</p>` : ""}
        ${htmlActions((f.actions ?? []).map(a => [a.id, a.label]))}</li>`).join("")}</ol>`
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
