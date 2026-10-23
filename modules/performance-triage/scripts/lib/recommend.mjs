/**
 * Turn a collected report into a ranked list of findings.
 * Pure function of the report object so the rules can be unit tested and tuned against exported reports.
 * Thresholds are heuristics, not hard limits; each finding states the measured number so the GM can judge.
 */
import { splitKey } from "./attribution.mjs";
import { suggestProfile } from "./profiles.mjs";
import { phasesWithin, worldDataWait } from "./frames.mjs";
import { SELF_KEY } from "../constants.mjs";
import { costlySettings, AURA_MODULES } from "./known-settings.mjs";

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
const MB = 1024 * 1024;

const mb = bytes => `${(bytes / MB).toFixed(1)} MB`;
const ms = n => `${Math.round(n)} ms`;
const secs = n => `${(n / 1000).toFixed(1)} s`;
const name = key => splitKey(key).id;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Other packages that also change how the client renders or stores data. Two tools changing the same settings end
 * up with whichever ran last, and it's easy to lose track of which one is responsible for what.
 * Descriptions are taken from each package's own listing.
 */
export const OVERLAPPING_PACKAGES = {
  "potato-or-not": "asks each player how fast their computer is and sets graphics settings to match",
  "force-client-settings": "lets the GM force or lock client settings for everyone",
  "performance-optimizer": "applies per-player graphics presets (Foundry v14)",
  "geanos-phantom-performance": "compresses actor, item and wall data in memory and decompresses it when accessed; "
    + "its listing describes it as experimental"
};

/** The button that answers what a startup freeze contains. */
function freezeAction(phases, can) {
  if ( phases.includes("ready") ) return can.hookProfiler;
  if ( phases.includes("canvasReady") || phases.includes("canvasInit") ) return can.layerCosts;
  if ( phases.includes("setup") ) return can.actorTiming;
  return can.hookProfiler;
}

/**
 * What some listeners that showed up in real reports are doing, read from each module's own source, keyed by
 * "package/hook". Added to a freeze finding when the hook profiler names that listener.
 */
const KNOWN_LISTENERS = {
  "module:sequencer/ready": "Sequencer's ready handler runs a migration check, on the GM only, that reads every token's "
    + "actor on every scene (src/migrations.js), so it grows with the number of tokens in the world: in one world it "
    + "fell from 16.6 s to 10.1 s when archiving took tokens from 1,150 to 751. Players don't run it."
};

/** Hooks whose listeners run inside each kind of startup freeze. */
const FREEZE_HOOKS = {
  ready: ["ready", "canvasReady"],
  canvasReady: ["canvasReady", "canvasInit"],
  setup: ["setup", "i18nInit"]
};

/**
 * Name what the hook profiler and actor timing found inside a freeze, or return "" when nothing was measured.
 * @returns {string}
 */
function freezeCulprits(phases, report) {
  const notes = [];
  const kind = phases.includes("ready") ? "ready" : (phases.includes("canvasReady") ? "canvasReady" : (phases.includes("setup") ? "setup" : null));
  const hooks = FREEZE_HOOKS[kind] ?? [];
  const listeners = (report.hooks?.listeners ?? [])
    .filter(l => hooks.includes(l.hook) && (l.max > 500) && (l.pkg !== SELF_KEY))
    .sort((a, b) => b.max - a.max).slice(0, 3);
  if ( listeners.length ) {
    notes.push("The hook profiler measured " + listeners.map(l => `${name(l.pkg)}'s ${l.hook} handler at ${secs(l.max)}`)
      .join(", ") + ".");
    for ( const l of listeners ) if ( KNOWN_LISTENERS[`${l.pkg}/${l.hook}`] ) notes.push(KNOWN_LISTENERS[`${l.pkg}/${l.hook}`]);
  }
  if ( (kind === "setup") && report.prep?.totalMs ) {
    notes.push(`Re-preparing all ${report.prep.count} world actors takes ${secs(report.prep.totalMs)} on this computer, `
      + "so world actors account for roughly that much; the rest is building scenes and the other world documents.");
  }
  return notes.join(" ");
}

/** What a startup freeze most likely contains, from the phases it spans. */
function explainFreeze(phases) {
  if ( phases.includes("ready") ) {
    return "It contains the ready hook, so it is usually modules' ready handlers. Turn on the hook profiler and "
      + "reload; its tables name the module and the hook.";
  }
  if ( phases.includes("canvasReady") || phases.includes("canvasInit") ) {
    return "It happens while the scene is drawn. Measure layer costs (Canvas section) and check the largest textures.";
  }
  if ( phases.includes("setup") ) {
    return "It ends at the setup hook. Just before setup, Foundry builds and prepares every world document, so use "
      + "\"Time actor preparation\" in the World section to see whether world actors are the cause.";
  }
  return "Turn on the hook profiler and reload to attribute it.";
}

export function recommend(report) {
  const out = [];
  // actions: buttons the report shows on the finding, so the next step is one click away
  const add = (severity, area, title, detail, fix, actions = []) => {
    out.push({ severity, area, title, detail, fix, actions: actions.filter(Boolean) });
  };
  const can = {
    hookProfiler: !report.hookProfilerEnabled && { id: "toggleHookProfiler", label: "Turn on the hook profiler (reloads)" },
    actorTiming: !report.prep && report.world && { id: "benchmarkActors", label: "Time actor preparation" },
    layerCosts: !report.frameCost && report.canvas?.ready && { id: "measureFrameCost", label: "Measure layer costs (30 to 60 s)" },
    lowProfile: (report.profile?.id === "none") && { id: "useLowProfile", label: "Use the Low profile on this computer (reloads)" },
    scenePlan: report.env?.isGM && { id: "openScenePlan", label: "Plan scene archiving" },
    tokenCensus: report.env?.isGM && { id: "openTokenCensus", label: "Actors and tokens" },
    trackPlay: report.env?.isGM && report.play && !report.play.tracking
      && { id: "enableTrackPlay", label: "Measure frame rate during play" },
    // Unlike layerCosts, offered again after a measurement: it belongs to the scene it was taken on
    measureLayers: report.canvas?.ready && { id: "measureFrameCost", label: "Measure layer costs (30 to 60 s)" },
    selectLights: report.env?.isGM && report.canvas?.lightCoverage?.largest?.some(l => l.kind === "light")
      && { id: "selectLargestLights", label: "Select the largest lights" }
  };

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
    const scenes = payload.detail?.scenes;
    if ( scenes && (scenes.bytes > 20 * MB) ) {
      const parts = scenes.parts.slice(0, 4).map(p => `${p.key} ${mb(p.bytes)}`).join(", ");
      const delta = scenes.tokenDelta > 0.25 * scenes.bytes
        ? ` Unlinked tokens' own actor data (their "delta") is ${mb(scenes.tokenDelta)} of that.` : "";
      add("high", "World", `Scenes are ${mb(scenes.bytes)} of the world data`,
        `By part: ${parts}.${delta} Largest scenes: `
        + scenes.largest.slice(0, 5).map(x => `${x.name} ${mb(x.bytes)} (${x.tokens} tokens, ${x.walls} walls)`).join("; ")
        + ". Every scene in the world is sent to every client at load, including ones nobody is using.",
        "Export scenes the party isn't near to a compendium and delete them from the world; bring them back when "
        + "needed. Keep their IDs on the way out and back in, so journal links and teleport regions that point at "
        + "them still work. The scene archive planner ranks scenes and lists what to prepare.",
        [can.scenePlan]);
    }
    const tk = scenes?.tokens;
    const itemBytes = tk?.parts?.find(p => p.key === "items")?.bytes ?? 0;
    if ( tk && (itemBytes > 10 * MB) ) {
      const byActor = tk.byActor.filter(g => g.items).slice(0, 4)
        .map(g => `${g.actor ?? "a deleted actor"} (${plural(g.tokens, "token")}, ${mb(g.bytes)})`).join("; ");
      // Older reports have no split between overrides and additions
      const added = tk.added?.items ?? 0;
      const overrides = tk.items - tk.same.items - added;
      const split = tk.added
        ? ` ${overrides} differ from the sidebar actor's version of the same item, ${added} are items the sidebar `
          + `actor doesn't have, and ${tk.same.items} are identical to it apart from timestamps.`
        : "";
      const examples = (tk.added?.examples ?? []).slice(0, 4)
        .map(e => `${e.token} on ${e.scene} (${e.items.join(", ")})`).join("; ");
      const doubled = tk.added?.duplicates
        ? ` ${tk.added.duplicates} of the added items share a name and type with an item the sidebar actor already `
          + `has, so those tokens probably show that item twice${examples ? `: ${examples}` : ""}.`
        : "";
      // The same few items on many tokens is what a module adding actions to every placed token leaves behind
      const rep = tk.repeated;
      const repeatedNote = (rep?.bytes > 0.25 * itemBytes)
        ? ` ${mb(rep.bytes)} of it is the same items repeated on many tokens: `
          + rep.top.slice(0, 6).map(r => `${r.name} (${r.tokens} tokens)`).join(", ")
          + (rep.top[0]?.flags?.length ? `. They carry flags from ${[...new Set(rep.top.flatMap(r => r.flags))].slice(0, 3).join(", ")}, a hint at what added them.` : ".")
        : "";
      // When most copies are items the sidebar actor lacks, the tokens are the only place those items exist
      const tokensOwnItems = tk.added && (added > tk.items / 2);
      const repeatedFix = repeatedNote
        ? " If a module adds those items to every token when it is placed, check whether it can add them to the "
          + "sidebar actor instead, or skip NPCs: one copy per actor instead of one per token. Copies already on tokens "
          + "stay until removed."
        : "";
      const fix = (tokensOwnItems
        ? "Archive scenes you aren't using; that removes their tokens' data from the load. Don't replace these tokens "
          + "with fresh ones from the sidebar actors to save space: most of their items exist only on the tokens, so "
          + "a fresh token would be missing them."
        : "Archiving scenes you aren't using removes their tokens' data from the load. On scenes you keep, a token "
          + "placed fresh from the sidebar actor carries no copies, but it is the sidebar actor's current version with "
          + "HP, name and conditions reset, so only replace tokens the party hasn't met.") + repeatedFix;
      add("high", "World", `Unlinked tokens store ${mb(itemBytes)} of their own item copies`,
        `${tk.withItems} of ${tk.unlinked} unlinked tokens store their own copies of ${tk.items} items.${split}${doubled} `
        + "An unlinked token normally stores only what differs from its sidebar actor, so a full set of copies means "
        + `each token carries its own version of every item.${repeatedNote} By the sidebar actor the tokens are based `
        + `on: ${byActor}.`,
        fix, [can.scenePlan, can.tokenCensus]);
    }
    if ( tk && (tk.linkedDelta.bytes > 1 * MB) ) {
      add("low", "World", `${plural(tk.linkedDelta.tokens, "linked token")} still store ${mb(tk.linkedDelta.bytes)} of actor data`,
        "A linked token uses its sidebar actor, so its own stored items and effects are not used while it stays "
        + "linked; they are still sent to every client.", "");
    }
    const settings = payload.detail?.settings;
    // A disabled or uninstalled module's world settings stay in the world and are still sent to every client
    const unowned = (settings?.unowned?.packages ?? []).filter(g => g.bytes > 0.1 * MB);
    if ( unowned.length ) {
      const state = { inactive: "disabled", missing: "not installed" };
      const names = new Set(unowned.map(g => g.key));
      const keyHint = (settings.largest ?? []).find(x => names.has(x.key.split(".")[0]))?.key;
      add((settings.unowned.bytes > 1 * MB) ? "medium" : "low", "World",
        `${mb(unowned.reduce((a, g) => a + g.bytes, 0))} of world settings belong to modules that aren't active`,
        unowned.map(g => `${g.key} (${state[g.state]}): ${mb(g.bytes)} in ${plural(g.count, "setting")}`).join("; ")
        + ". Foundry keeps a module's world settings after it is disabled or uninstalled and still sends them to "
        + "every client at every load. Nothing reads them while the module is off.",
        "If you won't turn the module back on, delete them with a script macro run by the GM, one setting key at a "
        + "time: await game.settings.storage.get(\"world\").getSetting(\"<key>\")?.delete()"
        + (keyHint ? `, for example with ${keyHint}` : "") + ". A module can store settings under a name other than its "
        + "id, so check the module list first. If you turn the module on again later it starts from its defaults "
        + "for those settings.");
    }
    if ( settings && (settings.bytes > 2 * MB) ) {
      const keys = (settings.largest ?? []).filter(x => x.bytes > 0.25 * MB).slice(0, 5);
      const entries = x => (x.entries ? ` (${x.entries} entries${x.sameLabel ? `, ${x.sameLabel} repeat a label` : ""})` : "");
      const repeats = keys.filter(x => x.sameLabel > 0.2 * x.entries);
      add("medium", "World", `World settings are ${mb(settings.bytes)}`,
        "Largest by package: " + settings.byPackage.slice(0, 5).map(g => `${g.key} ${mb(g.bytes)}`).join(", ")
        + (keys.length ? `. Largest settings: ${keys.map(x => `${x.key} ${mb(x.bytes)}${entries(x)}`).join(", ")}` : "")
        + ". Settings are loaded by every client; a module storing large data there costs everyone.",
        "Check that module's options for stored history or caches you can clear, or report it to its author."
        + (repeats.length ? ` Many entries in ${repeats.map(x => x.key).join(", ")} share a label with another `
          + "entry, which can mean a menu or preset list was imported more than once; export a backup from the "
          + "module's own menu before removing any." : ""));
    }
    const actorBytes = payload.detail?.actors;
    if ( actorBytes && (actorBytes.bytes > 10 * MB) ) {
      const unused = actorBytes.unused;
      const types = (unused?.byType ?? []).slice(0, 3).map(t => `${t.type || "other"} ${t.count} (${mb(t.bytes)})`).join(", ");
      const unusedNote = (unused?.count > 0)
        ? ` ${plural(unused.count, "actor")} (${mb(unused.bytes)}) are on no world scene and no player owns them: ${types}.`
        : "";
      add("medium", "World", `World actors are ${mb(actorBytes.bytes)} of the world data`,
        "Largest: " + actorBytes.largest.slice(0, 5).map(a => `${a.name} ${mb(a.bytes)} (${a.items} items)`).join("; ")
        + `.${unusedNote} Every world actor is sent to every client and prepared on it at load.`,
        "Move actors you won't need soon to an Actor compendium: put them in a folder, right-click it, Export to "
        + "Compendium with the option to keep IDs, then delete them from the world. Bring them back with the "
        + "compendium's Import All, keeping IDs, so tokens on archived scenes and journal links find them again; "
        + "dragging one actor out can give it a new ID. The scene planner's Actors and tokens tab lists which "
        + "actors no world scene uses.", [can.tokenCensus]);
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
    add("medium", "World", `Preparing all ${report.prep.count} world actors takes ${secs(report.prep.totalMs)} on this computer`,
      "Slowest: " + slowActors.map(a => `${a.name}: ${ms(a.ms)} (${a.items} items, ${a.effects} effects)`).join("; ")
      + ". Preparation runs on every client at load and again on every update to the actor.",
      "Look for duplicated or leftover items and effects on these actors.");
  }

  // Startup freezes: one task blocking the page for seconds, usually Foundry calling into modules
  const marks = report.timeline?.marks ?? {};
  for ( const frame of (report.longFrames?.load?.worst ?? []).filter(f => f.duration > 5000).slice(0, 3) ) {
    const phases = phasesWithin(frame, marks);
    const found = freezeCulprits(phases, report);
    add("high", "Startup", `The page froze for ${secs(frame.duration)} in one block during startup`,
      `From ${secs(frame.start)} to ${secs(frame.start + frame.duration)} after page load`
      + (phases.length ? `, spanning ${phases.join(", ")}` : "") + ". " + (found || explainFreeze(phases)),
      "", found ? [] : [freezeAction(phases, can)]);
  }

  // Waiting for the world: the page is idle until the server has sent all of it
  const wait = worldDataWait(report.timeline, report.longFrames?.load?.worst);
  if ( wait && (wait.ms > 5000) ) {
    const size = report.payload?.sections?.reduce((a, x) => a + x.bytes, 0);
    add(wait.ms > 15000 ? "high" : "medium", "Startup", `This computer waited ${secs(wait.ms)} for the world data`,
      `The page sat idle from ${secs(wait.from)} to ${secs(wait.to)} after load, waiting for the server to send the `
      + `world${size ? ` (${mb(size)})` : ""}. That is the server reading and sending it plus the download, so a `
      + "faster computer does not shorten it; a smaller world does.",
      "Shrink the world data (see the World findings). Compare players' reports: if everyone waits about as long, "
      + "it is the server and the world size; if one player waits much longer, it is their connection.",
      [!size && can.hookProfiler]);
  }

  // Modules
  const outdated = report.modules?.outdated ?? [];
  if ( outdated.length ) {
    const count = outdated.length === 1 ? "1 active module with code is" : `${outdated.length} active modules with code are`;
    const content = report.modules.outdatedContent
      ? ` (${plural(report.modules.outdatedContent, "content-only pack")} are also unverified, but they run no code.)`
      : "";
    add("medium", "Modules", `${count} not verified for this Foundry version`,
      outdated.slice(0, 12).map(m => `${m.id} (verified ${m.verified || "?"})`).join(", ")
      + (outdated.length > 12 ? ", ..." : "")
      + `. Unverified modules often hit deprecated APIs, which log warnings and run slower compatibility shims.${content}`,
      "Update them, or replace abandoned ones; check the browser console for deprecation warnings naming them.");
  }
  const active = new Set((report.modules?.list ?? []).map(m => m.id));
  const overlapping = Object.entries(OVERLAPPING_PACKAGES).filter(([id]) => active.has(id));
  if ( overlapping.length ) {
    add("medium", "Modules", "Other performance modules are active",
      overlapping.map(([id, what]) => `${id} ${what}`).join("; ") + ". When several tools change the same settings, "
      + "the last one to run wins, and it gets hard to tell which change helped.",
      "Pick one tool per job. Compare load time and long frames in this report with each one disabled.");
  }
  const drift = report.profile?.overridden ?? [];
  if ( drift.length ) {
    add("medium", "This client", `Something changed back ${plural(drift.length, "profile setting")}`,
      drift.map(d => `${d.key} is ${JSON.stringify(d.actual)}, profile wants ${JSON.stringify(d.wanted)}`).join("; ")
      + ". Another module, or a manual change, overrode the profile after it was applied.",
      "Check Force Client Settings locks or other performance modules; the profile reapplies on the next load.");
  }
  if ( (report.modules?.active ?? 0) > 80 ) {
    add("info", "Modules", `${report.modules.active} modules are active`,
      "Module count by itself is not the problem; a handful of heavy modules usually are. Use the hook profiler and "
      + "the long frame table below to find which ones cost the most before disabling anything.", "");
  }

  // Hook cost
  // This module's own cost while profiling (measuring the world data at init) is visible in the tables, not here
  const hookPkgs = (report.hooks?.packages ?? []).filter(p => (p.pkg !== "core") && (p.pkg !== SELF_KEY));
  const heavy = hookPkgs.filter(p => p.self > 250).slice(0, 5);
  if ( heavy.length ) {
    add("high", "Modules", "Modules with the most time spent in hook listeners",
      heavy.map(p => `${name(p.pkg)}: ${ms(p.self)} over ${p.calls} calls (worst ${ms(p.max)})`).join("; ")
      + ` during the last ${Math.round((report.hooks.windowMs ?? 0) / 1000)} s.`,
      "Check these modules' settings for features you do not use. Expand the hook table to see which hooks.");
  }
  const spiky = (report.hooks?.listeners ?? []).filter(l => (l.max > 50) && (l.pkg !== "core") && (l.pkg !== SELF_KEY)).slice(0, 5);
  if ( spiky.length ) {
    add("medium", "Modules", "Hook listeners that froze the page for more than 50 ms at once",
      spiky.map(l => `${name(l.pkg)} on ${l.hook}: ${ms(l.max)}`).join("; "),
      "A single long listener is a visible stutter. Report it to the module author with this number.");
  }

  // Long frames attributed by the browser
  const lf = report.longFrames?.play;
  // This module's long frames during play are measurements someone ran from the report (timing actors, layer
  // costs); they belong in the table, not in a finding about other modules
  const own = (lf?.packages ?? []).find(p => p.key === SELF_KEY);
  const lfTop = (lf?.packages ?? []).filter(p => p.key.startsWith("module:") && (p.key !== SELF_KEY) && (p.duration > 500))
    .slice(0, 5);
  if ( lfTop.length ) {
    add("medium", "Modules", "Modules that started long frames during play",
      lfTop.map(p => `${name(p.key)}: ${ms(p.duration)} in ${plural(p.count, "script")}`).join("; ")
      + (own ? `. Performance Triage's own ${ms(own.duration)} is left out: that is measurements run from this report, such as timing actor preparation.` : ""),
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
      // Most of it can be leftovers: Foundry keeps a texture for TextureLoader.CACHE_TTL (15 minutes) after its last
      // use and only drops expired ones when the next scene loads
      // Older reports only list this scene's 15 largest textures; their sum is close enough
      const own = cv.sceneTextureMemory ?? ((cv.textures ?? []).reduce((a, t) => a + (t.bytes ?? 0), 0) || null);
      const leftovers = Number.isFinite(own) && (own < cv.textureMemory / 2);
      add("high", "Scene", `Textures use about ${mb(cv.textureMemory)} of GPU memory`,
        "Integrated GPUs share system RAM; once textures exceed what fits, the browser starts evicting and re-uploading."
        + (leftovers ? ` This scene's own images are about ${mb(own)}; the rest are textures kept from scenes shown or `
          + "exported in the last 15 minutes, which Foundry drops when a later scene loads." : ""),
        leftovers
          ? "After switching through or exporting many scenes, reload to free it. For the scene itself, maps above "
            + "4096 px on the long side rarely look better at normal zoom."
          : "Downscale oversized maps and token art (4096 px on the long side is plenty for most maps) and convert to WebP.");
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
    lightCoverageFinding(cv, report, add, can);
    // Only while Foundry actually animates lights on this computer (the Low profile turns it off)
    if ( (cv.scene?.animatedLights > 25) && (report.client?.canvasPerformance?.lightAnimation !== false) ) {
      add("low", "Scene", `${cv.scene.animatedLights} animated lights`,
        "Light animations re-render every frame.", "Clients on the Low profile skip light animation automatically.");
    }
  }

  // This client
  const env = report.env ?? {};
  const cl = report.client ?? {};
  const achieved = cl.fps?.achieved ?? cl.liveFps;
  const target = cl.fps?.target ?? cl.canvasPerformance?.fps ?? cl.maxFPS;
  if ( achieved && (achieved < Math.min(target || 60, 60) * 0.5) && (report.profile?.id === "none") ) {
    const mode = ["Low", "Medium", "High", "Maximum"][cl.canvasPerformance?.mode ?? cl.performanceMode];
    add("high", "This client", `This client renders about ${Math.round(achieved)} fps (target ${target || 60})`,
      "The canvas redraws every frame even when nothing moves, so a low rate while idle means the scene itself is too "
      + `heavy for this computer${mode ? ` at ${mode} performance mode` : ""}.`,
      "Choose the Low profile under My performance profile, then measure layer costs (Canvas section) to see what "
      + "is left.", [can.lowProfile, can.layerCosts]);
  }

  // Layer costs measured on this client
  const fc = report.frameCost;
  if ( fc?.rows?.length ) {
    const costly = fc.rows.filter(r => !r.parent && (r.savedMs >= 5) && (r.id !== "primary")).slice(0, 4);
    if ( costly.length ) {
      // Half-resolution lighting is a change, not a part, so it isn't listed among what lighting is made of
      const partsOf = r => fc.rows.filter(p => (p.parent === r.id) && (p.savedMs >= 1) && (p.id !== "lightingHalf"));
      const line = r => {
        const parts = partsOf(r).map(p => `${PART_NAMES[p.id] ?? p.label} ${p.savedMs} ms`);
        return `${r.label}: ${r.savedMs} ms per frame${parts.length ? ` (${parts.join(", ")})` : ""}`;
      };
      add("high", "Scene", `What costs the most to draw on this computer (baseline ${Math.round(fc.baseline)} fps on ${fc.scene || "this scene"})`,
        costly.map(line).join("; ")
        + (fc.stable ? "." : ". The frame rate drifted during the test, so treat these as rough.")
        + (costly.some(r => partsOf(r).length) ? " Parts are measured one at a time and can overlap, so they needn't add up." : ""),
        layerAdvice(costly[0], partsOf(costly[0]), report));
    }
  }
  if ( (env.dpr > 1) && report.client?.resolutionScaling && ((env.memory ?? 8) <= 8) ) {
    add("low", "This client", `Canvas renders at ${env.dpr}x pixel density`,
      `Resolution scaling multiplies the pixels drawn by about ${(env.dpr * env.dpr).toFixed(1)}x on this screen.`,
      "The Low profile turns resolution scaling off.");
  }

  playFindings(report, add, can);

  // Module settings known to add work on every token move or frame, from each module's source
  const costly = costlySettings(report.knownSettings ?? []);
  if ( costly.length ) {
    const heavy = costly.some(c => ["chris-premades.movementPerformance", "ActiveAuras.wall-block"].includes(`${c.module}.${c.key}`));
    add(heavy ? "medium" : "low", "Play",
      `${plural(costly.length, "module setting")} ${(costly.length === 1) ? "adds" : "add"} work on token moves or every frame`,
      costly.map(c => c.detail).join(" "), costly.map(c => c.fix).join(" "));
  }

  // Several aura modules each check auras on every token move; one with no auras in the world is pure cost
  const auras = report.auras;
  if ( auras?.length >= 2 ) {
    add("info", "Play", `${auras.length} aura modules check auras when tokens move`,
      auras.map(a => `${AURA_MODULES[a.module] ?? a.module}: ${plural(a.sources, "aura")} on actors, tokens and `
        + "sidebar items" + (a.owners.length ? ` (${a.owners.join(", ")})` : "")).join("; ")
      + ". Each one does its own checks on every move. Compendiums aren't counted.",
      "With no auras on a scene, an aura module's work after a move is a pass over that scene's tokens, which is "
      + "cheap with a few tokens and grows with many; the real cost comes with auras in play, from the wall and "
      + "distance checks for each one. Using one module per aura (not the same aura in two) keeps that from doubling.");
  }

  // Players (GM view)
  for ( const p of report.players ?? [] ) {
    const suggestion = suggestProfile(p.summary);
    if ( suggestion && (p.profile === "none") ) {
      add("medium", "Players", `${p.name} may need the ${suggestion} profile`,
        describeSummary(p.summary), "Assign it in Performance Triage > Client Profiles.",
        [{ id: "openProfiles", label: "Client profiles" }]);
    }
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** The frame cap a scene's numbers are judged against; above 60 fps, drops don't matter for a tabletop. */
const fpsCap = s => Math.min(s.target || 60, 60);

/** Scenes where the median frame rate stayed well under the cap, with at least a minute measured. */
export function slowScenes(scenes) {
  return (scenes ?? []).filter(s => (s.minutes >= 1) && Number.isFinite(s.fps) && (s.fps < 0.6 * fpsCap(s)));
}

const sceneText = s => `${s.name}: about ${Math.round(s.fps)} fps (cap ${fpsCap(s)}), lowest tenth about `
  + `${Math.round(s.low)} fps, ${s.stuttersPerMin ?? s.longPerMin} stutters a minute over ${s.minutes} min`;

/** What to try when one package dominates the work after token moves, by package key. */
const MOVE_ADVICE = {
  "module:chris-premades": "Chris's Premades does its movement work on one GM's computer only (the last GM to "
    + "load, unless midi-qol names a preferred GM), so players don't pay for it. Its Movement Event Accuracy "
    + "(CPR settings, General) sets how much: Medium checks movement macros only at the end of a move, Low also "
    + "drops their wall test; auras are checked at the end of a move with walls at every level. Its option to "
    + "disable the lag warning only hides the warning. CPR's developer tools setting logs each move's timing.",
  "module:ActiveAuras": "ActiveAuras checks auras on the GM's computer on every position update (each waypoint), and "
    + "rechecks every aura on the scene when a wall changes, which includes opening and closing doors. In 0.12.4 to "
    + "0.12.7 its combat-only option doesn't stop the movement checks. If your auras come from another module, "
    + "disabling ActiveAuras removes this.",
  "module:auraeffects": "Aura Effects does its checks on the computer of whoever moved the token, often a player's, "
    + "and redraws aura radii on every computer while tokens move. With Foundry's vision animation off (the Low "
    + "profile does this) it only redraws auras that appear or disappear, and its Disable visuals setting (per "
    + "computer, in the Minimum profile) stops the drawing on that computer. Auras marked combat-only skip their "
    + "range checks outside combat.",
  "module:midi-qol": "midi-qol's own movement work is small. Its distance checks are the ones Chris's Premades uses, "
    + "and their cost follows midi's walls block range rule: the Levels and cover variants test more than the "
    + "default.",
  core: "Foundry's own work after a move is mostly recomputing vision and lighting, which grows with the walls and "
    + "lights near the token and the number of tokens with vision. Fewer vision-giving tokens on the GM's side "
    + "(hide or delete ones not in play) and fewer light sources help."
};

/** Frame rate during play: slow scenes, the cost of token moves, and how to start measuring. */
function playFindings(report, add, can) {
  const play = report.play;
  if ( !play ) return;
  const current = play.current?.scenes?.length ? play.current : null;
  const data = current ?? (play.previous?.scenes?.length ? play.previous : null);
  const when = current ? "this session" : "the previous session in this browser";
  if ( !data ) {
    if ( can.trackPlay ) {
      add("info", "Play", "Frame rate during play isn't measured yet",
        "Load times don't show which scenes drop frames once lights, weather, auras and automation are in play. With "
        + "this on, every computer counts its frame rate per scene and the work after each token move, and players "
        + "who share a summary send their previous session's numbers to you at their next load.",
        "Turn it on, play a session, then open this report (and Client profiles for players).", [can.trackPlay]);
    }
    return;
  }
  const slow = slowScenes(data.scenes);
  if ( slow.length ) {
    const worst = Math.min(...slow.map(s => s.fps / fpsCap(s)));
    add((worst < 0.4) ? "high" : "medium", "Play", `Frame rate dropped on ${plural(slow.length, "scene")} during ${when}`,
      slow.map(sceneText).join("; ") + ". The lowest tenth is the frame rate this computer fell to in its worst "
      + "tenth of five-second stretches.",
      "Open that scene and run Measure layer costs to see which part of the drawing costs the most here. A lower "
      + "render scale, or the Low profile, makes everything cheaper to draw on this computer without removing it.",
      [can.measureLayers]);
  }
  const mv = data.moves;
  if ( mv && (mv.count >= 3) && ((mv.medianMs >= 100) || (mv.worstMs >= 500)) ) {
    const total = mv.packages.reduce((a, p) => a + p.ms, 0) || 1;
    const by = mv.packages.slice(0, 4).map(p => `${name(p.key)} ${Math.round((100 * p.ms) / total)}%`).join(", ");
    const top = mv.packages[0]?.key;
    add((mv.medianMs >= 250) ? "high" : "medium", "Play", `Token moves stall this computer for about ${ms(mv.medianMs)} each`,
      `Over ${plural(mv.count, "move")} during ${when}, frames took a median of ${ms(mv.medianMs)} (worst `
      + `${ms(mv.worstMs)}) beyond this scene's normal frame time, from each move until two seconds after its `
      + `animation ended; ${mv.stuttered} moves caused a stutter. The canvas drew about ${mv.fps} fps while tokens `
      + `moved. Script time in those frames by package, leaving out drawing the canvas itself: ${by}. Frames under `
      + "50 ms aren't reported by the browser, so this is the stall players notice, not all the work.",
      (MOVE_ADVICE[top] ?? "Check that package's settings for work it does on "
        + "every move (auras, templates, region or movement triggers) that it can limit, for example to combat.")
      + " Run the CPU profile while moving tokens to see the functions involved.");
  }
}

/** Short names for the parts of a layer in the frame cost breakdown. */
const PART_NAMES = {
  illumination: "illumination", coloration: "light colours", background: "background changes", darkness: "darkness",
  lightMeshes: "the lights themselves",
  grid: "grid", drawings: "drawings", templates: "templates", regions: "regions", notes: "notes",
  tokenInterface: "token bars and names"
};

/** What the costliest part of lighting or the interface points at. */
const PART_ADVICE = {
  illumination: "Most of it is illumination: how brightly each light lights the map.",
  coloration: "Most of it is light colours: each light's tint, drawn as a separate pass over the area it reaches.",
  lightMeshes: "Most of it is the lights themselves: each light is drawn over the area it reaches, once per layer.",
  background: "Most of it is lights changing the map under them (some light animations and techniques do).",
  darkness: "Most of it is darkness sources.",
  grid: "Most of it is the grid. Its style and opacity are set per scene.",
  drawings: "Most of it is drawings; ones with text or a texture fill cost the most.",
  templates: "Most of it is measured templates, including the shapes Walled Templates computes.",
  regions: "Most of it is regions' visuals.",
  notes: "Most of it is map notes.",
  tokenInterface: "Most of it is token bars, names, borders and effect icons; modules that add to them (health "
    + "estimates, aura rings, status markers) add to this."
};

const LAYER_ADVICE = {
  tokenFilters: "Token Magic FX and similar filters redraw every frame. The Low profile stops animated ones; "
    + "removing permanent filters (for example automatic wound effects) helps every client.",
  tokens: "Many tokens with rings, effect icons, bars or filters add up. Hide or remove tokens not in play.",
  tiles: "Large tile images (floors, roofs) are drawn every frame. Downscale them, and keep floors that aren't in "
    + "use hidden.",
  effects: "Lighting and vision quality depends on Foundry's performance mode. Try the Low profile (which switches "
    + "to Low mode) and run this measurement again to see the difference.",
  visibility: "Fog of war and vision masking scale with the scene size and number of vision sources.",
  interface: "Token bars, nameplates, borders and drawings are redrawn every frame; modules that add HUD elements "
    + "to tokens add to this.",
  screenFilters: "Full-screen filters run over every pixel; anti-aliasing (SMAA, set by Foundry's performance mode) "
    + "and weather effects are the usual ones. Try the Low profile and run this measurement again."
};

/**
 * Advice for the costliest layer, using its measured parts and what is already set on this computer.
 * @param {object} row       The frame cost row
 * @param {object[]} parts   Its measured parts, costliest first
 * @param {object} report
 */
function layerAdvice(row, parts, report) {
  const layers = parts.filter(p => p.id !== "lightMeshes");
  const top = layers[0] ? (PART_ADVICE[layers[0].id] ?? "") : "";
  if ( row.id !== "effects" ) return [top, LAYER_ADVICE[row.id] ?? ""].filter(Boolean).join(" ");
  const cl = report.client ?? {};
  const lowMode = (cl.canvasPerformance?.mode ?? cl.performanceMode) === 0;
  const rows = report.frameCost?.rows ?? [];
  const meshes = rows.find(r => r.id === "lightMeshes");
  const half = rows.find(r => r.id === "lightingHalf");
  const lightingScale = cl.lightingScale ?? 1;
  return [
    top,
    lowMode
      ? "This computer is already at Low performance mode, which stops light animation but doesn't make a still "
        + "light any cheaper to draw: every light is drawn again on every frame either way."
      : "Try the Low profile (which switches to Low performance mode) and measure again.",
    meshes ? meshDetail(meshes, row) : lightCount(report.canvas?.scene?.lights),
    halfDetail(half, lightingScale, !!cl.lightingAuto),
    ((cl.renderScale ?? 1) < 1) ? "" : "Render scale (this module's settings, per computer) at 75% draws a little "
      + "over half the pixels, which is what this cost grows with; it needs a reload."
  ].filter(Boolean).join(" ");
}

/** Without the "lights hidden" measurement (taken before 0.11, or lighting was cheap), the scene's light count. */
function lightCount(lights) {
  return Number.isFinite(lights) ? `This scene has ${plural(lights, "light")}; each one is drawn every frame over the `
    + "area it reaches, so merging clusters of small lights (candles, sconces) or dropping decorative ones the players "
    + "won't miss helps every computer." : "";
}

/** How much of lighting's cost grows with lights, from the "lights hidden, layers kept" measurement. */
function meshDetail(meshes, effects) {
  if ( !(effects.savedMs > 0) ) return "";
  const share = meshes.savedMs / effects.savedMs;
  if ( share >= 0.5 ) {
    return `Hiding just the lights saved ${meshes.savedMs} of the ${effects.savedMs} ms, so it grows with the area `
      + "lights cover and how many overlap: shorter radii where lights overlap, walls clipping lights, and one light "
      + "in place of a cluster all help every computer (the scene's light table lists the largest).";
  }
  return `Hiding just the lights saved only ${meshes.savedMs} of the ${effects.savedMs} ms; the rest is each lighting `
    + "layer's fixed work over the whole screen, which fewer lights won't reduce but fewer pixels will.";
}

/** What drawing lighting at half resolution did in the measurement. */
function halfDetail(half, lightingScale, auto) {
  const setting = auto
    ? "Lighting resolution is on Automatic here, so it steps down by itself when this computer falls behind."
    : "Set Lighting resolution (this module's settings, per computer) to Automatic to have it step down only when "
      + "this computer falls behind, or to 50% to keep it there.";
  if ( half ) {
    return (half.savedMs >= 1)
      ? `Drawing lighting at half resolution saved ${half.savedMs} ms per frame in the test. ${setting}`
      : "Drawing lighting at half resolution saved nothing measurable in the test, so Lighting resolution won't help "
        + "on this computer.";
  }
  return (auto || (lightingScale < 1)) ? ""
    : "Lighting resolution (this module's settings, per computer) draws lights at fewer pixels than the map; measuring "
      + "layer costs again shows what it would save.";
}

/**
 * Lights covering a scene several times over: each is drawn over the area it reaches, on each lighting layer, every
 * frame, on every computer that views the scene.
 */
function lightCoverageFinding(cv, report, add, can) {
  const lc = cv.lightCoverage;
  if ( !lc?.count || ((lc.cover < 1) && (lc.overlap < 2)) ) return;
  const effects = (report.frameCost?.rows ?? []).find(r => r.id === "effects");
  const costly = effects && (effects.savedMs >= 10);
  const big = lc.largest[0];
  add(costly ? "medium" : "low", "Scene",
    `Lights on ${cv.scene?.name || "this scene"} cover ${lc.cover} times its area`,
    `Foundry draws each light over the area it reaches, once per lighting layer, on every frame, so what costs is `
    + `area and overlap rather than the number of lights. These ${plural(lc.count, "light")} reach `
    + `${Math.round(lc.lit * 100)}% of the scene, ${lc.overlap} deep on average where they do.`
    + (big ? ` The largest covers ${Math.round(big.cover * 100)}% of the scene by itself` : "")
    + (big?.overlap >= 1 ? `, under ${big.overlap} other lights on average.` : (big ? "." : ""))
    + (lc.unwalled ? ` ${plural(lc.unwalled, "light")} ignore walls, so ${lc.unwalled === 1 ? "it is" : "they are"} drawn `
      + "through every room in reach." : ""),
    "You don't need fewer lights so much as less overlap: let each sconce reach about as far as the next one, let "
    + "walls clip lights unless they should shine through, and use one light for a cluster of candles. Large "
    + "ambient or scenery lights are usually the cheapest place to start.", [can.selectLights]);
}

/** One line about a client's previous session, from the play summary it shared, or "" without one. */
export function describePlay(play) {
  if ( !play?.scenes?.length ) return "";
  const scenes = play.scenes.filter(x => (x.minutes >= 1) && Number.isFinite(x.fps));
  const slowest = scenes.sort((a, b) => (a.fps / fpsCap(a)) - (b.fps / fpsCap(b)))[0];
  const parts = [];
  if ( slowest ) parts.push(`slowest scene ${slowest.name}, about ${Math.round(slowest.fps)} of ${fpsCap(slowest)} fps`);
  if ( play.moves?.count >= 3 ) parts.push(`token moves stall about ${ms(play.moves.medianMs)}`);
  return parts.length ? `Previous session: ${parts.join("; ")}.` : "";
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
