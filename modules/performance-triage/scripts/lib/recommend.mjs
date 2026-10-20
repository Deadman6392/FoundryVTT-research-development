/**
 * Turn a collected report into a ranked list of findings.
 * Pure function of the report object so the rules can be unit tested and tuned against exported reports.
 * Thresholds are heuristics, not hard limits; each finding states the measured number so the GM can judge.
 */
import { splitKey } from "./attribution.mjs";
import { suggestProfile } from "./profiles.mjs";

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
const MB = 1024 * 1024;

const mb = bytes => `${(bytes / MB).toFixed(1)} MB`;
const ms = n => `${Math.round(n)} ms`;
const name = key => splitKey(key).id;

export function recommend(report) {
  const out = [];
  const add = (severity, area, title, detail, fix) => out.push({ severity, area, title, detail, fix });

  // Debug output left enabled is the cheapest big win there is
  for ( const d of report.modules?.debug ?? [] ) {
    add("high", "Modules", `Debug logging is enabled: ${d.label}`,
      `${d.label} = ${JSON.stringify(d.value)}. Verbose logging runs on hot paths for every client that has it on.`,
      d.fix);
  }

  // Network delivery
  const net = report.network?.load;
  if ( net?.total?.count ) {
    const total = net.total;
    const protocols = net.protocols ?? {};
    const h1 = protocols["http/1.1"] ?? 0;
    const known = Object.values(protocols).reduce((a, b) => a + b, 0);
    if ( (known > 0) && (h1 / known > 0.5) && (total.count > 300) ) {
      add("high", "Hosting", "Files are served over HTTP/1.1",
        `${total.count} files were requested during load, ${Math.round(100 * h1 / known)}% over HTTP/1.1. `
        + "Browsers only open about six HTTP/1.1 connections per host, so hundreds of small module files queue up.",
        "Put Foundry behind a reverse proxy that speaks HTTP/2 or HTTP/3 (Caddy does this with no configuration). "
        + "See docs/hosting.md.");
    }
    if ( total.uncompressedText > 1 * MB ) {
      add("high", "Hosting", "Text files are sent uncompressed",
        `${mb(total.uncompressedText)} of JavaScript/CSS/JSON across ${total.uncompressedCount} files arrived without `
        + "gzip or brotli compression. Players on slow connections pay for every byte on a cold load.",
        "Enable compression in your reverse proxy (Caddy: `encode zstd gzip`; nginx: `gzip on` with js/css/json types).");
    }
    const revalidatedShare = total.count ? total.revalidated / total.count : 0;
    if ( (revalidatedShare > 0.4) && (total.revalidated > 200) ) {
      add("medium", "Hosting", "The browser re-checks most files on every load",
        `${total.revalidated} of ${total.count} files were revalidated with the server (HTTP 304). Each one is a full `
        + "round trip even though nothing is downloaded, which adds up quickly for remote players.",
        "Over HTTP/2 these checks share one connection and are cheap, so fixing HTTP/1.1 fixes most of this. "
        + "Do not override Foundry's caching headers in the proxy; Foundry advises against it (see docs/hosting.md).");
    }
    const topScripts = [...(net.packages ?? [])].filter(p => p.key.startsWith("module:"))
      .sort((a, b) => b.scriptBytes - a.scriptBytes).slice(0, 5).filter(p => p.scriptBytes > 1 * MB);
    if ( topScripts.length ) {
      add("low", "Modules", "Largest JavaScript payloads by module",
        topScripts.map(p => `${name(p.key)}: ${mb(p.scriptBytes)}`).join(", ")
        + ". Every client downloads, parses and compiles this on every cold load.",
        "If one of these is a convenience you rarely use, disabling it helps weak CPUs most.");
    }
  }

  // World payload
  const payload = report.payload;
  if ( payload?.sections?.length ) {
    const totalBytes = payload.sections.reduce((a, s) => a + s.bytes, 0);
    if ( totalBytes > 20 * MB ) {
      const top = payload.sections.slice(0, 4).map(s => `${s.key} ${mb(s.bytes)}`).join(", ");
      add("high", "World", `World data sent to every client is ${mb(totalBytes)}`,
        `Largest parts: ${top}. Every client downloads and parses all of this before the game starts.`,
        "Trim the largest sections: archive old chat, move unused actors/items into compendiums, and disable modules "
        + "whose compendiums you never use.");
    }
    const packTop = (payload.packs ?? []).slice(0, 3).filter(p => p.bytes > 2 * MB);
    if ( packTop.length ) {
      add("medium", "World", "Large compendium indexes are sent at startup",
        packTop.map(p => `${name(p.key)}: ${mb(p.bytes)} (${p.packs} packs, ${p.entries} entries)`).join("; "),
        "Compendium indexes for every active package are part of the startup payload. If you only use a few items "
        + "from a large content module, import those and disable the module.");
    }
  }

  // World hygiene
  const counts = report.world?.counts;
  if ( counts ) {
    if ( counts.messages > 3000 ) {
      add("high", "World", `Chat log has ${counts.messages} messages`,
        "Every client downloads and keeps the full chat log in memory, and modules that decorate chat cards may "
        + "process them on load.", "Export the chat log with the export button in the chat sidebar, then clear it between sessions or arcs.");
    } else if ( counts.messages > 1000 ) {
      add("medium", "World", `Chat log has ${counts.messages} messages`,
        "Large chat logs slow down joining for every client.", "Export and clear old chat messages periodically.");
    }
    if ( counts.actors > 500 ) {
      add("medium", "World", `${counts.actors} actors live in the world`,
        "World actors are all sent to and prepared by every client at startup. dnd5e data preparation is not cheap.",
        "Keep monsters and NPCs you are not using right now in compendiums; drag them in when needed.");
    }
    if ( counts.items > 1500 ) {
      add("low", "World", `${counts.items} items live in the world sidebar`,
        "Sidebar items are loaded by every client.", "Move reference items into a compendium.");
    }
  }
  const slowActors = (report.prep?.actors ?? []).filter(a => a.ms > 20).slice(0, 5);
  if ( slowActors.length ) {
    add("medium", "World", "Some actors are expensive to prepare",
      slowActors.map(a => `${a.name}: ${ms(a.ms)} (${a.items} items, ${a.effects} effects)`).join("; ")
      + ". Preparation runs on every client at load and again on every update to the actor.",
      "Look for duplicated or leftover items and effects on these actors.");
  }

  // Modules
  const outdated = report.modules?.outdated ?? [];
  if ( outdated.length ) {
    const count = outdated.length === 1 ? "1 active module is" : `${outdated.length} active modules are`;
    add("medium", "Modules", `${count} not verified for this Foundry version`,
      outdated.slice(0, 12).map(m => `${m.id} (verified ${m.verified || "?"})`).join(", ")
      + (outdated.length > 12 ? ", ..." : "")
      + ". Unverified modules often hit deprecated APIs, which log warnings and run slower compatibility shims.",
      "Update them, or replace abandoned ones; check the browser console for deprecation warnings naming them.");
  }
  if ( (report.modules?.active ?? 0) > 80 ) {
    add("info", "Modules", `${report.modules.active} modules are active`,
      "Module count by itself is not the problem; a handful of heavy modules usually are. Use the hook profiler and "
      + "the long frame table below to find which ones cost the most before disabling anything.", "");
  }

  // Hook cost
  const hookPkgs = (report.hooks?.packages ?? []).filter(p => p.pkg !== "core");
  const heavy = hookPkgs.filter(p => p.self > 250).slice(0, 5);
  if ( heavy.length ) {
    add("high", "Modules", "Modules with the most time spent in hook listeners",
      heavy.map(p => `${name(p.pkg)}: ${ms(p.self)} over ${p.calls} calls (worst ${ms(p.max)})`).join("; ")
      + ` during the last ${Math.round((report.hooks.windowMs ?? 0) / 1000)} s.`,
      "Check these modules' settings for features you do not use. Expand the hook table to see which hooks.");
  }
  const spiky = (report.hooks?.listeners ?? []).filter(l => (l.max > 50) && (l.pkg !== "core")).slice(0, 5);
  if ( spiky.length ) {
    add("medium", "Modules", "Hook listeners that froze the page for more than 50 ms at once",
      spiky.map(l => `${name(l.pkg)} on ${l.hook}: ${ms(l.max)}`).join("; "),
      "A single long listener is a visible stutter. Report it to the module author with this number.");
  }

  // Long frames attributed by the browser
  const lf = report.longFrames?.play;
  const lfTop = (lf?.packages ?? []).filter(p => p.key.startsWith("module:") && (p.duration > 500)).slice(0, 5);
  if ( lfTop.length ) {
    add("medium", "Modules", "Modules that started long frames during play",
      lfTop.map(p => `${name(p.key)}: ${ms(p.duration)} in ${p.count} scripts`).join("; "),
      "These scripts ran as the entry point of frames longer than 50 ms. The CPU profile gives a fuller picture.");
  }

  // CPU profile
  const prof = report.sampler;
  if ( prof?.packages?.length && (prof.sampledMs > 0) ) {
    const busy = prof.sampledMs - prof.idleMs;
    const top = prof.packages.filter(p => !["core", "native"].includes(p.key)).slice(0, 5)
      .filter(p => p.responsible > 0.05 * busy);
    if ( top.length ) {
      add("high", "Modules", "Modules responsible for the most CPU time in the recorded profile",
        top.map(p => `${name(p.key)}: ${Math.round(100 * p.responsible / Math.max(busy, 1))}%`).join(", ")
        + ` of ${ms(busy)} busy time.`, "These are the best candidates to reconfigure, replace or disable.");
    }
  }

  // Canvas and GPU
  const cv = report.canvas;
  if ( cv?.ready ) {
    if ( cv.textureMemory > 1.5 * 1024 * MB ) {
      add("high", "Scene", `Textures use about ${mb(cv.textureMemory)} of GPU memory`,
        "Integrated GPUs share system RAM; once textures exceed what fits, the browser starts evicting and re-uploading.",
        "Downscale oversized maps and token art (4096 px on the long side is plenty for most maps) and convert to WebP.");
    }
    const huge = (cv.textures ?? []).filter(t => Math.max(t.width, t.height) > 8192).slice(0, 5);
    if ( huge.length ) {
      add("medium", "Scene", "Very large images in this scene",
        huge.map(t => `${t.src.split("/").pop()} (${t.width}x${t.height})`).join(", "),
        "Images above 8192 px exceed the texture limit of many GPUs and are slow to decode. Downscale them.");
    }
    if ( cv.scene?.videoTiles > 0 ) {
      add("low", "Scene", `${cv.scene.videoTiles} video tiles in this scene`,
        "Each playing video decodes every frame on every client.", "Consider the Low or Minimum profile for weak clients.");
    }
    if ( cv.scene?.animatedLights > 25 ) {
      add("low", "Scene", `${cv.scene.animatedLights} animated lights`,
        "Light animations re-render every frame.", "Clients on the Low profile skip light animation automatically.");
    }
  }

  // This client
  const env = report.env ?? {};
  const fps = report.client?.fps;
  if ( fps?.achieved && fps.target && (fps.achieved < Math.min(fps.target, 60) * 0.5) && (report.profile?.id === "none") ) {
    add("medium", "This client", `This client renders about ${Math.round(fps.achieved)} fps (target ${fps.target})`,
      "The browser cannot keep up with the canvas at the current settings.",
      "Choose the Low profile in this module's settings, or ask the GM to assign one.");
  }
  if ( (env.dpr > 1) && report.client?.resolutionScaling && ((env.memory ?? 8) <= 8) ) {
    add("low", "This client", `Canvas renders at ${env.dpr}x pixel density`,
      `Resolution scaling multiplies the pixels drawn by about ${(env.dpr * env.dpr).toFixed(1)}x on this screen.`,
      "The Low profile turns resolution scaling off.");
  }

  // Players (GM view)
  for ( const p of report.players ?? [] ) {
    const suggestion = suggestProfile(p.summary);
    if ( suggestion && (p.profile === "none") ) {
      add("medium", "Players", `${p.name} may need the ${suggestion} profile`,
        describeSummary(p.summary), "Assign it in Performance Triage > Client Profiles.");
    }
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function describeSummary(s) {
  if ( !s ) return "No data shared yet.";
  const parts = [];
  if ( s.fps?.achieved ) parts.push(`${Math.round(s.fps.achieved)} of ${s.fps.target} fps`);
  if ( s.loadSeconds ) parts.push(`${Math.round(s.loadSeconds)} s to load`);
  if ( s.cores ) parts.push(`${s.cores} CPU threads`);
  if ( s.memory ) parts.push(`${s.memory} GB RAM (reported)`);
  if ( s.gpu ) parts.push(s.gpu);
  return parts.join(", ") || "No data shared yet.";
}
