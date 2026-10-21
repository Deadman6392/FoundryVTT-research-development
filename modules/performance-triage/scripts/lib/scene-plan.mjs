/**
 * Rank scenes for archiving to a compendium: how much of the world data each one costs every client at load, and
 * what needs attention while it is out of the world. Scenes are grouped by folder because Foundry exports a whole
 * folder in one step, so an area is the practical unit of work.
 * Works on plain source data so it can be tested in Node; nothing here changes the world.
 */
import { esc, fmtBytes, fmtMs } from "./report-format.mjs";

/** Below this, archiving a scene on its own saves too little to be worth the prep. */
export const SMALL_SCENE_BYTES = 256 * 1024;

/** Scene parts that can point at other scenes (teleport regions, tile triggers, map notes, scene flags). */
const LINK_PARTS = new Set(["regions", "tiles", "notes", "drawings", "flags"]);

/**
 * A scene id written as a UUID ("Scene.<id>", also inside "Scene.<id>.Region.<id>") or as a bare quoted id, which
 * is how some modules and macros refer to a scene (the text is JSON, so quotes inside strings appear as \").
 * Foundry ids are 16 random alphanumerics, so a bare match is only counted when it is the id of a world scene.
 */
const SCENE_REF = /(?:Scene\.|["'])([A-Za-z0-9]{16})(?=["'.\]\\]|$)/g;

function json(value) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** Scene ids mentioned in a string, limited to ids in `ids` and excluding `self`. */
function sceneRefs(text, ids, self) {
  const found = new Set();
  for ( const m of text.matchAll(SCENE_REF) ) {
    if ( (m[1] !== self) && ids.has(m[1]) ) found.add(m[1]);
  }
  return found;
}

/**
 * Size one scene's source data part by part, without stringifying anything twice.
 * @returns {{bytes: number, copies: number, linkText: string}}
 */
function measureScene(scene) {
  let bytes = 0;
  let copies = 0;
  const linkText = [];
  for ( const [key, value] of Object.entries(scene ?? {}) ) {
    if ( (key !== "tokens") || !Array.isArray(value) ) {
      const text = json(value);
      bytes += text.length + key.length + 3;
      if ( LINK_PARTS.has(key) ) linkText.push(text);
      continue;
    }
    for ( const token of value ) {
      for ( const [tk, tv] of Object.entries(token ?? {}) ) {
        if ( (tk !== "delta") || !tv || (typeof tv !== "object") ) {
          bytes += json(tv).length + tk.length + 3;
          continue;
        }
        for ( const [dk, dv] of Object.entries(tv) ) {
          const s = json(dv).length + dk.length + 3;
          bytes += s;
          if ( dk === "items" ) copies += s;
        }
      }
    }
  }
  return { bytes, copies, linkText: linkText.join("\n") };
}

/** Two scenes are in the same area when they share a folder; scenes outside any folder are each their own area. */
const sameArea = (a, b) => !!a && (a === b);

/**
 * Plan which scenes to archive.
 * @param {object} input
 * @param {object[]} input.scenes                 Scene source data
 * @param {object[]} [input.journals]             Journal entry source data (with pages), for names and links
 * @param {object[]} [input.macros]               Macro source data, for links
 * @param {Set<string>} [input.inUse]             Scene ids someone is on right now
 * @param {Set<string>} [input.playerActors]      Actor ids that a player owns
 * @param {Map<string, string>} [input.folders]   Scene folder id -> display path ("Vallaki / Interiors")
 * @param {Map<string, number>} [input.prepMs]    Scene id -> time to prepare its unlinked tokens' actors, if measured
 * @param {{id: string, title: string, scenes: {id: string, name: string}[]}[]} [input.archived]
 *   Scene compendiums in this world and the scenes in them, from their indexes
 */
export function planScenes({ scenes, journals = [], macros = [], inUse = new Set(), playerActors = new Set(),
  folders = new Map(), prepMs = null, archived = [] }) {
  const ids = new Set(scenes.map(s => s?._id).filter(Boolean));
  // A scene that is in the world as well as a compendium (kept after a restore) is not archived
  const archivedById = new Map();
  for ( const pack of archived ) {
    for ( const sc of pack.scenes ?? [] ) {
      if ( sc?.id && !ids.has(sc.id) ) archivedById.set(sc.id, { name: sc.name || "(unnamed)", pack: pack.title });
    }
  }
  const archivedIds = new Set(archivedById.keys());
  const byId = new Map(scenes.map(s => [s?._id, s]));
  const journalNames = new Map(journals.map(j => [j?._id, j?.name ?? ""]));
  const folderOf = id => byId.get(id)?.folder || "";

  // Links from journals and macros only fail while the scene is out; with the same ID they work again afterwards
  const docLinks = new Map(); // scene id -> [{type, name}]
  const addDocLink = (target, type, name) => {
    if ( !docLinks.has(target) ) docLinks.set(target, []);
    docLinks.get(target).push({ type, name: name || "(unnamed)" });
  };
  const archiveJournalLinks = new Map(); // compendium title -> journal entries linking into it
  for ( const j of journals ) {
    const text = json(j);
    for ( const id of sceneRefs(text, ids, null) ) addDocLink(id, "journal", j?.name);
    for ( const id of sceneRefs(text, archivedIds, null) ) {
      const pack = archivedById.get(id).pack;
      if ( !archiveJournalLinks.has(pack) ) archiveJournalLinks.set(pack, new Set());
      archiveJournalLinks.get(pack).add(j?.name || "(unnamed)");
    }
  }
  for ( const m of macros ) for ( const id of sceneRefs(json(m), ids, null) ) addDocLink(id, "macro", m?.name);

  // A teleport region or tile trigger in another scene is a way in that players can use during play
  const measured = new Map();
  const sceneLinks = new Map(); // target scene id -> [source scene id]
  const exits = new Map(); // world scene id -> archived scenes it leads to
  for ( const scene of scenes ) {
    const m = measureScene(scene);
    measured.set(scene?._id, m);
    for ( const target of sceneRefs(m.linkText, ids, scene?._id) ) {
      if ( !sceneLinks.has(target) ) sceneLinks.set(target, []);
      sceneLinks.get(target).push(scene._id);
    }
    const out = [...sceneRefs(m.linkText, archivedIds, null)].map(id => archivedById.get(id));
    if ( out.length ) exits.set(scene?._id, out);
  }

  const rows = scenes.map(scene => {
    const m = measured.get(scene?._id);
    const tokens = Array.isArray(scene?.tokens) ? scene.tokens : [];
    const notes = Array.isArray(scene?.notes) ? scene.notes : [];
    const pinned = new Map();
    if ( scene?.journal ) pinned.set(scene.journal, journalNames.get(scene.journal) ?? "");
    for ( const n of notes ) if ( n?.entryId ) pinned.set(n.entryId, journalNames.get(n.entryId) ?? "");
    const folderId = scene?.folder || "";
    const links = (sceneLinks.get(scene?._id) ?? []).map(src => ({
      id: src, name: byId.get(src)?.name || "(unnamed)", folder: folders.get(folderOf(src)) ?? ""
    }));
    const row = {
      id: scene?._id ?? "",
      name: scene?.name || "(unnamed)",
      folderId,
      folder: folders.get(folderId) ?? "",
      bytes: m.bytes,
      copies: m.copies,
      prepMs: prepMs?.get(scene?._id) ?? null,
      tokens: tokens.length,
      unlinked: tokens.filter(t => t?.actorLink !== true).length,
      playerTokens: tokens.filter(t => (t?.actorLink === true) && playerActors.has(t.actorId)).length,
      walls: scene?.walls?.length ?? 0,
      lights: scene?.lights?.length ?? 0,
      notes: notes.length,
      pinned: [...pinned.entries()].map(([id, name]) => ({ id, name: name || "(missing journal entry)" })),
      entrances: links.filter(l => !sameArea(folderOf(l.id), folderId)),
      docLinks: docLinks.get(scene?._id) ?? [],
      exitsToArchive: exits.get(scene?._id) ?? [],
      navigation: scene?.navigation === true,
      inUse: inUse.has(scene?._id)
    };
    row.status = row.inUse ? "inUse"
      : (row.bytes < SMALL_SCENE_BYTES) ? "small"
        : (row.pinned.length || row.entrances.length) ? "prep" : "ready";
    return row;
  });

  const ORDER = { ready: 0, prep: 1, small: 2, inUse: 3 };
  rows.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (b.bytes - a.bytes));

  const groups = {};
  for ( const status of Object.keys(ORDER) ) {
    const list = rows.filter(r => r.status === status);
    groups[status] = { count: list.length, bytes: list.reduce((a, r) => a + r.bytes, 0) };
  }

  // Exporting a folder takes every scene in it, so an area's saving is everything in it except scenes in use
  const areas = new Map();
  for ( const r of rows ) {
    const key = r.folderId || `scene:${r.id}`;
    let a = areas.get(key);
    if ( !a ) {
      areas.set(key, a = { id: r.folderId, folder: r.folder, scenes: [], bytes: 0, saves: 0,
        ready: 0, prep: 0, small: 0, inUse: 0, pinned: new Map(), entrances: [] });
    }
    a.scenes.push(r);
    a.bytes += r.bytes;
    a[r.status]++;
    // A scene in use stays in the world, so its notes and ways in don't need prep
    if ( r.status === "inUse" ) continue;
    a.saves += r.bytes;
    for ( const p of r.pinned ) a.pinned.set(p.id, p.name);
    for ( const e of r.entrances ) a.entrances.push({ from: e.name, fromFolder: e.folder, to: r.name });
  }
  const areaList = [...areas.values()].map(a => ({ ...a, pinned: [...a.pinned.values()].sort() }));
  // Scenes outside any folder are listed together at the end: each has to be moved into a folder to export it
  const loose = areaList.filter(a => !a.id);
  const folderAreas = areaList.filter(a => a.id).sort((a, b) => b.saves - a.saves);
  if ( loose.length ) {
    const merged = { id: "", folder: "", scenes: [], bytes: 0, saves: 0, ready: 0, prep: 0, small: 0, inUse: 0,
      pinned: [], entrances: [] };
    for ( const a of loose ) {
      merged.scenes.push(...a.scenes);
      for ( const k of ["bytes", "saves", "ready", "prep", "small", "inUse"] ) merged[k] += a[k];
      merged.pinned.push(...a.pinned);
      merged.entrances.push(...a.entrances);
    }
    merged.pinned = [...new Set(merged.pinned)].sort();
    folderAreas.push(merged);
  }

  // What is already in compendiums, and how players could walk into it from the world
  const archive = archived.map(pack => {
    const names = (pack.scenes ?? []).filter(sc => archivedById.has(sc.id)).map(sc => sc.name || "(unnamed)");
    const waysIn = [];
    for ( const r of rows ) {
      for ( const e of r.exitsToArchive ) {
        if ( e.pack === pack.title ) waysIn.push({ from: r.name, fromFolder: r.folder, to: e.name });
      }
    }
    return { id: pack.id, title: pack.title, names, waysIn, journals: [...(archiveJournalLinks.get(pack.title) ?? [])].sort() };
  }).filter(a => a.names.length).sort((a, b) => (b.waysIn.length - a.waysIn.length) || a.title.localeCompare(b.title));

  return {
    totalBytes: rows.reduce((a, r) => a + r.bytes, 0),
    hasPrepTimes: !!prepMs,
    archive,
    rows,
    areas: folderAreas,
    groups
  };
}

/* -------------------------------------------- */
/*  Output                                      */
/* -------------------------------------------- */

const STATUS_LABEL = {
  ready: "Archive, no prep",
  prep: "Archive after prep",
  small: "Small",
  inUse: "In use now"
};

/** The same, as a short note after a scene's size in the checklist. */
const STATUS_SHORT = { ready: "no prep", prep: "after prep", small: "small", inUse: "in use, keep" };

const MAX_NAMES = 8;

function list(names) {
  const shown = names.slice(0, MAX_NAMES);
  const more = names.length - shown.length;
  return shown.join(", ") + (more > 0 ? `, and ${more} more` : "");
}

const entranceText = e => `${e.from}${e.fromFolder ? ` (${e.fromFolder})` : ""} → ${e.to}`;

/** What to know about one scene before archiving it, in a sentence. */
export function sceneNote(row) {
  const parts = [];
  if ( row.pinned.length ) parts.push(`journal entries on this map: ${list(row.pinned.map(p => p.name))}`);
  if ( row.entrances.length ) {
    parts.push(`ways in from other areas: ${list(row.entrances.map(e => `${e.name}${e.folder ? ` (${e.folder})` : ""}`))}`);
  }
  if ( row.docLinks.length ) parts.push(`linked from ${list(row.docLinks.map(l => `${l.name} (${l.type})`))}`);
  if ( row.exitsToArchive?.length ) {
    parts.push(`leads into archived scenes: ${list(row.exitsToArchive.map(e => `${e.name} (${e.pack})`))}`);
  }
  if ( row.playerTokens ) parts.push(`${row.playerTokens} player character token${row.playerTokens === 1 ? "" : "s"}`);
  if ( row.navigation ) parts.push("in the navigation bar");
  return parts.join("; ");
}

/** One sentence of context, shown above everything else. */
export const PLAN_SUMMARY = "Every scene in the world, with all its tokens, walls and lights, is sent to every player "
  + "at every load, including scenes nobody is on. A scene in a compendium costs nothing at load beyond its line in "
  + "the compendium index. Nothing in this window changes your world.";

/** The archive and restore steps, verified against Foundry v13's export and import options. */
export const PLAN_STEPS = [
  "In the Compendium Packs tab, create a compendium of type Scene for the area, for example \"Archive: Vallaki\". "
    + "One compendium per area lets you bring an area back in one step.",
  "In the Scenes tab, right-click the area's folder, choose Export to Compendium, pick that compendium and tick the "
    + "option to keep IDs.",
  "Delete the exported scenes from the world, except any listed as in use.",
  "To bring the area back, open its compendium, use Import All and tick the option to keep IDs. With the same IDs, "
    + "journal links, teleport regions and tile triggers that point at those scenes work again, and their map notes "
    + "open the same journal entries, which never left the world. Dragging one scene out of a compendium can give "
    + "it a new ID, which breaks those links.",
  "Try the round trip with one small area first, and check that explored fog on its maps survives it."
];

/** What "after prep" means, for the window and the checklist. */
export const PREP_NOTE = "\"After prep\" means the area has journal entries on its maps, which you may want to reach "
  + "from the Journal tab while the maps are archived, or ways in from scenes that stay in the world, such as a "
  + "teleport region; if players head through one, bring the area back first. Links from journal entries and macros "
  + "are listed too: they don't work while a scene is archived, and work again once it is back with the same ID.";

function areaTitle(a) {
  return a.id ? a.folder : "Scenes outside any folder";
}

function areaSummary(a) {
  const counts = [["ready", "no prep"], ["prep", "after prep"], ["small", "small"], ["inUse", "in use"]]
    .filter(([k]) => a[k]).map(([k, label]) => `${a[k]} ${label}`).join(", ");
  return `${a.scenes.length} scene${a.scenes.length === 1 ? "" : "s"} (${counts}), archiving saves ${fmtBytes(a.saves)}`;
}

/** Sentences about an area as a whole; the same facts the checklist lists. */
function areaNotes(a) {
  const notes = [];
  if ( !a.id ) notes.push("These scenes are not in a folder. Put the ones you want to archive in one, so they can be exported together with their IDs.");
  const inUse = a.scenes.filter(r => r.status === "inUse").map(r => r.name);
  if ( inUse.length ) notes.push(`In use now, keep in the world: ${list(inUse)}.`);
  if ( a.pinned.length ) notes.push(`Journal entries on these maps: ${list(a.pinned)}.`);
  if ( a.entrances.length ) notes.push(`Ways in from scenes that stay: ${list(a.entrances.map(entranceText))}.`);
  return notes;
}

/** The archived areas section: what is in compendiums and which exits in the world lead there. */
function archiveHtml(plan, isOpen) {
  if ( !plan.archive.length ) return "";
  const blocks = plan.archive.map(a => {
    const notes = [
      `${a.names.length} scene${a.names.length === 1 ? "" : "s"}: ${list(a.names)}.`,
      a.waysIn.length
        ? `Ways in from scenes in the world (bring the area back before players use them): ${list(a.waysIn.map(entranceText))}.`
        : "No teleport regions or tile triggers in the world lead here.",
      ...(a.journals.length ? [`Journal entries linking here (they work again once it is back): ${list(a.journals)}.`] : [])
    ];
    return `<div class="ptriage-area"><p><strong>${esc(a.title)}</strong></p>${notes.map(n => `<p>${esc(n)}</p>`).join("")}</div>`;
  }).join("");
  const ways = plan.archive.reduce((n, a) => n + a.waysIn.length, 0);
  return `<details class="ptriage-section" data-section="archive"${isOpen("archive")}>
    <summary>In compendiums: ${plan.archive.length} pack${plan.archive.length === 1 ? "" : "s"}, ${ways} way${ways === 1 ? "" : "s"} in from the world</summary>
    <p>${esc("Scene compendiums in this world, and the teleport regions or tile triggers in world scenes that lead into them. If players head through one, import that area first, keeping IDs.")}</p>
    ${blocks}</details>`;
}

function sceneTable(rows, hasPrepTimes) {
  const head = ["Scene", "Suggestion", "Size", "Token item copies", ...(hasPrepTimes ? ["Token actor prep"] : []),
    "Tokens", "Walls", "Lights", "Notes"];
  const body = rows.map(r => `<tr class="ptriage-plan-${esc(r.status)}">
    <td><strong>${esc(r.name)}</strong></td>
    <td>${esc(STATUS_LABEL[r.status])}</td>
    <td>${fmtBytes(r.bytes)}</td><td>${fmtBytes(r.copies)}</td>
    ${hasPrepTimes ? `<td>${Number.isFinite(r.prepMs) ? fmtMs(r.prepMs) : "–"}</td>` : ""}
    <td>${r.tokens}</td><td>${r.walls}</td><td>${r.lights}</td>
    <td class="ptriage-wrap">${esc(sceneNote(r)) || "–"}</td></tr>`).join("");
  return `<table class="ptriage-table"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody></table>`;
}

/**
 * @param {ReturnType<typeof planScenes>} plan
 * @param {object} [opts]
 * @param {Set<string>} [opts.open]       Keys of the collapsible sections to show expanded
 * @param {number} [opts.measuredMs]      How long collecting the plan took
 * @returns {string} HTML for the planner window
 */
export function scenePlanToHtml(plan, { open = new Set(["areas"]), measuredMs = null } = {}) {
  const g = plan.groups;
  const cards = [
    ["All scenes", `${plan.rows.length} (${fmtBytes(plan.totalBytes)})`],
    [STATUS_LABEL.ready, `${g.ready.count} (${fmtBytes(g.ready.bytes)})`],
    [STATUS_LABEL.prep, `${g.prep.count} (${fmtBytes(g.prep.bytes)})`],
    [STATUS_LABEL.small, `${g.small.count} (${fmtBytes(g.small.bytes)})`],
    [STATUS_LABEL.inUse, `${g.inUse.count} (${fmtBytes(g.inUse.bytes)})`]
  ].map(([k, v]) => `<div class="ptriage-card"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");
  const isOpen = key => (open.has(key) ? " open" : "");

  const areas = plan.areas.map((a, i) => {
    const key = `area:${a.id || "loose"}`;
    const notes = areaNotes(a).map(n => `<p>${esc(n)}</p>`).join("");
    return `<details class="ptriage-area" data-section="${esc(key)}"${isOpen(key)}>
      <summary><strong>${i + 1}. ${esc(areaTitle(a))}</strong> <span class="ptriage-summary">${esc(areaSummary(a))}</span></summary>
      ${notes}${sceneTable(a.scenes, plan.hasPrepTimes)}</details>`;
  }).join("");

  const unlinked = plan.rows.reduce((a, r) => a + r.unlinked, 0);
  const timing = plan.hasPrepTimes ? "" : `<p>${esc("\"Time token actors\" adds a column with how long each "
    + "scene's unlinked tokens take to prepare. Each player pays that when the scene is first drawn, and the GM pays "
    + "it for every scene at every load while a module such as Sequencer checks every token. It re-prepares all "
    + `${unlinked} of them; about 1,000 took 10 seconds on a fast desktop.`)}</p>`;

  return `<div class="ptriage-header">
      <p>${esc(PLAN_SUMMARY)}</p>
      <div class="ptriage-cards">${cards}</div>
      <div class="ptriage-actions">
        <button type="button" data-action="refresh"><i class="fa-solid fa-rotate"></i> Refresh</button>
        <button type="button" data-action="copyMarkdown"><i class="fa-solid fa-copy"></i> Copy prep checklist</button>
        ${plan.hasPrepTimes ? "" : `<button type="button" data-action="timeActors"><i class="fa-solid fa-stopwatch"></i> Time token actors</button>`}
      </div>
      ${Number.isFinite(measuredMs) ? `<p class="ptriage-summary">Measured in ${esc(fmtMs(measuredMs))}.</p>` : ""}
    </div>
    <details class="ptriage-section" data-section="steps"${isOpen("steps")}><summary>How to archive an area and bring it back</summary>
      <ol>${PLAN_STEPS.map(s => `<li>${esc(s)}</li>`).join("")}</ol><p>${esc(PREP_NOTE)}</p></details>
    <details class="ptriage-section" data-section="areas"${isOpen("areas")}><summary>Areas (scene folders), most to gain first</summary>
      ${timing}${areas}</details>
    ${archiveHtml(plan, isOpen)}
    <details class="ptriage-section" data-section="all"${isOpen("all")}><summary>All scenes, best candidates first</summary>
      ${sceneTable(plan.rows, plan.hasPrepTimes)}</details>`;
}

/**
 * A per-area checklist to paste into session notes.
 * @param {ReturnType<typeof planScenes>} plan
 */
export function scenePlanToMarkdown(plan) {
  const lines = ["# Scene archive plan", "", PLAN_SUMMARY, "", "## How to archive an area and bring it back", ""];
  PLAN_STEPS.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("", PREP_NOTE, "");
  const ways = plan.archive.filter(a => a.waysIn.length);
  if ( ways.length ) {
    lines.push("## Ways into archived areas", "", "Bring the area back before players use one of these.", "");
    for ( const a of ways ) for ( const w of a.waysIn ) lines.push(`- ${entranceText(w)} (${a.title})`);
    lines.push("");
  }
  for ( const a of plan.areas ) {
    if ( a.saves < SMALL_SCENE_BYTES ) continue;
    lines.push(`## ${areaTitle(a)}`, "", areaSummary(a), "");
    for ( const n of areaNotes(a) ) lines.push(`- ${n}`);
    lines.push("- [ ] Archived");
    for ( const r of a.scenes ) {
      const note = sceneNote(r);
      lines.push(`  - ${r.name}, ${fmtBytes(r.bytes)}, ${STATUS_SHORT[r.status]}${note ? ` (${note})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
