/**
 * Which theme and sizes a client ends up with: the player's own choice, the GM's table default, and choices carried
 * over from the original FlexUI. No Foundry globals here.
 */

export const SIZES = ["compact", "large"];
export const FONT_SIZES = ["small", "medium", "large"];

/**
 * @param {object} options
 * @param {string} options.choice        The player's setting: "default", "off" or a theme id
 * @param {string} options.tableDefault  The GM's setting: "off" or a theme id
 * @param {string[]} options.themeIds
 * @returns {string|null} The theme to draw, or null for Foundry's own look
 */
export function resolveTheme({ choice, tableDefault, themeIds }) {
  const id = (choice === "default") ? tableDefault : choice;
  return themeIds.includes(id) ? id : null;
}

const LEGACY_THEMES = { f: "fantasy", s: "scifi", st: "stone", c: "classic" };
const LEGACY_FONTS = { s: "small", m: "medium", l: "large" };

/**
 * Read the choices a player made in the original FlexUI, which stored them as client settings in this browser's
 * localStorage ("flexui.theme" = "\"st\"", and so on). Only keys the player actually set exist there, so an untouched
 * original leaves every value undefined and the new defaults apply. Nothing is written or removed.
 * @param {(key: string) => string|null} getItem   localStorage.getItem
 * @returns {{theme?: string, size?: string, font?: string}}
 */
export function legacyChoices(getItem) {
  const read = key => {
    try {
      const raw = getItem(`flexui.${key}`);
      return (raw === null) || (raw === undefined) ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const out = {};
  if ( read("disableStyles") === true ) out.theme = "off";
  else if ( LEGACY_THEMES[read("theme")] ) out.theme = LEGACY_THEMES[read("theme")];
  const small = read("smallUI");
  if ( typeof small === "boolean" ) out.size = small ? "compact" : "large";
  if ( LEGACY_FONTS[read("fontSize")] ) out.font = LEGACY_FONTS[read("fontSize")];
  return out;
}
