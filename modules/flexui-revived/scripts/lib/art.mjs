/**
 * Where theme images come from. FlexUI Revived ships no artwork: the original FlexUI's images belong to iotech and
 * Rexard and may not be redistributed. A table can use them from an installed copy of the original module (which
 * Foundry serves whether or not that module is active), use its own folder of images, or use none and let the CSS
 * textures stand in. No Foundry globals here.
 */

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

/** Every image role, named after the original FlexUI's file names (without extension). */
export const ART_ROLES = [
  ...Object.values(TAB_ART),
  "arrow_left", "arrow_right", "arrow_up", "arrow_down",
  "main_panel", "parchment", "button_clear", "button_fancy", "button_green", "button_red", "dropdown_border"
];

/**
 * Roles skipped by lightweight textures. The original parchment is a 2 MB image decoded at full size; CSS textures
 * draw these surfaces instead.
 */
export const HEAVY_ROLES = ["main_panel", "parchment"];

export const ART_SOURCES = ["auto", "original", "custom", "none"];

const IMAGE_EXT = /\.(webp|png|jpe?g|avif|gif|svg)$/i;

/** Where the original FlexUI (0.3.0) keeps a theme's images, relative to Foundry's data root. */
export function originalArtPath(folder, role) {
  return `modules/flexui/ui/img/${folder}/${role}.webp`;
}

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

/**
 * Decide which image each role uses for a theme.
 * @param {object} options
 * @param {{folder: string}} options.theme
 * @param {string} options.source              One of ART_SOURCES
 * @param {boolean} options.originalInstalled   Whether Foundry lists the original FlexUI module
 * @param {Record<string, string>} [options.custom]  Roles found in the GM's custom folder
 * @param {boolean} [options.lightweight]        Leave out HEAVY_ROLES
 * @returns {Record<string, string>} role -> path; roles without an image are absent
 */
export function resolveArt({ theme, source, originalInstalled, custom = {}, lightweight = false }) {
  const art = {};
  const useOriginal = (source === "original") || ((source !== "none") && originalInstalled);
  if ( useOriginal ) for ( const role of ART_ROLES ) art[role] = originalArtPath(theme.folder, role);
  if ( source === "custom" ) Object.assign(art, custom);
  if ( lightweight ) for ( const role of HEAVY_ROLES ) delete art[role];
  return art;
}

/**
 * Turn a stored path into something a stylesheet can load. Relative paths go through the route function so a server
 * with a URL prefix (https://host/foundry/) still finds them; the original FlexUI hard-coded /modules/... and broke
 * there.
 * @param {string} path
 * @param {(path: string) => string} route   foundry.utils.getRoute in Foundry
 * @returns {string} A quoted CSS url()
 */
export function cssUrl(path, route) {
  const href = /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(path) ? path : route(path);
  return `url("${href.replace(/["\\\n\r]/g, c => `\\${c === "\n" ? "a " : c === "\r" ? "d " : c}`)}")`;
}
