/**
 * Builds the one stylesheet a client needs for its theme, sizes, areas and effects. No Foundry globals here.
 *
 * Why generated CSS instead of shipped .css files: only the chosen theme is ever parsed, nothing is fetched to build
 * it, and it can be swapped live.
 *
 * Selectors target Foundry v13's interface (ApplicationV2 sidebar, scene controls, navigation, hotbar, players) by
 * element ids, data-tab attributes and data-action names rather than Font Awesome classes, which change between
 * versions. Layout properties (position, width of the sidebar, display) are left alone.
 *
 * Everything sits in a sub-layer of Foundry's "modules" cascade layer. That beats core and system styles at any
 * specificity, but loses to every other module's stylesheet (which Foundry puts in "modules" itself): where another
 * module styles something, its look wins and this theme fills in around it.
 *
 * Motion is opt-in and stepped: the glow and drifting layers change once a second (see motion.mjs), so between steps
 * the browser has nothing to draw and can stay idle. A smooth animation would make it draw a frame on every display
 * refresh.
 */
import { CSS_TEXTURES, FONTS, PARTICLE_KINDS, PARTICLE_TILE, particles } from "./themes.mjs";
import { TAB_ART, cssUrl } from "./art.mjs";

/** The cascade layer every rule goes in. */
export const LAYER = "modules.flexui-revived";

/** Parts of the interface a player can switch off one by one, for example where another UI module styles them. */
export const AREAS = ["tabs", "panel", "chat", "directories", "combat", "controls", "navigation", "hotbar", "players",
  "windows"];

/** Window title bars are off by default: system and module sheets often style their own. */
export const DEFAULT_AREAS = Object.freeze(Object.fromEntries(AREAS.map(a => [a, a !== "windows"])));

/** Sidebar tab button and icon sizes in pixels. "large" matches the original FlexUI's 40px tab icons. */
export const SIZE_PX = { compact: { tab: 32, icon: 22 }, large: { tab: 46, icon: 40 } };

/** Directory text scale and the item height the original set for each font size. */
export const FONT_SCALE = { small: { scale: 0.9, item: 36 }, medium: { scale: 1, item: 42 }, large: { scale: 1.2, item: 48 } };

/** Bundled textures are 512 px squares and drift this many pixels per second when motion is on. */
const TEXTURE_TILE = 512;
const TEXTURE_DRIFT = 0.25;

/** Every moving layer returns to where it started after this many seconds, so the loop has no visible jump. */
export const DRIFT_LOOP_SECONDS = 2048;

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

/* -------------------------------------------- */
/*  Surfaces                                    */
/* -------------------------------------------- */

/**
 * The layers of a panel surface, top first: optional particles, a shade, an optional tint, then the texture (bundled
 * image, custom tile or CSS). Each layer carries its drift in px/s for motion.
 * @returns {{image: string, size: string, drift?: number[]}[]}
 */
function surfaceLayers({ theme, art, url }, withParticles) {
  const layers = [];
  if ( withParticles && theme.particles ) {
    const kind = PARTICLE_KINDS[theme.particles.kind];
    layers.push({ image: particles(theme.particles.kind, theme.particles.color), size: `${PARTICLE_TILE}px ${PARTICLE_TILE}px`,
      drift: [kind.dx, kind.dy] });
  }
  // The sidebar panel gets darker edges for depth; small controls don't need it
  if ( withParticles ) layers.push({ image: "radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(0, 0, 0, 0.45))", size: "auto" });
  const shade = theme.panel?.shade ?? 0.4;
  layers.push({ image: `linear-gradient(rgba(0, 0, 0, ${shade}), rgba(0, 0, 0, ${shade}))`, size: "auto" });
  if ( theme.panel?.tint ) {
    const tint = `color-mix(in srgb, ${theme.panel.tint} 45%, transparent)`;
    layers.push({ image: `linear-gradient(${tint}, ${tint})`, size: "auto" });
  }
  if ( art.panel_texture ) {
    layers.push({ image: url("panel_texture"), size: `${TEXTURE_TILE}px ${TEXTURE_TILE}px`, drift: [TEXTURE_DRIFT, 0] });
  } else {
    for ( const [image, size] of CSS_TEXTURES[theme.css] ?? CSS_TEXTURES.plain ) layers.push({ image, size });
  }
  return layers;
}

const images = layers => layers.map(l => l.image).join(", ");
const sizes = layers => layers.map(l => l.size).join(", ");

/** The chat paper: a bundled or custom tile multiplied by the theme's tint, or CSS when there is none. */
function paperLayers({ theme, art, url }) {
  if ( art.parchment ) return [{ image: url("parchment"), size: "auto" }];
  return (CSS_TEXTURES[theme.paperCss ?? "parchment"]).map(([image, size]) => ({ image, size }));
}

/** A button surface: a custom image for the role when there is one, otherwise a bevelled gradient of the color. */
function buttonSurface(image, color) {
  if ( image ) return `background: ${image} center / 100% 100% no-repeat; border-color: transparent;`;
  return `background: linear-gradient(color-mix(in srgb, ${color} 70%, white), ${color} 45%, `
    + `color-mix(in srgb, ${color} 65%, black)); border: 1px solid color-mix(in srgb, ${color} 50%, black);`;
}

/** Replace a caret glyph with one of the custom arrow images, the way the original did. */
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

/**
 * The panel surface (shade, tint, texture) on a control or bar. Every background longhand is set so a core shorthand
 * (no-repeat, a blend mode) can't leak in under it.
 */
const SURFACE = `background-color: var(--fxr-panel);
  background-image: var(--fxr-surface-image);
  background-size: var(--fxr-surface-size);
  background-position: 0 0;
  background-repeat: repeat;
  background-blend-mode: normal;`;

/** Panel-colored square controls: scene controls, navigation entries, hotbar and roll-mode buttons. */
const CONTROL = `${SURFACE}
  border: 1px solid var(--fxr-edge);
  color: var(--fxr-text);
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);`;
const CONTROL_HOVER = `border-color: var(--fxr-accent);
  color: var(--fxr-accent);
  box-shadow: 0 0 6px var(--fxr-glow);`;
const CONTROL_ACTIVE = `border-color: var(--fxr-accent);
  color: var(--fxr-accent);
  box-shadow: inset 0 0 8px var(--fxr-glow), 0 0 6px var(--fxr-glow);`;

/** The chat "paper": the tile multiplied by the theme's tint (on dark paper, laid over it instead). */
const PAPER = `background-color: var(--fxr-paper-tint);
  background-image: var(--fxr-paper-image);
  background-size: var(--fxr-paper-size);
  background-position: 0 0;
  background-repeat: repeat;
  background-blend-mode: var(--fxr-paper-blend);`;

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

/* -------------------------------------------- */
/*  Variables and fonts                         */
/* -------------------------------------------- */

function fontFace({ theme, route, fonts }) {
  const font = fonts && FONTS[theme.font];
  if ( !font ) return "";
  return `@font-face {
  font-family: "FXR ${font.family}";
  src: ${cssUrl(`modules/flexui-revived/assets/fonts/${font.file}`, route)} format("woff2");
  font-display: swap;
}
`;
}

function variables(context) {
  const { theme, size, font, art, url, fonts } = context;
  const s = SIZE_PX[size] ?? SIZE_PX.large;
  const f = FONT_SCALE[font] ?? FONT_SCALE.medium;
  const palette = Object.entries(theme.palette).map(([k, v]) => `--fxr-${kebab(k)}: ${v};`).join("\n  ");
  const frame = art.main_panel ? url("main_panel") : null;
  const surface = frame ? [{ image: frame, size: "100% 100%" }] : surfaceLayers(context, false);
  const paper = paperLayers(context);
  const face = fonts ? FONTS[theme.font] : null;
  const display = face ? `"FXR ${face.family}", ${face.generic}` : "inherit";
  const fill = theme.iconFill === "flat" ? "var(--fxr-accent)"
    : "linear-gradient(170deg, color-mix(in srgb, var(--fxr-accent) 40%, white), var(--fxr-accent) 50%, "
      + "color-mix(in srgb, var(--fxr-accent) 55%, black))";
  return `:root {
  ${palette}
  --fxr-surface-image: ${images(surface)};
  --fxr-surface-size: ${sizes(surface)};
  --fxr-paper-image: ${images(paper)};
  --fxr-paper-size: ${sizes(paper)};
  --fxr-paper-tint: ${theme.paper?.tint ?? theme.palette.paper};
  --fxr-paper-blend: ${theme.paper?.scheme === "dark" ? "normal" : "multiply"};
  --fxr-icon-fill: ${fill};
  --fxr-font-display: ${display};
  --fxr-tab: ${s.tab}px;
  --fxr-icon: ${s.icon}px;
  --fxr-font-scale: ${f.scale};
  --fxr-item-height: ${f.item}px;
}`;
}

/* -------------------------------------------- */
/*  Areas                                       */
/* -------------------------------------------- */

function tabs({ url, art }) {
  const masks = Object.entries(TAB_ART).filter(([, role]) => art[role]?.kind === "mask");
  const pictures = Object.entries(TAB_ART).filter(([, role]) => art[role] && (art[role].kind !== "mask"));
  const collapse = ":is(button.collapse, [data-action=\"toggleState\"])";

  // Buttons are transparent so a drop-shadow follows the icon's outline: that is the soft glow
  let css = `#sidebar-tabs {
  --control-size: var(--fxr-tab);
  ${CONTROL_VARS}
  ${SURFACE}
  border: 1px solid var(--fxr-edge);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.6);
}
#sidebar-tabs .ui-control {
  width: var(--fxr-tab);
  height: var(--fxr-tab);
  font-size: calc(var(--fxr-icon) * 0.6);
  background: transparent;
  border: 1px solid transparent;
  box-shadow: none;
  color: var(--fxr-accent);
  filter: drop-shadow(0 0 2px var(--fxr-glow)) drop-shadow(0 0 1px var(--fxr-glow));
}
#sidebar-tabs .ui-control:hover {
  border-color: color-mix(in srgb, var(--fxr-accent) 45%, transparent);
  color: var(--fxr-text);
  filter: drop-shadow(0 0 4px var(--fxr-glow)) drop-shadow(0 0 1px var(--fxr-glow)) brightness(1.15);
}
#sidebar-tabs .ui-control:is([aria-pressed="true"], .active) {
  border-color: var(--fxr-accent);
  background: color-mix(in srgb, var(--fxr-accent) 16%, transparent);
  color: var(--fxr-text);
  filter: drop-shadow(0 0 6px var(--fxr-glow)) drop-shadow(0 0 2px var(--fxr-glow));
}`;

  // Hide the glyph with font-size rather than fighting Font Awesome over "content", which it may set unlayered
  const glyphOff = `content: "";
  display: block;
  font-size: 0;
  width: var(--fxr-icon);
  height: var(--fxr-icon);`;
  if ( masks.length ) {
    css += `
${masks.map(([tab]) => `#sidebar-tabs [data-tab="${tab}"]::before`).join(",\n")} {
  ${glyphOff}
  background: var(--fxr-icon-fill);
  -webkit-mask: center / contain no-repeat;
  mask: center / contain no-repeat;
}`;
    for ( const [tab, role] of masks ) {
      css += `\n#sidebar-tabs [data-tab="${tab}"]::before { -webkit-mask-image: ${url(role)}; mask-image: ${url(role)}; }`;
    }
  }
  if ( pictures.length ) {
    css += `
${pictures.map(([tab]) => `#sidebar-tabs [data-tab="${tab}"]::before`).join(",\n")} {
  ${glyphOff}
  background: center / contain no-repeat;
}`;
    for ( const [tab, role] of pictures ) css += `\n#sidebar-tabs [data-tab="${tab}"]::before { background-image: ${url(role)}; }`;
  }
  return css + arrowRules(`#sidebar-tabs ${collapse}`, url, [["left", "arrow_left"], ["right", "arrow_right"]]);
}

function panel(context) {
  const { url, art } = context;
  const frame = art.main_panel ? url("main_panel") : null;
  const layers = frame ? surfaceLayers(context, true).slice(0, context.theme.particles ? 1 : 0) : surfaceLayers(context, true);
  // A custom main_panel is a frame: border-image keeps its edges crisp at any height, and a 1px transparent border
  // keeps the v13 layout as it is
  const surface = frame
    ? `border: 1px solid transparent;
  border-image: ${frame} 20 fill / 10px stretch;
  background-color: transparent;`
    : `background-color: var(--fxr-panel);
  border: 1px solid var(--fxr-edge);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), inset 0 0 24px rgba(0, 0, 0, 0.55),
    inset 0 0 14px color-mix(in srgb, var(--fxr-glow) 40%, transparent);`;
  return `#sidebar-content {
  ${surface}
  background-image: ${layers.length ? images(layers) : "none"};
  background-size: ${layers.length ? sizes(layers) : "auto"};
  background-position: 0 0;
  background-repeat: repeat;
  background-blend-mode: normal;
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

function chat({ theme, url, labels, fonts }) {
  const border = url("dropdown_border");
  const dark = theme.paper?.scheme === "dark";
  const inputBorder = border ? `border: 1px solid transparent;
  border-image: ${border} 4 / 4px repeat;` : "border: 1px solid var(--fxr-paper-edge);";
  const surface = PAPER;
  return `.chat-message {
  ${surface}
  border: 1px solid var(--fxr-paper-edge);
  box-shadow: ${dark ? "0 0 8px color-mix(in srgb, var(--fxr-paper-edge) 35%, transparent)" : "0 1px 4px rgba(0, 0, 0, 0.45)"};
  color: var(--fxr-ink);
  color-scheme: ${dark ? "dark" : "light"};
  --color-text-primary: var(--fxr-ink);
  --color-text-secondary: color-mix(in srgb, var(--fxr-ink) 75%, transparent);
  --color-text-emphatic: var(--fxr-ink);
  --color-text-subtle: color-mix(in srgb, var(--fxr-ink) 65%, transparent);
  --color-border: color-mix(in srgb, var(--fxr-ink) 30%, transparent);
}
.chat-message .message-header .message-sender {
  color: var(--fxr-sender);${fonts && theme.font ? `
  font-family: var(--fxr-font-display);
  font-weight: normal;` : `
  font-weight: bold;`}${dark ? `
  text-shadow: 0 0 6px color-mix(in srgb, var(--fxr-sender) 60%, transparent);` : ""}
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
  ${surface}
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

function directories({ theme, url, fonts }) {
  const border = url("dropdown_border");
  const clear = url("button_clear");
  return `.directory-header :is(.header-search input, input[type="search"]) {
  ${PAPER}
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
  ${clear
    ? `background-image: ${clear};
  background-size: 100% 100%;
  background-repeat: no-repeat;`
    : `background-image: linear-gradient(rgba(255, 255, 255, 0.14), rgba(0, 0, 0, 0.3));
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.15);`}
  color: #fff;
  text-shadow: 1px 2px 3px #000;
}
.directory-item.folder > .folder-header :is(h3, .folder-name, a, button, i) {
  color: inherit;
}${fonts && theme.font ? `
.directory-item.folder > .folder-header :is(.folder-name, h3) {
  font-family: var(--fxr-font-display);
}
:is(#settings, .settings-sidebar) :is(h2, h3, h4) {
  font-family: var(--fxr-font-display);
}` : ""}
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

function combat({ theme, url, fonts }) {
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
}${fonts && theme.font ? `
.combat-tracker-header :is(h3, .encounter-title) {
  font-family: var(--fxr-font-display);
}` : ""}`;
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

function navigation({ theme, url, fonts }) {
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
}${fonts && theme.font ? `
#scene-navigation .scene {
  font-family: var(--fxr-font-display);
}` : ""}${arrowRules("#scene-navigation-expand", url, [["up", "arrow_up"], ["down", "arrow_down"]])}`;
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
  ${SURFACE}
  border: 1px solid var(--fxr-edge);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
  color: var(--fxr-text);
  --color-text-primary: var(--fxr-text);
  ${CONTROL_VARS}
}`;
}

function windows({ theme, fonts }) {
  return `:is(.application, .app) > .window-header {
  ${SURFACE}
  border-bottom: 1px solid var(--fxr-edge);
  color: var(--fxr-text);
}
:is(.application, .app) > .window-header :is(.window-title, button, a, i) {
  color: var(--fxr-text);
}${fonts && theme.font ? `
:is(.application, .app) > .window-header .window-title {
  font-family: var(--fxr-font-display);
}` : ""}`;
}

const AREA_CSS = { tabs, panel, chat, directories, combat, controls, navigation, hotbar, players, windows };

/* -------------------------------------------- */
/*  Motion                                      */
/* -------------------------------------------- */

/**
 * Motion is driven by motion.mjs, which writes two custom properties once a second: --fxr-step (seconds since motion
 * started, looping) on #sidebar-content and --fxr-glow-level (0-1) on the active sidebar tab. These rules turn them into
 * positions and glow sizes. Both properties are registered as non-inherited, so changing them restyles those two
 * elements and not, say, a 500-message chat log inside the sidebar.
 *
 * Why not CSS animations: measured in Chromium, even steps() animations make the browser recalculate styles on every
 * frame (about 60 times a second) while one changing custom property costs one recalculation per step.
 */
const MOTION_PROPERTIES = `@property --fxr-step {
  syntax: "<integer>";
  inherits: false;
  initial-value: 0;
}
@property --fxr-glow-level {
  syntax: "<number>";
  inherits: false;
  initial-value: 0.5;
}
`;

/**
 * Each drifting layer's position at --fxr-step: drift (px/s) times the step. After DRIFT_LOOP_SECONDS every layer has
 * moved a whole number of tiles, so the loop has no visible jump.
 */
function driftPositions(layers) {
  return layers.map(l => (l.drift
    ? `calc(var(--fxr-step) * ${l.drift[0]}px) calc(var(--fxr-step) * ${l.drift[1]}px)`
    : "0 0")).join(", ");
}

function motion(context) {
  const { areas, art } = context;
  const parts = [];
  if ( areas.tabs ) {
    parts.push(`#sidebar-tabs .ui-control:is([aria-pressed="true"], .active) {
  filter: drop-shadow(0 0 calc(2px + var(--fxr-glow-level) * 7px) var(--fxr-glow))
    drop-shadow(0 0 calc(1px + var(--fxr-glow-level) * 2px) var(--fxr-glow));
}`);
  }
  const layers = art.main_panel ? [] : surfaceLayers(context, true);
  if ( areas.panel && layers.some(l => l.drift) ) {
    parts.push(`#sidebar-content {
  background-position: ${driftPositions(layers)};
}`);
  }
  if ( !parts.length ) return "";
  // Nothing moves for players who ask their system for less motion (motion.mjs doesn't start its timer either)
  return `@media (prefers-reduced-motion: no-preference) {\n${parts.join("\n")}\n}`;
}

/* -------------------------------------------- */
/*  Build                                       */
/* -------------------------------------------- */

/**
 * @param {object} options
 * @param {object} options.theme                       An entry of THEMES
 * @param {Record<string, {path: string, kind: string}>} [options.art]  From resolveArt
 * @param {Record<string, boolean>} [options.areas]    Which areas to style
 * @param {string} [options.size]                      "compact" or "large"
 * @param {string} [options.font]                      "small", "medium" or "large"
 * @param {boolean} [options.fonts]                    Use the theme's display font
 * @param {boolean} [options.motion]                   Ambient motion: rules that follow motion.mjs's custom properties
 * @param {{whisper?: string, blind?: string}} [options.labels]  Localized chat labels
 * @param {(path: string) => string} [options.route]   Adds the server's URL prefix to a relative path
 * @returns {string}
 */
export function buildStylesheet({ theme, art = {}, areas = DEFAULT_AREAS, size = "large", font = "medium", fonts = true,
  motion: moving = false, labels = {}, route = p => `/${p}` }) {
  const url = role => (art[role] ? cssUrl(art[role].path, route) : null);
  const context = { theme, art, url, size, font, fonts, labels, areas, route };
  const parts = [variables(context)];
  for ( const area of AREAS ) {
    if ( areas[area] ) parts.push(`/* ${area} */\n${AREA_CSS[area](context)}`);
  }
  if ( moving ) parts.push(`/* motion */\n${motion(context)}`);
  const globals = fontFace(context) + (moving ? MOTION_PROPERTIES : "");
  return `/* FlexUI Revived: ${theme.id} */\n${globals}@layer ${LAYER} {\n${parts.join("\n\n")}\n}\n`;
}
