/**
 * Where theme images come from: the free icons and textures bundled in assets/ (see CREDITS.md), a GM's own folder
 * of images, or none at all, in which case CSS textures and Font Awesome icons stand in. No Foundry globals here.
 */
import { iconFor } from "./themes.mjs";

/** Where the bundled assets live, relative to Foundry's data root. */
export const ASSET_ROOT = "modules/flexui-revived/assets";

/** Sidebar tab id (the button's data-tab) -> image role. Tabs not listed keep their Font Awesome icon. */
export const TAB_ART = {
  chat: "icon_chat",
  combat: "icon_combat",
  scenes: "icon_scene",
  actors: "icon_actor",
  items: "icon_item",
  journal: "icon_journal",
  tables: "icon_table",
  cards: "icon_card",
  macros: "icon_macro",
  playlists: "icon_audio",
  compendium: "icon_compendium",
  settings: "icon_settings"
};

/**
 * Every role a custom folder can fill, named like the original FlexUI's files so a folder laid out the same way works.
 * panel_texture is new: a tiling texture for the sidebar panel, where main_panel is a frame stretched around it.
 */
export const ART_ROLES = [
  ...Object.values(TAB_ART),
  "arrow_left", "arrow_right", "arrow_up", "arrow_down",
  "main_panel", "panel_texture", "parchment", "button_clear", "button_green", "button_red", "dropdown_border"
];

/** Roles skipped by lightweight textures: the surfaces that can be large images in a custom folder. */
export const HEAVY_ROLES = ["main_panel", "panel_texture", "parchment"];

export const ART_SOURCES = ["bundled", "custom", "none"];

/**
 * 0.1 offered "auto" and "original" (the original FlexUI's artwork from an installed copy); both now mean the bundled
 * artwork, which replaced it.
 * @param {string} source
 * @returns {string} One of ART_SOURCES
 */
export function normalizeSource(source) {
  return ART_SOURCES.includes(source) ? source : "bundled";
}

const IMAGE_EXT = /\.(webp|png|jpe?g|avif|gif|svg)$/i;

/**
 * Map the files found in a folder to image roles by file name, ignoring case and extension. When two files share a
 * role (icon_chat.png and icon_chat.webp) the first listed wins, so a scan gives the same answer every time.
 * @param {string[]} paths   File paths or URLs, as FilePicker.browse returns them
 * @returns {Record<string, string>} role -> path
 */
export function matchArtFiles(paths) {
  const roles = new Set(ART_ROLES);
  const found = {};
  for ( const path of paths ) {
    const name = decodeURIComponent(path.split(/[?#]/)[0].split("/").pop() ?? "");
    if ( !IMAGE_EXT.test(name) ) continue;
    const role = name.replace(IMAGE_EXT, "").toLowerCase();
    if ( roles.has(role) && !(role in found) ) found[role] = path;
  }
  return found;
}

/** How a custom image in a role is drawn. */
function customKind(role) {
  if ( role === "main_panel" ) return "frame";
  if ( (role === "panel_texture") || (role === "parchment") ) return "tile";
  return "image";
}

/**
 * Decide which image each role uses for a theme.
 * kind "mask": a one-color bundled icon, tinted by the theme; "image": a full-color picture; "tile": a repeating
 * texture; "frame": a border image stretched around the sidebar panel.
 * @param {object} options
 * @param {object} options.theme                     An entry of THEMES
 * @param {string} options.source                    One of ART_SOURCES (older values are normalized)
 * @param {Record<string, string>} [options.custom]  Roles found in the GM's custom folder
 * @param {boolean} [options.lightweight]            Leave out HEAVY_ROLES
 * @returns {Record<string, {path: string, kind: string}>} Roles without an image are absent
 */
export function resolveArt({ theme, source, custom = {}, lightweight = false }) {
  source = normalizeSource(source);
  const art = {};
  if ( source !== "none" ) {
    for ( const [tab, role] of Object.entries(TAB_ART) ) {
      art[role] = { path: `${ASSET_ROOT}/icons/${iconFor(theme, tab)}.svg`, kind: "mask" };
    }
    if ( theme.panel?.texture ) art.panel_texture = { path: `${ASSET_ROOT}/textures/${theme.panel.texture}.webp`, kind: "tile" };
    if ( theme.paper?.texture ) art.parchment = { path: `${ASSET_ROOT}/textures/${theme.paper.texture}.webp`, kind: "tile" };
  }
  if ( source === "custom" ) {
    for ( const [role, path] of Object.entries(custom) ) {
      if ( ART_ROLES.includes(role) ) art[role] = { path, kind: customKind(role) };
    }
  }
  if ( lightweight ) for ( const role of HEAVY_ROLES ) delete art[role];
  return art;
}

/**
 * Turn a stored path into something a stylesheet can load. Relative paths go through the route function so a server
 * with a URL prefix (https://host/foundry/) still finds them.
 * @param {string} path
 * @param {(path: string) => string} route   foundry.utils.getRoute in Foundry
 * @returns {string} A quoted CSS url()
 */
export function cssUrl(path, route) {
  const href = /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(path) ? path : route(path);
  return `url("${href.replace(/["\\\n\r]/g, c => `\\${c === "\n" ? "a " : c === "\r" ? "d " : c}`)}")`;
}
