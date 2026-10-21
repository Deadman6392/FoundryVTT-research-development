/**
 * Rank scenes for archiving to a compendium: how much of the world data each one costs every client at load, and
 * what needs attention while it is out of the world (map notes that open journal entries, links from elsewhere).
 * Works on plain source data so it can be tested in Node; nothing here changes the world.
 */
import { esc, fmtBytes } from "./report-format.mjs";

/** Below this, archiving a scene saves too little to be worth the prep. */
export const SMALL_SCENE_BYTES = 256 * 1024;

/** Scene parts that can point at other scenes (teleport regions, tile triggers, map notes, scene flags). */
const LINK_PARTS = new Set(["regions", "tiles", "notes", "drawings", "flags"]);

/**
 * A scene id written as a UUID ("Scene.<id>", also inside "Scene.<id>.Region.<id>") or as a bare quoted id, which
 * is how some modules and macros refer to a scene (the text is JSON, so quotes inside strings appear as \").
 * Foundry ids are 16 random alphanumerics, so a bare match is only counted when it is the id of a world scene.
 */
const SCENE_REF = /(?:Scene\.|["'])([A-Za-z0-9]{16})(?=["'.\]\\]|$)/g;

function size(value) {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

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
          bytes += size(tv) + tk.length + 3;
          continue;
        }
        for ( const [dk, dv] of Object.entries(tv) ) {
          const s = size(dv) + dk.length + 3;
          bytes += s;
          if ( dk === "items" ) copies += s;
        }
      }
    }
  }
  return { bytes, copies, linkText: linkText.join("\n") };
}

/**
 * Plan which scenes to archive.
 * @param {object} input
 * @param {object[]} input.scenes                 Scene source data
 * @param {object[]} [input.journals]             Journal entry source data (with pages), for names and links
 * @param {object[]} [input.macros]               Macro source data, for links
 * @param {Set<string>} [input.inUse]             Scene ids someone is on right now
 * @param {Set<string>} [input.playerActors]      Actor ids that a player owns
 * @param {Map<string, string>} [input.folders]   Scene folder id -> name
 * @returns {{totalBytes: number, rows: object[], folders: object[], groups: object}}
 */
export function planScenes({ scenes, journals = [], macros = [], inUse = new Set(), playerActors = new Set(), folders = new Map() }) {
  const ids = new Set(scenes.map(s => s?._id).filter(Boolean));
  const journalNames = new Map(journals.map(j => [j?._id, j?.name ?? ""]));
  const linkedFrom = new Map(); // scene id -> [{type, name}]
  const link = (target, type, name) => {
    let list = linkedFrom.get(target);
    if ( !list ) linkedFrom.set(target, list = []);
    list.push({ type, name });
  };
  for ( const j of journals ) for ( const id of sceneRefs(json(j), ids, null) ) link(id, "journal", j?.name ?? "");
  for ( const m of macros ) for ( const id of sceneRefs(json(m), ids, null) ) link(id, "macro", m?.name ?? "");

  const measured = scenes.map(scene => {
    const m = measureScene(scene);
    for ( const id of sceneRefs(m.linkText, ids, scene?._id) ) link(id, "scene", scene?.name ?? "");
    return [scene, m];
  });

  const rows = measured.map(([scene, m]) => {
    const tokens = Array.isArray(scene?.tokens) ? scene.tokens : [];
    const notes = Array.isArray(scene?.notes) ? scene.notes : [];
    const pinned = new Map();
    if ( scene?.journal ) pinned.set(scene.journal, journalNames.get(scene.journal) ?? "");
    for ( const n of notes ) if ( n?.entryId ) pinned.set(n.entryId, journalNames.get(n.entryId) ?? "");
    const row = {
      id: scene?._id ?? "",
      name: scene?.name ?? "",
      folder: folders.get(scene?.folder) ?? "",
      bytes: m.bytes,
      copies: m.copies,
      tokens: tokens.length,
      unlinked: tokens.filter(t => t?.actorLink !== true).length,
      playerTokens: tokens.filter(t => (t?.actorLink === true) && playerActors.has(t.actorId)).length,
      walls: scene?.walls?.length ?? 0,
      lights: scene?.lights?.length ?? 0,
      tiles: scene?.tiles?.length ?? 0,
      notes: notes.length,
      pinned: [...pinned.entries()].map(([id, name]) => ({ id, name: name || "(missing journal entry)" })),
      linkedFrom: linkedFrom.get(scene?._id) ?? [],
      navigation: scene?.navigation === true,
      inUse: inUse.has(scene?._id)
    };
    row.status = row.inUse ? "inUse"
      : (row.bytes < SMALL_SCENE_BYTES) ? "small"
        : (row.pinned.length || row.linkedFrom.length) ? "prep" : "ready";
    return row;
  });

  const ORDER = { ready: 0, prep: 1, small: 2, inUse: 3 };
  rows.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (b.bytes - a.bytes));

  const groups = {};
  for ( const status of Object.keys(ORDER) ) {
    const list = rows.filter(r => r.status === status);
    groups[status] = { count: list.length, bytes: list.reduce((a, r) => a + r.bytes, 0) };
  }

  // Foundry exports a whole scene folder in one step, so folder totals are the practical unit of work
  const byFolder = new Map();
  for ( const r of rows ) {
    let f = byFolder.get(r.folder);
    if ( !f ) byFolder.set(r.folder, f = { folder: r.folder, scenes: 0, bytes: 0, ready: 0, prep: 0, inUse: 0 });
    f.scenes++;
    f.bytes += r.bytes;
    if ( r.status === "ready" ) f.ready++;
    else if ( r.status === "prep" ) f.prep++;
    else if ( r.status === "inUse" ) f.inUse++;
  }

  return {
    totalBytes: rows.reduce((a, r) => a + r.bytes, 0),
    rows,
    folders: [...byFolder.values()].sort((a, b) => b.bytes - a.bytes),
    groups
  };
}

/* -------------------------------------------- */
/*  Output                                      */
/* -------------------------------------------- */

const STATUS_LABEL = {
  ready: "Archive: no prep",
  prep: "Archive after prep",
  small: "Small, leave it",
  inUse: "In use now"
};

const MAX_NAMES = 6;

function names(list) {
  const shown = list.slice(0, MAX_NAMES).map(x => x.name || "(unnamed)");
  const more = list.length - shown.length;
  return shown.join(", ") + (more > 0 ? `, and ${more} more` : "");
}

function linkNames(list) {
  return names(list.map(l => ({ name: `${l.name} (${l.type})` })));
}

/** What to have ready before archiving a scene, in a sentence. */
export function prepNote(row) {
  const parts = [];
  const n = row.pinned.length;
  if ( n ) parts.push(`map notes open ${n} journal ${n === 1 ? "entry" : "entries"}: ${names(row.pinned)}`);
  if ( row.linkedFrom.length ) parts.push(`linked from ${linkNames(row.linkedFrom)}`);
  return parts.join("; ");
}

/** Explanatory text shared by the window and the Markdown checklist. */
export const PLAN_INTRO = [
  "Every scene in the world, with all its tokens, walls and lights, is sent to every player at every load, "
    + "including scenes nobody is on. A scene in a compendium costs nothing at load beyond its line in the "
    + "compendium index.",
  "To archive: right-click a scene folder, choose Export to Compendium, tick the option to keep IDs, then delete "
    + "those scenes from the world. One compendium per area works well: to bring an area back, use that "
    + "compendium's Import All with its keep-ID option ticked. With the same IDs, journal links, teleport regions "
    + "and tile triggers that point at those scenes work again, and their map notes still open the same journal "
    + "entries, which stay in the world the whole time. Dragging a single scene out of a compendium can give it a "
    + "new ID, which breaks those links.",
  "\"Archive after prep\" scenes have map notes or are linked from elsewhere: while they are archived, those notes "
    + "and links have nothing to open, so keep the listed journal entries handy. Try the round trip on one scene "
    + "first, and check that explored fog on that map survives it before relying on it."
];

/**
 * @param {ReturnType<typeof planScenes>} plan
 * @returns {string} HTML for the planner window
 */
export function scenePlanToHtml(plan) {
  const g = plan.groups;
  const cards = [
    ["Scenes", `${plan.rows.length} (${fmtBytes(plan.totalBytes)})`],
    [STATUS_LABEL.ready, `${g.ready.count} (${fmtBytes(g.ready.bytes)})`],
    [STATUS_LABEL.prep, `${g.prep.count} (${fmtBytes(g.prep.bytes)})`],
    [STATUS_LABEL.small, `${g.small.count} (${fmtBytes(g.small.bytes)})`],
    [STATUS_LABEL.inUse, `${g.inUse.count} (${fmtBytes(g.inUse.bytes)})`]
  ].map(([k, v]) => `<div class="ptriage-card"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");

  const folderRows = plan.folders.map(f => `<tr><td>${esc(f.folder || "(no folder)")}</td><td>${f.scenes}</td>
    <td>${fmtBytes(f.bytes)}</td><td>${f.ready}</td><td>${f.prep}</td><td>${f.inUse}</td></tr>`).join("");

  const sceneRows = plan.rows.map(r => `<tr class="ptriage-plan-${esc(r.status)}">
    <td><strong>${esc(r.name)}</strong><div class="ptriage-summary">${esc(r.folder)}</div></td>
    <td>${esc(STATUS_LABEL[r.status])}</td>
    <td>${fmtBytes(r.bytes)}</td><td>${fmtBytes(r.copies)}</td>
    <td>${r.tokens}${r.playerTokens ? ` (${r.playerTokens} PC)` : ""}</td><td>${r.walls}</td><td>${r.lights}</td>
    <td class="ptriage-wrap">${esc(prepNote(r)) || "–"}</td></tr>`).join("");

  return `<div class="ptriage-header">
      ${PLAN_INTRO.map(p => `<p>${esc(p)}</p>`).join("")}
      <div class="ptriage-cards">${cards}</div>
      <div class="ptriage-actions">
        <button type="button" data-action="refresh"><i class="fa-solid fa-rotate"></i> Refresh</button>
        <button type="button" data-action="copyMarkdown"><i class="fa-solid fa-copy"></i> Copy prep checklist</button>
      </div></div>
    <table class="ptriage-table"><caption>By folder (Export to Compendium works on a whole folder)</caption>
      <thead><tr><th>Folder</th><th>Scenes</th><th>Size</th><th>No prep</th><th>After prep</th><th>In use</th></tr></thead>
      <tbody>${folderRows}</tbody></table>
    <table class="ptriage-table"><caption>Scenes, best candidates first</caption>
      <thead><tr><th>Scene</th><th>Suggestion</th><th>Size</th><th>Token item copies</th><th>Tokens</th><th>Walls</th>
        <th>Lights</th><th>Before archiving</th></tr></thead>
      <tbody>${sceneRows}</tbody></table>`;
}

/**
 * A checklist to paste into session notes.
 * @param {ReturnType<typeof planScenes>} plan
 */
export function scenePlanToMarkdown(plan) {
  const lines = ["# Scene archive plan", "", ...PLAN_INTRO.flatMap(p => [p, ""])];
  const section = (status, withPrep) => {
    const list = plan.rows.filter(r => r.status === status);
    if ( !list.length ) return;
    lines.push(`## ${STATUS_LABEL[status]}: ${list.length} scenes, ${fmtBytes(plan.groups[status].bytes)}`, "");
    for ( const r of list ) {
      const where = r.folder ? ` (${r.folder})` : "";
      lines.push(`- [ ] ${r.name}${where}, ${fmtBytes(r.bytes)}` + (withPrep && prepNote(r) ? `: ${prepNote(r)}` : ""));
    }
    lines.push("");
  };
  section("ready", false);
  section("prep", true);
  return lines.join("\n");
}
