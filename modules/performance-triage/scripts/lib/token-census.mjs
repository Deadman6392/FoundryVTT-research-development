/**
 * Count tokens by the sidebar actor they were placed from, across every scene in the world, and list where each
 * actor's tokens are. It finds player characters left behind on old maps and adventures that placed dozens of one
 * creature. Works on plain source data so it can be tested in Node; nothing here changes the world.
 */
import { esc, fmtBytes, fmtMs, plural } from "./report-format.mjs";

/** Group key for tokens whose actor is not in the sidebar (deleted, or never had one). */
export const NO_ACTOR = "";

function size(value) {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * @param {object} input
 * @param {object[]} input.scenes                Scene source data, with tokens
 * @param {Map<string, {name: string, type: string, player: boolean}>} input.actors  World actors by id
 * @param {Map<string, string>} [input.folders]  Scene folder id -> display path ("Vallaki / Interiors")
 * @param {Set<string>} [input.inUse]            Scene ids someone is on right now
 */
export function censusTokens({ scenes, actors, folders = new Map(), inUse = new Set() }) {
  const groups = new Map();
  let total = 0;
  let withTokens = 0;
  for ( const scene of scenes ) {
    const tokens = Array.isArray(scene?.tokens) ? scene.tokens : [];
    if ( tokens.length ) withTokens++;
    for ( const t of tokens ) {
      total++;
      const actor = actors.get(t?.actorId);
      const key = actor ? t.actorId : NO_ACTOR;
      let g = groups.get(key);
      if ( !g ) {
        groups.set(key, g = { id: key, name: actor?.name || "(no sidebar actor)", type: actor?.type ?? "",
          player: !!actor?.player, tokens: 0, linked: 0, bytes: 0, names: new Set(), scenes: new Map() });
      }
      let s = g.scenes.get(scene?._id);
      if ( !s ) {
        g.scenes.set(scene?._id, s = { id: scene?._id ?? "", name: scene?.name || "(unnamed)",
          folder: folders.get(scene?.folder) ?? "", inUse: inUse.has(scene?._id), bytes: 0, tokens: [] });
      }
      // The whole token, delta included: what it adds to the world data every client loads
      const bytes = size(t);
      const linked = t?.actorLink === true;
      const name = t?.name || g.name;
      s.tokens.push({ id: t?._id ?? "", name, linked, hidden: t?.hidden === true, bytes });
      s.bytes += bytes;
      g.tokens++;
      g.bytes += bytes;
      if ( linked ) g.linked++;
      g.names.add(name);
    }
  }

  const list = [...groups.values()].map(g => {
    const sceneList = [...g.scenes.values()]
      .sort((a, b) => (b.tokens.length - a.tokens.length) || a.name.localeCompare(b.name));
    return {
      ...g,
      names: [...g.names].sort(),
      unlinked: g.tokens - g.linked,
      scenes: sceneList,
      most: sceneList[0]?.tokens.length ?? 0
    };
  });
  return { tokens: total, scenes: withTokens, sceneTotal: scenes.length, actors: sortCensus(list) };
}

/** Columns the census can be sorted by, and the direction each starts in. */
export const SORT_KEYS = { name: "asc", type: "asc", tokens: "desc", scenes: "desc", most: "desc", bytes: "desc" };

const SORT_VALUE = {
  name: g => g.name.toLocaleLowerCase(),
  type: g => g.type,
  tokens: g => g.tokens,
  scenes: g => g.scenes.length,
  most: g => g.most,
  bytes: g => g.bytes
};

/**
 * Sort census rows; ties fall back to the token count, then the name.
 * @param {object[]} actors
 * @param {{key?: string, dir?: "asc"|"desc"}} [sort]  Defaults to the most tokens first
 * @returns {object[]} A sorted copy
 */
export function sortCensus(actors, { key = "tokens", dir } = {}) {
  const value = SORT_VALUE[key] ?? SORT_VALUE.tokens;
  const sign = ((dir ?? SORT_KEYS[key] ?? "desc") === "asc") ? 1 : -1;
  const cmp = (a, b) => ((a < b) ? -1 : (a > b) ? 1 : 0);
  return [...actors].sort((a, b) => (sign * cmp(value(a), value(b)))
    || (b.tokens - a.tokens) || a.name.localeCompare(b.name));
}

const MAX_LISTED = 6;

function list(items) {
  const shown = items.slice(0, MAX_LISTED);
  const more = items.length - shown.length;
  return shown.join(", ") + (more > 0 ? `, and ${more} more` : "");
}

/**
 * What stands out about tokens of player-owned actors, in sentences: those are the copies a GM loses track of.
 * @param {ReturnType<typeof censusTokens>} census
 * @returns {string[]}
 */
export function playerNotes(census) {
  const players = census.actors.filter(g => g.player);
  if ( !players.length ) return ["No scene has a token of a player-owned actor."];
  const tokens = players.reduce((n, g) => n + g.tokens, 0);
  const sceneIds = new Set(players.flatMap(g => g.scenes.map(s => s.id)));
  const notes = [`Player-owned actors have ${plural(tokens, "token")} on ${plural(sceneIds.size, "scene")}. Open an `
    + "actor below to see which scenes, and use a token's button to go to it."];
  const stacked = players.flatMap(g => g.scenes.filter(s => s.tokens.length > 1)
    .map(s => `${g.name} ×${s.tokens.length} on ${s.name}`));
  if ( stacked.length ) notes.push(`More than one token of the same actor on one scene: ${list(stacked)}.`);
  const unlinked = players.flatMap(g => g.scenes.flatMap(s => s.tokens.filter(t => !t.linked)
    .map(() => `${g.name} on ${s.name}`)));
  if ( unlinked.length ) {
    notes.push(`Unlinked tokens of player-owned actors: ${list([...new Set(unlinked)])}. An unlinked token doesn't `
      + "share the character sheet: damage and changes on it stay on that token, and it stores its own copy of the "
      + "character's items.");
  }
  notes.push("A linked token stores only its token settings, so leftover copies cost little at load; clearing "
    + "them keeps a character from turning up on a map the party has left.");
  return notes;
}

/** One sentence of context for the tab. */
export const CENSUS_SUMMARY = "Every token on every scene in the world, grouped by the sidebar actor it was placed "
  + "from. Tokens on scenes in compendiums aren't counted, since those aren't loaded. Size is what a token adds to "
  + "the world data every client loads; an unlinked token's own copies of its actor's items are most of it.";

const sortMark = (sort, key) => ((sort.key === key) ? ((sort.dir ?? SORT_KEYS[key]) === "asc" ? " ▲" : " ▼") : "");

function tokenButton(scene, t, player) {
  const flags = [t.hidden ? "hidden" : "", (player && !t.linked) ? "unlinked" : ""].filter(Boolean);
  const label = `${t.name}${flags.length ? ` (${flags.join(", ")})` : ""}`;
  return `<button type="button" class="ptriage-chip${flags.length ? " ptriage-chip-flag" : ""}" data-action="showToken" `
    + `data-scene="${esc(scene.id)}" data-token="${esc(t.id)}" data-tooltip="Go to this token: views the scene and selects it">`
    + `<i class="fa-solid fa-location-crosshairs"></i> ${esc(label)}</button>`;
}

function scenesTable(g) {
  const rows = g.scenes.map(s => `<tr>
    <td><strong>${esc(s.name)}</strong>${s.folder ? ` <span class="ptriage-summary">${esc(s.folder)}</span>` : ""}`
    + `${s.inUse ? " <span class=\"ptriage-summary\">(in use now)</span>" : ""}</td>
    <td>${s.tokens.length}</td><td>${fmtBytes(s.bytes)}</td>
    <td class="ptriage-wrap">${s.tokens.map(t => tokenButton(s, t, g.player)).join(" ")}</td></tr>`).join("");
  return `<table class="ptriage-table"><thead><tr><th>Scene</th><th>Tokens</th><th>Size</th><th>Go to a token</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/**
 * @param {ReturnType<typeof censusTokens>} census
 * @param {object} [opts]
 * @param {{key?: string, dir?: "asc"|"desc"}} [opts.sort]
 * @param {Set<string>} [opts.expanded]   Actor group ids to show with their scenes listed
 * @param {{text?: string, players?: boolean}} [opts.filter]
 * @param {number} [opts.measuredMs]
 * @returns {string} HTML for the census tab
 */
export function censusToHtml(census, { sort = {}, expanded = new Set(), filter = {}, measuredMs = null } = {}) {
  const sorted = sortCensus(census.actors, sort);
  const playerTokens = census.actors.filter(g => g.player).reduce((n, g) => n + g.tokens, 0);
  const totalBytes = census.actors.reduce((n, g) => n + g.bytes, 0);
  const cards = [
    ["Tokens", `${census.tokens} (${fmtBytes(totalBytes)})`],
    ["Scenes with tokens", `${census.scenes} of ${census.sceneTotal}`],
    ["Sidebar actors used", `${census.actors.filter(g => g.id !== NO_ACTOR).length}`],
    ["Player-owned tokens", `${playerTokens}`]
  ].map(([k, v]) => `<div class="ptriage-card"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");

  const columns = [["name", "Actor"], ["type", "Type"], ["tokens", "Tokens"], ["scenes", "Scenes"],
    ["most", "Most on one scene"], ["bytes", "Size"]];
  const head = columns.map(([key, label]) => `<th data-action="sortCensus" data-key="${key}" class="ptriage-sort">`
    + `${esc(label)}${sortMark(sort.key ? sort : { key: "tokens" }, key)}</th>`).join("");

  const bodies = sorted.map(g => {
    const open = expanded.has(g.id);
    const search = [g.name, ...g.names, ...g.scenes.map(s => s.name)].join("\n").toLocaleLowerCase();
    const names = g.names.filter(n => n !== g.name);
    return `<tbody data-actor="${esc(g.id)}" data-search="${esc(search)}" data-player="${g.player ? 1 : 0}">
      <tr class="ptriage-census-row" data-action="toggleActor" aria-expanded="${open}">
        <td><i class="fa-solid fa-caret-${open ? "down" : "right"}"></i> <strong>${esc(g.name)}</strong>`
      + `${g.player ? " <span class=\"ptriage-badge\">player</span>" : ""}`
      + `${names.length ? `<br><span class="ptriage-summary">as ${esc(list(names))}</span>` : ""}</td>
        <td>${esc(g.type || "–")}</td><td>${g.tokens}${g.linked ? ` <span class="ptriage-summary">(${g.linked} linked)</span>` : ""}</td>
        <td>${g.scenes.length}</td><td>${g.most}</td><td>${fmtBytes(g.bytes)}</td></tr>
      <tr class="ptriage-census-detail"${open ? "" : " hidden"}><td colspan="${columns.length}">${scenesTable(g)}</td></tr>
    </tbody>`;
  }).join("");

  return `<div class="ptriage-header">
      <p>${esc(CENSUS_SUMMARY)}</p>
      <div class="ptriage-cards">${cards}</div>
      ${playerNotes(census).map(n => `<p>${esc(n)}</p>`).join("")}
      <div class="ptriage-actions ptriage-census-filter">
        <input type="search" name="censusText" value="${esc(filter.text ?? "")}" placeholder="Filter by actor, token or scene name">
        <label><input type="checkbox" name="censusPlayers"${filter.players ? " checked" : ""}> Player-owned only</label>
        <button type="button" data-action="refresh"><i class="fa-solid fa-rotate"></i> Refresh</button>
      </div>
      ${Number.isFinite(measuredMs) ? `<p class="ptriage-summary">Counted in ${esc(fmtMs(measuredMs))}. Counts update as tokens are created or deleted while this window is open.</p>` : ""}
    </div>
    <table class="ptriage-table ptriage-census"><thead><tr>${head}</tr></thead>${bodies}</table>
    <p class="ptriage-census-empty" hidden>No actors match the filter.</p>`;
}

/**
 * Whether an actor group passes the filter, from the attributes its census row carries.
 * @param {{search: string, player: boolean}} row
 * @param {{text?: string, players?: boolean}} filter
 */
export function matchesFilter(row, { text = "", players = false } = {}) {
  if ( players && !row.player ) return false;
  const needle = text.trim().toLocaleLowerCase();
  return !needle || row.search.includes(needle);
}
