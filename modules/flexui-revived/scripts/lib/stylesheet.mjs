/**
 * Builds the one stylesheet a client needs for its theme, sizes and areas. No Foundry globals here.
 *
 * Why generated CSS instead of shipped .css files: the original loaded three stylesheets per client at startup and
 * reloaded the page on every change. One generated string costs no fetch, only contains the chosen theme, and can be
 * swapped live.
 *
 * Selectors target Foundry v13's interface (ApplicationV2 sidebar, scene controls, navigation, hotbar, players) by
 * element ids, data-tab attributes and data-action names rather than Font Awesome classes, which change between
 * versions. Everything is placed in Foundry's "modules" cascade layer, where a manifest stylesheet would go: it beats
 * core styles at any specificity and leaves room for other modules and the "exceptions" layer to override it. Layout
 * properties (position, width of the sidebar, display) are left alone; the original's layout rules are what wrecked
 * the v13 interface.
 */
import { TEXTURES } from "./themes.mjs";
import { TAB_ART, cssUrl } from "./art.mjs";

/** Parts of the interface a player can switch off one by one, for example where another UI module styles them. */
export const AREAS = ["tabs", "panel", "chat", "directories", "combat", "controls", "navigation", "hotbar", "players",
  "windows"];

/** Window title bars are off by default: system and module sheets often style their own. */
export const DEFAULT_AREAS = Object.freeze(Object.fromEntries(AREAS.map(a => [a, a !== "windows"])));

/** Sidebar tab button and icon sizes in pixels. "large" matches the original's 40px tab icons. */
export const SIZE_PX = { compact: { tab: 32, icon: 22 }, large: { tab: 46, icon: 40 } };

/** Directory text scale and the item height the original set for each font size. */
export const FONT_SCALE = { small: { scale: 0.9, item: 36 }, medium: { scale: 1, item: 42 }, large: { scale: 1.2, item: 48 } };

/**
 * Fill in areas missing from a stored value (for example areas added in a later version) with their defaults.
 * @param {object} [stored]
 * @returns {Record<string, boolean>}
 */
export function normalizeAreas(stored) {
  const out = {};
  for ( const area of AREAS ) out[area] = (typeof stored?.[area] === "boolean") ? stored[area] : DEFAULT_AREAS[area];
  return out;
}

/** Quote a string for a CSS content value. */
export function cssString(text) {
  return `"${String(text).replace(/["\\]/g, c => `\\${c}`).replace(/[\n\r]+/g, " ")}"`;
}

const kebab = s => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

/** A button surface: the theme's image for the role when there is one, otherwise a bevelled gradient of the color. */
function buttonSurface(image, color) {
  if ( image ) return `background: ${image} center / 100% 100% no-repeat; border-color: transparent;`;
  return `background: linear-gradient(color-mix(in srgb, ${color} 70%, white), ${color} 45%, `
    + `color-mix(in srgb, ${color} 65%, black)); border: 1px solid color-mix(in srgb, ${color} 50%, black);`;
}

/** Replace a caret glyph with one of the theme's arrow images, the way the original did. */
function arrowRules(selector, url, sides) {
  return sides.filter(([, role]) => url(role)).map(([side, role]) => `
${selector}:is(.fa-caret-${side}, .fa-angle-${side}, .fa-chevron-${side})::before {
  content: "";
  display: block;
  font-size: 0;
  width: calc(var(--fxr-icon) * 0.55);
  height: calc(var(--fxr-icon) * 0.55);
  background: ${url(role)} center / contain no-repeat;
}`).join("");
}

/** Panel-colored square controls: scene controls, navigation entries, hotbar and roll-mode buttons. */
const CONTROL = `background-color: var(--fxr-panel);
    background-image: var(--fxr-panel-image);
    background-size: var(--fxr-panel-size);
    border: 1px solid var(--fxr-edge);
    color: var(--fxr-text);
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);`;
const CONTROL_HOVER = `border-color: var(--fxr-accent);
    color: var(--fxr-accent);
    box-shadow: 0 0 6px var(--fxr-glow);`;
const CONTROL_ACTIVE = `border-color: var(--fxr-accent);
    color: var(--fxr-accent);
    box-shadow: inset 0 0 8px var(--fxr-glow), 0 0 6px var(--fxr-glow);`;

/** Core v13 color variables for ui-control buttons, set as well so controls this file doesn't name follow along. */
const CONTROL_VARS = `--control-bg-color: var(--fxr-panel);
    --control-border-color: var(--fxr-edge);
    --control-icon-color: var(--fxr-text);
    --control-hover-bg-color: var(--fxr-panel-alt);
    --control-hover-border-color: var(--fxr-accent);
    --control-active-bg-color: var(--fxr-panel-alt);
    --control-active-border-color: var(--fxr-accent);
    --control-active-icon-color: var(--fxr-accent);
    --toggle-active-bg-color: var(--fxr-panel-alt);
    --toggle-active-border-color: var(--fxr-accent);`;

function variables({ theme, url, size, font }) {
  const s = SIZE_PX[size] ?? SIZE_PX.large;
  const f = FONT_SCALE[font] ?? FONT_SCALE.medium;
  const panelArt = url("main_panel");
  const paperArt = url("parchment");
  const colors = { ...theme.palette, ...(panelArt ? theme.panelArtPalette : {}) };
  const palette = Object.entries(colors).map(([k, v]) => `--fxr-${kebab(k)}: ${v};`).join("\n  ");
  return `:root {
  ${palette}
  --fxr-texture: ${TEXTURES[theme.texture]};
  --fxr-texture-text: ${theme.palette.text};
  --fxr-panel-image: ${panelArt ?? TEXTURES[theme.texture]};
  --fxr-panel-size: ${panelArt ? "100% 100%" : "auto"};
  --fxr-paper-image: ${paperArt ?? TEXTURES.parchment};
  --fxr-tab: ${s.tab}px;
  --fxr-icon: ${s.icon}px;
  --fxr-font-scale: ${f.scale};
  --fxr-item-height: ${f.item}px;
}`;
}

/* -------------------------------------------- */
/*  Areas                                       */
/* -------------------------------------------- */

function tabs({ theme, url }) {
  const tabsWithArt = Object.entries(TAB_ART).filter(([, role]) => url(role));
  const hex = (theme.tabShape === "hex") && !tabsWithArt.length;
  const collapse = ":is(button.collapse, [data-action=\"toggleState\"])";

  let css = `#sidebar-tabs {
  --control-size: var(--fxr-tab);
  ${CONTROL_VARS}
}
#sidebar-tabs .ui-control {
  width: var(--fxr-tab);
  height: var(--fxr-tab);
  font-size: calc(var(--fxr-icon) * 0.6);
  ${CONTROL}
  color: var(--fxr-accent);
  box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.7);${hex ? `
  clip-path: polygon(25% 2%, 75% 2%, 100% 50%, 75% 98%, 25% 98%, 0 50%);
  border-radius: 0;` : ""}
}
#sidebar-tabs .ui-control:hover {
  border-color: var(--fxr-accent);
  color: var(--fxr-text);
  box-shadow: inset 0 0 6px var(--fxr-glow);
}
#sidebar-tabs .ui-control:is([aria-pressed="true"], .active) {
  border-color: var(--fxr-accent);
  color: var(--fxr-text);
  box-shadow: inset 0 0 8px var(--fxr-glow), 0 0 6px var(--fxr-glow);${hex ? `
  background-color: color-mix(in srgb, var(--fxr-accent) 35%, var(--fxr-panel));` : ""}
}`;

  if ( tabsWithArt.length ) {
    // Hide the glyph with font-size rather than fighting Font Awesome over "content", which it may set unlayered
    const art = tabsWithArt.map(([tab]) => `#sidebar-tabs [data-tab="${tab}"]`);
    css += `
${art.join(",\n")} {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
${art.map(s => `${s}::before`).join(",\n")} {
  content: "";
  display: block;
  font-size: 0;
  width: var(--fxr-icon);
  height: var(--fxr-icon);
  background: center / contain no-repeat;
}
${art.map(s => `${s}:is([aria-pressed="true"], .active)`).join(",\n")} {
  border-color: var(--fxr-accent);
  box-shadow: inset 0 0 8px var(--fxr-glow);
}`;
    for ( const [tab, role] of tabsWithArt ) {
      css += `\n#sidebar-tabs [data-tab="${tab}"]::before { background-image: ${url(role)}; }`;
    }
  }

  return css + arrowRules(`#sidebar-tabs ${collapse}`, url, [["left", "arrow_left"], ["right", "arrow_right"]]);
}

function panel({ url }) {
  const frame = url("main_panel");
  // The original's main_panel images are frames: border-image keeps their edges crisp at any sidebar height, and a
  // 1px transparent border (instead of the original 10px) keeps the v13 layout as it is.
  const surface = frame
    ? `border: 1px solid transparent;
  border-image: ${frame} 20 fill / 10px stretch;
  background: none;`
    : `background-color: var(--fxr-panel);
  background-image: var(--fxr-texture);
  border: 1px solid var(--fxr-edge);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), inset 0 0 24px rgba(0, 0, 0, 0.55);`;
  return `#sidebar-content {
  ${surface}
  color: var(--fxr-text);
  color-scheme: dark;
  --sidebar-background: var(--fxr-panel);
  --color-text-primary: var(--fxr-text);
  --color-text-secondary: var(--fxr-muted);
  --color-text-emphatic: var(--fxr-text);
  --color-scrollbar: var(--fxr-edge);
  --color-scrollbar-track: transparent;
}
#sidebar-content > .sidebar-tab {
  background: transparent;
}`;
}

function chat({ url, labels }) {
  const border = url("dropdown_border");
  const inputBorder = border ? `border: 1px solid transparent;
  border-image: ${border} 4 / 4px repeat;` : "border: 1px solid var(--fxr-paper-edge);";
  return `.chat-message {
  background-color: var(--fxr-paper);
  background-image: var(--fxr-paper-image);
  border: 1px solid var(--fxr-paper-edge);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  color: var(--fxr-ink);
  color-scheme: light;
  --color-text-primary: var(--fxr-ink);
  --color-text-secondary: color-mix(in srgb, var(--fxr-ink) 75%, transparent);
  --color-text-emphatic: var(--fxr-ink);
  --color-text-subtle: color-mix(in srgb, var(--fxr-ink) 65%, transparent);
  --color-border: color-mix(in srgb, var(--fxr-ink) 30%, transparent);
}
.chat-message .message-header .message-sender {
  color: var(--fxr-sender);
  font-weight: bold;
}
.chat-message.whisper .message-header {
  font-style: italic;
}
.chat-message.whisper .message-metadata::before {
  content: ${cssString(labels.whisper ?? "(Whisper)")} " ";
  color: color-mix(in srgb, var(--fxr-ink) 65%, transparent);
}
.chat-message.blind .message-metadata::before {
  content: ${cssString(labels.blind ?? "(Blind)")} " ";
  color: color-mix(in srgb, var(--fxr-ink) 65%, transparent);
}
#chat-message {
  background-color: var(--fxr-paper);
  background-image: var(--fxr-paper-image);
  color: var(--fxr-ink);
  ${inputBorder}
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.45);
}
#chat-message::placeholder {
  color: color-mix(in srgb, var(--fxr-ink) 55%, transparent);
}
:is(#roll-privacy, #message-modes) {
  ${CONTROL_VARS}
}
:is(#roll-privacy, #message-modes) .ui-control {
  ${CONTROL}
}
:is(#roll-privacy, #message-modes) .ui-control:hover {
  ${CONTROL_HOVER}
}
:is(#roll-privacy, #message-modes) .ui-control:is([aria-pressed="true"], .active) {
  ${CONTROL_ACTIVE}
}`;
}

function directories({ theme, url }) {
  const border = url("dropdown_border");
  const folderArt = url(theme.folderArt);
  const clear = url("button_clear");
  return `.directory-header :is(.header-search input, input[type="search"]) {
  background-color: var(--fxr-paper);
  background-image: var(--fxr-paper-image);
  color: var(--fxr-ink);
  ${border ? `border: 1px solid transparent;
  border-image: ${border} 4 / 4px repeat;` : "border: 1px solid var(--fxr-paper-edge);"}
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.5);
}
.directory-header :is(.header-search input, input[type="search"])::placeholder {
  color: color-mix(in srgb, var(--fxr-ink) 55%, transparent);
}
:is(.directory-header .header-actions, .directory-footer) button {
  ${buttonSurface(url("button_green"), "var(--fxr-go)")}
  color: #fff;
  text-shadow: 1px 1px 2px #000;
}
:is(.directory-header .header-actions, .directory-footer) button:hover {
  filter: brightness(1.15);
  box-shadow: 0 0 6px var(--fxr-glow);
}
.directory-item.folder > .folder-header {
  ${folderArt
    ? `background-image: ${folderArt};
  background-size: 100% 100%;
  background-repeat: no-repeat;`
    : `background-image: linear-gradient(rgba(255, 255, 255, 0.14), rgba(0, 0, 0, 0.3));
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.15);`}
  color: #fff;
  text-shadow: 1px 2px 3px #000;
}
.directory-item.folder > .folder-header :is(h3, .folder-name, a, button, i) {
  color: inherit;
}
:is(#settings, .settings-sidebar) button {
  ${clear ? `background: ${clear} center / 100% 100% no-repeat;
  border-color: transparent;` : `background: linear-gradient(var(--fxr-panel-alt), var(--fxr-panel));
  border: 1px solid var(--fxr-edge);`}
  color: var(--fxr-text);
  text-shadow: 1px 1px 2px #000;
}
:is(#settings, .settings-sidebar) button:hover {
  border-color: var(--fxr-accent);
  box-shadow: 0 0 6px var(--fxr-glow);
}
.directory-list {
  --sidebar-item-height: var(--fxr-item-height);
}
.directory-list .directory-item :is(.entry-name, .folder-name, .document-name) {
  font-size: calc(1em * var(--fxr-font-scale));
}`;
}

function combat({ url }) {
  return `.combat-controls :is(.combat-control-lg, button[data-action="startCombat"], button[data-action="endCombat"]) {
  ${buttonSurface(url("button_red"), "var(--fxr-stop)")}
  color: #fff;
  text-shadow: 1px 1px 2px #000;
}
.combat-controls :is(.combat-control-lg, button[data-action="startCombat"], button[data-action="endCombat"]):hover {
  filter: brightness(1.15);
  box-shadow: 0 0 6px var(--fxr-glow);
}
.combat-tracker {
  --entry-hover-bg: color-mix(in srgb, var(--fxr-accent) 15%, transparent);
  --entry-active-bg: color-mix(in srgb, var(--fxr-accent) 30%, transparent);
}
.combat-tracker .combatant.active {
  box-shadow: inset 3px 0 0 var(--fxr-accent);
}`;
}

function controls() {
  return `#scene-controls {
  ${CONTROL_VARS}
}
#scene-controls .ui-control {
  ${CONTROL}
}
#scene-controls .ui-control:hover {
  ${CONTROL_HOVER}
}
#scene-controls .ui-control:is([aria-pressed="true"], .active) {
  ${CONTROL_ACTIVE}
}`;
}

function navigation({ url }) {
  return `#scene-navigation {
  ${CONTROL_VARS}
}
#scene-navigation :is(.scene, .ui-control) {
  ${CONTROL}
}
#scene-navigation :is(.scene, .ui-control):hover {
  ${CONTROL_HOVER}
}
#scene-navigation .scene:is(.view, [aria-pressed="true"]) {
  ${CONTROL_ACTIVE}
}
#scene-navigation .scene.active {
  color: var(--fxr-accent);
}${arrowRules("#scene-navigation-expand", url, [["up", "arrow_up"], ["down", "arrow_down"]])}`;
}

function hotbar() {
  return `#hotbar {
  ${CONTROL_VARS}
}
#hotbar .slot {
  background-color: color-mix(in srgb, var(--fxr-panel) 85%, transparent);
  border: 1px solid var(--fxr-edge);
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.7);
  color: var(--fxr-text);
}
#hotbar .slot:hover {
  border-color: var(--fxr-accent);
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.7), 0 0 6px var(--fxr-glow);
}
#hotbar .ui-control {
  ${CONTROL}
}
#hotbar .ui-control:hover {
  ${CONTROL_HOVER}
}`;
}

function players() {
  return `#players {
  background-color: var(--fxr-panel);
  background-image: var(--fxr-texture);
  border: 1px solid var(--fxr-edge);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
  color: var(--fxr-texture-text);
  --color-text-primary: var(--fxr-texture-text);
  ${CONTROL_VARS}
}`;
}

function windows() {
  // The texture, never main_panel: a frame image stretched across a 700px title bar smears its edges
  return `:is(.application, .app) > .window-header {
  background-color: var(--fxr-panel);
  background-image: var(--fxr-texture);
  border-bottom: 1px solid var(--fxr-edge);
  color: var(--fxr-texture-text);
}
:is(.application, .app) > .window-header :is(.window-title, button, a, i) {
  color: var(--fxr-texture-text);
}`;
}

const AREA_CSS = { tabs, panel, chat, directories, combat, controls, navigation, hotbar, players, windows };

/**
 * @param {object} options
 * @param {object} options.theme                      An entry of THEMES
 * @param {Record<string, string>} [options.art]      role -> path, from resolveArt
 * @param {Record<string, boolean>} [options.areas]   Which areas to style
 * @param {string} [options.size]                     "compact" or "large"
 * @param {string} [options.font]                     "small", "medium" or "large"
 * @param {{whisper?: string, blind?: string}} [options.labels]  Localized chat labels
 * @param {(path: string) => string} [options.route]  Adds the server's URL prefix to a relative path
 * @returns {string}
 */
export function buildStylesheet({ theme, art = {}, areas = DEFAULT_AREAS, size = "large", font = "medium", labels = {},
  route = p => `/${p}` }) {
  const url = role => (art[role] ? cssUrl(art[role], route) : null);
  const context = { theme, url, size, font, labels };
  const parts = [variables(context)];
  for ( const area of AREAS ) {
    if ( areas[area] ) parts.push(`/* ${area} */\n${AREA_CSS[area](context)}`);
  }
  return `/* FlexUI Revived: ${theme.id} */\n@layer modules {\n${parts.join("\n\n")}\n}\n`;
}
