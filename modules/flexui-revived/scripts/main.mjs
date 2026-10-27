/**
 * FlexUI Revived entry point.
 *
 * The whole theme is one generated <style> element. It is written once when translations are ready (before any of
 * the interface renders) and rewritten in place whenever a setting changes, so nothing here needs a reload and no
 * hook listens while the game is running. The two settings windows are loaded with import() when opened.
 *
 * Other modules can match the theme without depending on this one: every color is a --fxr-* custom property, and
 * game.modules.get("flexui-revived")?.api.theme plus the "flexuiRevived.themeChanged" hook describe the current one.
 */
import { MODULE_ID, ORIGINAL_ID, STYLE_ID } from "./constants.mjs";
import { FONTS, THEMES, THEME_IDS } from "./lib/themes.mjs";
import { ART_SOURCES, resolveArt } from "./lib/art.mjs";
import { DEFAULT_AREAS, LAYER, buildStylesheet, normalizeAreas } from "./lib/stylesheet.mjs";
import { FONT_SIZES, SIZES, legacyChoices, resolveTheme } from "./lib/choice.mjs";

const state = {
  /** What api.theme returns, and the last value announced through the hook, as JSON for comparison. */
  info: null,
  announced: "null",
  originalActive: false,
  /** motion.mjs once loaded, and the glow style motion should run with (null: stopped). */
  motion: null,
  motionStyle: null
};

const setting = key => game.settings.get(MODULE_ID, key);

/* -------------------------------------------- */
/*  Applying the theme                          */
/* -------------------------------------------- */

/**
 * The current theme as plain data for other modules, or null when Foundry's own look is showing.
 * @returns {{id: string, palette: Record<string, string>, font: string|null, motion: boolean, layer: string}|null}
 */
function describe(themeId, { fonts, motion }) {
  if ( !themeId ) return null;
  const theme = THEMES[themeId];
  return {
    id: themeId,
    palette: { ...theme.palette },
    font: (fonts && FONTS[theme.font]?.family) || null,
    motion,
    layer: LAYER
  };
}

/** Write (or remove) the theme stylesheet for the current settings. Safe to call at any time after init. */
export function apply() {
  const themeId = resolveTheme({ choice: setting("theme"), tableDefault: setting("defaultTheme"), themeIds: THEME_IDS });
  const fonts = setting("fonts");
  const motion = setting("motion");
  const areas = normalizeAreas(setting("areas"));
  const body = document.body;
  body?.classList.toggle("flexui-revived", Boolean(themeId));
  for ( const id of THEME_IDS ) body?.classList.toggle(`flexui-revived-${id}`, id === themeId);

  let style = document.getElementById(STYLE_ID);
  if ( !themeId ) style?.remove();
  else {
    const theme = THEMES[themeId];
    const art = resolveArt({
      theme,
      source: setting("artwork"),
      custom: setting("customArt")?.files ?? {},
      lightweight: setting("lightweight")
    });
    const css = buildStylesheet({
      theme,
      art,
      areas,
      size: setting("size"),
      font: setting("font"),
      fonts,
      motion,
      labels: { whisper: game.i18n.localize("FLEXUI.Chat.Whisper"), blind: game.i18n.localize("FLEXUI.Chat.Blind") },
      route: path => foundry.utils.getRoute(path)
    });
    if ( !style ) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.append(style);
    }
    if ( style.textContent !== css ) style.textContent = css;
  }

  syncMotion(themeId && motion && (areas.tabs || areas.panel) ? THEMES[themeId].glow : null);

  state.info = describe(themeId, { fonts, motion });
  const json = JSON.stringify(state.info);
  if ( json !== state.announced ) {
    state.announced = json;
    Hooks.callAll("flexuiRevived.themeChanged", state.info);
  }
}

/**
 * Start or stop ambient motion. Its timer lives in motion.mjs, fetched the first time a player turns motion on; the
 * latest wish wins even if settings change again while it loads.
 * @param {string|null} style   The theme's glow style, or null to stop
 */
function syncMotion(style) {
  state.motionStyle = style;
  if ( !style && !state.motion ) return;
  const loaded = state.motion ? Promise.resolve(state.motion) : import("./motion.mjs").then(m => (state.motion = m));
  loaded.then(m => (state.motionStyle ? m.start(state.motionStyle) : m.stop()));
}

/* -------------------------------------------- */
/*  Lazy UI                                     */
/* -------------------------------------------- */

async function openAreas() {
  const { AreasApp } = await import("./apps/areas-app.mjs");
  return AreasApp.open();
}

async function openCustomArt() {
  const { CustomArtApp } = await import("./apps/custom-art-app.mjs");
  return CustomArtApp.open();
}

/** Settings menus need a class at registration time; these stand-ins load the real window on demand. */
const { ApplicationV2 } = foundry.applications.api;

class AreasLauncher extends ApplicationV2 {
  render() {
    openAreas();
    return this;
  }
}

class CustomArtLauncher extends ApplicationV2 {
  render() {
    openCustomArt();
    return this;
  }
}

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

function registerSettings() {
  // Choices a player made in the original FlexUI on this browser become the starting values here
  const legacy = legacyChoices(key => globalThis.localStorage?.getItem(key) ?? null);
  const themeNames = Object.fromEntries(THEME_IDS.map(id => [id, `FLEXUI.Theme.${id}`]));
  const onChange = () => apply();

  game.settings.register(MODULE_ID, "theme", {
    name: "FLEXUI.Settings.Theme.Name",
    hint: "FLEXUI.Settings.Theme.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: { default: "FLEXUI.Settings.Theme.Default", ...themeNames, off: "FLEXUI.Settings.Theme.Off" },
    default: legacy.theme ?? "default",
    onChange
  });
  game.settings.register(MODULE_ID, "size", {
    name: "FLEXUI.Settings.Size.Name",
    hint: "FLEXUI.Settings.Size.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: Object.fromEntries(SIZES.map(s => [s, `FLEXUI.Settings.Size.${s}`])),
    default: legacy.size ?? "large",
    onChange
  });
  game.settings.register(MODULE_ID, "font", {
    name: "FLEXUI.Settings.Font.Name",
    hint: "FLEXUI.Settings.Font.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: Object.fromEntries(FONT_SIZES.map(s => [s, `FLEXUI.Settings.Font.${s}`])),
    default: legacy.font ?? "medium",
    onChange
  });
  game.settings.register(MODULE_ID, "fonts", {
    name: "FLEXUI.Settings.Fonts.Name",
    hint: "FLEXUI.Settings.Fonts.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange
  });
  game.settings.register(MODULE_ID, "motion", {
    name: "FLEXUI.Settings.Motion.Name",
    hint: "FLEXUI.Settings.Motion.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange
  });
  game.settings.register(MODULE_ID, "lightweight", {
    name: "FLEXUI.Settings.Lightweight.Name",
    hint: "FLEXUI.Settings.Lightweight.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange
  });
  game.settings.register(MODULE_ID, "areas", {
    scope: "client",
    config: false,
    type: Object,
    default: { ...DEFAULT_AREAS },
    onChange
  });
  game.settings.registerMenu(MODULE_ID, "areasMenu", {
    name: "FLEXUI.Settings.Areas.Name",
    label: "FLEXUI.Settings.Areas.Label",
    hint: "FLEXUI.Settings.Areas.Hint",
    icon: "fa-solid fa-table-cells-large",
    type: AreasLauncher,
    restricted: false
  });

  game.settings.register(MODULE_ID, "defaultTheme", {
    name: "FLEXUI.Settings.DefaultTheme.Name",
    hint: "FLEXUI.Settings.DefaultTheme.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: { ...themeNames, off: "FLEXUI.Settings.Theme.Off" },
    default: "fantasy",
    onChange
  });
  // A new key rather than 0.1's "artSource", whose "auto" and "original" choices no longer exist
  game.settings.register(MODULE_ID, "artwork", {
    name: "FLEXUI.Settings.Artwork.Name",
    hint: "FLEXUI.Settings.Artwork.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(ART_SOURCES.map(s => [s, `FLEXUI.Settings.Artwork.${s}`])),
    default: "bundled",
    onChange
  });
  game.settings.register(MODULE_ID, "customArt", {
    scope: "world",
    config: false,
    type: Object,
    default: { folder: "", files: {} },
    onChange
  });
  game.settings.registerMenu(MODULE_ID, "customArtMenu", {
    name: "FLEXUI.Settings.CustomArt.Name",
    label: "FLEXUI.Settings.CustomArt.Label",
    hint: "FLEXUI.Settings.CustomArt.Hint",
    icon: "fa-solid fa-folder-open",
    type: CustomArtLauncher,
    restricted: true
  });
}

/* -------------------------------------------- */
/*  The original FlexUI                         */
/* -------------------------------------------- */

/**
 * The original FlexUI adds <link> elements for its Foundry v11 stylesheets during init. On v13 they break the whole
 * interface (its author says so in issue #20), so if it is still active they are taken out again here, after every
 * module's init has run and before anything renders.
 */
function disableOriginalStylesheets() {
  if ( !game.modules.get(ORIGINAL_ID)?.active ) return;
  state.originalActive = true;
  for ( const link of document.querySelectorAll("link[href*=\"modules/flexui/css/\"]") ) link.remove();
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = {
    apply,
    openAreas,
    openCustomArt,
    /** The current theme (id, palette, display font, motion, cascade layer), or null when it is off. */
    get theme() {
      return state.info;
    }
  };
});

// Translations are needed for the chat labels; this still runs before the interface first renders
Hooks.once("i18nInit", () => apply());
Hooks.once("setup", disableOriginalStylesheets);
Hooks.once("ready", () => {
  // Again in case core rewrote the body's classes while building the interface; the stylesheet text is unchanged,
  // so the browser has nothing to recalculate
  apply();
  if ( game.user?.isGM && state.originalActive ) {
    ui.notifications.warn(game.i18n.localize("FLEXUI.Notify.OriginalActive"), { permanent: true });
  }
});
