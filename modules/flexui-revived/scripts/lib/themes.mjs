/**
 * The four FlexUI themes as data: a palette, the CSS texture used when there is no artwork, and the folder the
 * original FlexUI keeps its artwork in. No Foundry globals here.
 */

/**
 * A tileable noise texture as a CSS image. The SVG is rasterized once per tile size and cached by the browser, so it
 * costs about as much as a small PNG and needs no download.
 * @param {number} alpha       Strength of the darkening, 0-1
 * @param {string} frequency   feTurbulence baseFrequency; two numbers stretch the grain (wood, brushed metal)
 * @param {number} [octaves]
 * @returns {string}
 */
export function noise(alpha, frequency, octaves = 3) {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>"
    + `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='${octaves}' stitchTiles='stitch'/>`
    + `<feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${alpha} 0'/></filter>`
    + "<rect width='100%' height='100%' filter='url(#n)'/></svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Panel textures drawn with CSS, used when a theme has no main_panel image (or lightweight textures are on). */
export const TEXTURES = {
  wood: [
    noise(0.55, "0.012 0.4", 3),
    "linear-gradient(90deg, rgba(255,255,255,0.05), rgba(0,0,0,0.25) 50%, rgba(255,255,255,0.05))"
  ].join(", "),
  metal: [
    "repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 3px)",
    noise(0.25, "0.003 0.8", 2),
    "linear-gradient(160deg, rgba(255,255,255,0.12), rgba(0,0,0,0.3))"
  ].join(", "),
  stone: [
    noise(0.6, "0.05", 4),
    "radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.08), transparent 60%)"
  ].join(", "),
  plain: "linear-gradient(rgba(255,255,255,0.05), rgba(0,0,0,0.25))",
  parchment: [
    noise(0.22, "0.65", 3),
    "radial-gradient(ellipse at center, rgba(255,255,255,0.35), rgba(120,90,40,0.12) 90%)"
  ].join(", ")
};

/**
 * Palette tokens, each emitted as a --fxr-<token> custom property:
 * panel/panelAlt  dark surfaces (sidebar, controls) and their lighter shade
 * edge            borders on panels
 * accent/glow     active and hover highlight, and its translucent shadow
 * text/muted      text on panels
 * ink/sender      text on parchment, and the chat speaker's name
 * paper/paperEdge parchment surfaces (chat messages, inputs)
 * go/stop         primary (create) and danger (combat) buttons
 */
export const THEMES = {
  fantasy: {
    id: "fantasy",
    folder: "fantasy",
    texture: "wood",
    folderArt: "button_clear",
    tabShape: "square",
    palette: {
      panel: "#2b1a0e", panelAlt: "#4a2e18", edge: "#8c6a32", accent: "#e0b54a", glow: "rgba(224, 181, 74, 0.55)",
      text: "#f2e6c8", muted: "#c9b48a", ink: "#2b1a0e", sender: "#8b1a1a", paper: "#e9dcb8", paperEdge: "#b59b67",
      go: "#4f7d23", stop: "#8f2a1c"
    }
  },
  scifi: {
    id: "scifi",
    folder: "scifi",
    texture: "metal",
    folderArt: "button_fancy",
    tabShape: "hex",
    palette: {
      panel: "#1b252c", panelAlt: "#2c3a44", edge: "#6f8a99", accent: "#4fd2e8", glow: "rgba(79, 210, 232, 0.5)",
      text: "#e3f1f6", muted: "#9fb6c1", ink: "#12202a", sender: "#0c5e78", paper: "#d9dfe3", paperEdge: "#8fa0aa",
      go: "#2f8f6a", stop: "#a23a3a"
    },
    // The original's sci-fi panel image is light brushed steel: dark text on it, and a deeper accent
    panelArtPalette: {
      text: "#11181d", muted: "#3a4a55", accent: "#0b6f86", glow: "rgba(11, 111, 134, 0.45)"
    }
  },
  stone: {
    id: "stone",
    folder: "stone",
    texture: "stone",
    folderArt: "button_clear",
    tabShape: "square",
    palette: {
      panel: "#2f2e2b", panelAlt: "#4a4844", edge: "#8d877c", accent: "#d9c9a3", glow: "rgba(217, 201, 163, 0.45)",
      text: "#ece7dc", muted: "#b9b2a3", ink: "#2a241c", sender: "#6e1f12", paper: "#e6dcc0", paperEdge: "#a8987a",
      go: "#5a7a3a", stop: "#8e3b26"
    }
  },
  classic: {
    id: "classic",
    folder: "classic",
    texture: "plain",
    folderArt: "button_clear",
    tabShape: "square",
    palette: {
      panel: "#15110d", panelAlt: "#2a221b", edge: "#5a4630", accent: "#c99a3d", glow: "rgba(201, 154, 61, 0.5)",
      text: "#f0e4c8", muted: "#bfae8b", ink: "#2d1d10", sender: "#7a1010", paper: "#ece0bd", paperEdge: "#a68b5b",
      go: "#5d8a1f", stop: "#a3301d"
    }
  }
};

export const THEME_IDS = Object.keys(THEMES);
