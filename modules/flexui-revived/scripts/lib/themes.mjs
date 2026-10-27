/**
 * The themes as data: palette, bundled textures and icons, display font, particles and how the glow moves. Every
 * image, icon and font named here ships in assets/ under a free license (see CREDITS.md). No Foundry globals here.
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

/**
 * Textures drawn with CSS, as background layers of [image, size]: the fallback when images are off (Artwork: None,
 * or lightweight textures), and the neon theme's chat surface.
 */
export const CSS_TEXTURES = {
  wood: [
    [noise(0.55, "0.012 0.4", 3), "auto"],
    ["linear-gradient(90deg, rgba(255,255,255,0.05), rgba(0,0,0,0.25) 50%, rgba(255,255,255,0.05))", "auto"]
  ],
  metal: [
    ["repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 3px)", "auto"],
    [noise(0.25, "0.003 0.8", 2), "auto"],
    ["linear-gradient(160deg, rgba(255,255,255,0.12), rgba(0,0,0,0.3))", "auto"]
  ],
  stone: [
    [noise(0.6, "0.05", 4), "auto"],
    ["radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.08), transparent 60%)", "auto"]
  ],
  plain: [["linear-gradient(rgba(255,255,255,0.05), rgba(0,0,0,0.25))", "auto"]],
  grid: [
    ["repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px)", "auto"],
    ["linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)", "24px 24px"],
    ["linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)", "24px 24px"]
  ],
  parchment: [
    [noise(0.22, "0.65", 3), "auto"],
    ["radial-gradient(ellipse at center, rgba(255,255,255,0.35), rgba(120,90,40,0.12) 90%)", "auto"]
  ],
  scanlines: [["repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 3px)", "auto"]]
};

/** Display fonts in assets/fonts, used for names and headings only, never body text. */
export const FONTS = {
  cinzel: { family: "Cinzel", file: "cinzel.woff2", generic: "serif" },
  orbitron: { family: "Orbitron", file: "orbitron.woff2", generic: "sans-serif" },
  "pirata-one": { family: "Pirata One", file: "pirata-one.woff2", generic: "serif" },
  "special-elite": { family: "Special Elite", file: "special-elite.woff2", generic: "monospace" },
  "share-tech-mono": { family: "Share Tech Mono", file: "share-tech-mono.woff2", generic: "monospace" },
  metamorphous: { family: "Metamorphous", file: "metamorphous.woff2", generic: "serif" },
  "uncial-antiqua": { family: "Uncial Antiqua", file: "uncial-antiqua.woff2", generic: "serif" }
};

/** Bundled tab icons (assets/icons/<name>.svg) shared by themes that don't pick their own. */
export const DEFAULT_ICONS = {
  chat: "conversation",
  combat: "crossed-swords",
  scenes: "treasure-map",
  actors: "cowled",
  items: "swap-bag",
  journal: "scroll-unfurled",
  tables: "rolling-dices",
  cards: "card-random",
  macros: "magic-swirl",
  playlists: "lyre",
  compendium: "bookshelf",
  settings: "cog"
};

/** A small deterministic random generator, so a theme's particles land in the same places every time. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Particle tiles are square; with this size and the power-of-two speeds below every layer loops seamlessly. */
export const PARTICLE_TILE = 256;

/**
 * How each kind of particle looks and which way it drifts when motion is on, in pixels per second.
 */
export const PARTICLE_KINDS = {
  embers: { count: 14, size: [1.2, 3.2], alpha: [0.45, 0.95], dx: 0.25, dy: -2 },
  snow: { count: 22, size: [0.8, 2.6], alpha: [0.35, 0.85], dx: 0.25, dy: 1 },
  fireflies: { count: 8, size: [1.5, 3], alpha: [0.5, 0.95], dx: 0.5, dy: -0.5 },
  spores: { count: 12, size: [0.8, 2.2], alpha: [0.25, 0.6], dx: -0.25, dy: -0.5 },
  motes: { count: 10, size: [0.6, 1.6], alpha: [0.2, 0.45], dx: 0.25, dy: -0.25 },
  stars: { count: 18, size: [0.5, 1.4], alpha: [0.3, 0.8], dx: 0, dy: 0.5 }
};

/**
 * A tile of soft glowing dots as a CSS image.
 * @param {string} kind    A key of PARTICLE_KINDS
 * @param {string} color   Any SVG color
 * @param {number} [seed]
 * @returns {string|null}
 */
export function particles(kind, color, seed = 7) {
  const spec = PARTICLE_KINDS[kind];
  if ( !spec ) return null;
  const rand = seeded(seed);
  const w = PARTICLE_TILE;
  const h = PARTICLE_TILE;
  const between = ([lo, hi]) => lo + ((hi - lo) * rand());
  let dots = "";
  for ( let i = 0; i < spec.count; i++ ) {
    const r = between(spec.size).toFixed(2);
    dots += `<circle cx='${(rand() * w).toFixed(1)}' cy='${(rand() * h).toFixed(1)}' r='${(r * 2.5).toFixed(2)}' `
      + `fill='url(#g)' opacity='${between(spec.alpha).toFixed(2)}'/>`;
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><defs><radialGradient id='g'>`
    + `<stop offset='0' stop-color='${color}'/><stop offset='0.4' stop-color='${color}' stop-opacity='0.6'/>`
    + `<stop offset='1' stop-color='${color}' stop-opacity='0'/></radialGradient></defs>${dots}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Palette tokens, each emitted as a --fxr-<token> custom property:
 * panel/panelAlt  dark surfaces (sidebar, controls) and their lighter shade
 * edge            borders on panels
 * accent/glow     active and hover highlight, and its translucent glow
 * text/muted      text on panels
 * ink/sender      text on the chat "paper", and the chat speaker's name
 * paper/paperEdge chat message and input surfaces
 * go/stop         primary (create) and danger (combat) buttons
 *
 * panel:  bundled texture under a shade (0-1 darkness) and optional tint blended over it
 * paper:  bundled texture multiplied by a tint; scheme is the color scheme of text on it
 * css:    key of CSS_TEXTURES used when images are off
 * glow:   "breathe" (slow swell), "flicker" (candle) or "pulse" (sharper), only with motion on
 */
export const THEMES = {
  fantasy: {
    id: "fantasy",
    palette: {
      panel: "#2b1a0e", panelAlt: "#4a2e18", edge: "#8c6a32", accent: "#e0b54a", glow: "rgba(224, 181, 74, 0.55)",
      text: "#f2e6c8", muted: "#c9b48a", ink: "#2b1a0e", sender: "#8b1a1a", paper: "#e9dcb8", paperEdge: "#b59b67",
      go: "#4f7d23", stop: "#8f2a1c"
    },
    panel: { texture: "wood", shade: 0.5 },
    paper: { texture: "paper-white", tint: "#f0e0b6", scheme: "light" },
    css: "wood",
    icons: {},
    font: "cinzel",
    particles: { kind: "motes", color: "#ffe2a0" },
    glow: "breathe"
  },
  scifi: {
    id: "scifi",
    palette: {
      panel: "#1b252c", panelAlt: "#2c3a44", edge: "#6f8a99", accent: "#4fd2e8", glow: "rgba(79, 210, 232, 0.5)",
      text: "#e3f1f6", muted: "#9fb6c1", ink: "#12202a", sender: "#0c5e78", paper: "#d9dfe3", paperEdge: "#8fa0aa",
      go: "#2f8f6a", stop: "#a23a3a"
    },
    panel: { texture: "steel", shade: 0.72, tint: "#12303c" },
    paper: { texture: "paper-gray", tint: "#e4edf2", scheme: "light" },
    css: "metal",
    icons: {
      chat: "radio-tower", combat: "ray-gun", scenes: "planet-core", actors: "astronaut-helmet", items: "cargo-crate",
      journal: "tablet", tables: "perspective-dice-six", cards: "card-pick", macros: "processor",
      playlists: "sound-waves", compendium: "database", settings: "settings-knobs"
    },
    font: "orbitron",
    particles: { kind: "stars", color: "#9eeaff" },
    glow: "pulse"
  },
  stone: {
    id: "stone",
    palette: {
      panel: "#2f2e2b", panelAlt: "#4a4844", edge: "#8d877c", accent: "#d9c9a3", glow: "rgba(217, 201, 163, 0.45)",
      text: "#ece7dc", muted: "#b9b2a3", ink: "#2a241c", sender: "#6e1f12", paper: "#e6dcc0", paperEdge: "#a8987a",
      go: "#5a7a3a", stop: "#8e3b26"
    },
    panel: { texture: "slate", shade: 0.4 },
    paper: { texture: "paper-white", tint: "#e8dfc6", scheme: "light" },
    css: "stone",
    icons: { combat: "battle-axe", actors: "visored-helm", items: "chest", scenes: "mountains", compendium: "book-cover" },
    font: "cinzel",
    glow: "breathe"
  },
  classic: {
    id: "classic",
    palette: {
      panel: "#15110d", panelAlt: "#2a221b", edge: "#5a4630", accent: "#c99a3d", glow: "rgba(201, 154, 61, 0.5)",
      text: "#f0e4c8", muted: "#bfae8b", ink: "#2d1d10", sender: "#7a1010", paper: "#ece0bd", paperEdge: "#a68b5b",
      go: "#5d8a1f", stop: "#a3301d"
    },
    panel: { texture: "leather", shade: 0.2 },
    paper: { texture: "paper-white", tint: "#efdfb8", scheme: "light" },
    css: "plain",
    icons: {},
    font: "cinzel",
    glow: "breathe"
  },
  gothic: {
    id: "gothic",
    palette: {
      panel: "#1c0a0d", panelAlt: "#3a1218", edge: "#6e2a2f", accent: "#e8b04a", glow: "rgba(255, 170, 70, 0.5)",
      text: "#f1e2d0", muted: "#c0a090", ink: "#2a1414", sender: "#7a0f1a", paper: "#e8dccb", paperEdge: "#9c7f6c",
      go: "#5a3a6e", stop: "#8a1520"
    },
    panel: { texture: "velvet", shade: 0.68 },
    paper: { texture: "paper-white", tint: "#eadccb", scheme: "light" },
    css: "plain",
    icons: {
      combat: "stake-hammer", scenes: "castle", actors: "vampire-cape", items: "coffin", journal: "tied-scroll",
      cards: "tarot-13-death", macros: "candle-holder", playlists: "violin", compendium: "evil-book"
    },
    font: "pirata-one",
    glow: "flicker"
  },
  cosmic: {
    id: "cosmic",
    palette: {
      panel: "#101a17", panelAlt: "#1d2e28", edge: "#3f6b5a", accent: "#86e0b0", glow: "rgba(110, 230, 170, 0.45)",
      text: "#dfeee4", muted: "#9ab8a6", ink: "#2b2617", sender: "#2f5d3a", paper: "#d8cfae", paperEdge: "#8f8463",
      go: "#3d6b4f", stop: "#6b2a3a"
    },
    panel: { texture: "rock", shade: 0.45, tint: "#0f3a2c" },
    paper: { texture: "paper-gray", tint: "#e0d3a8", scheme: "light" },
    css: "stone",
    icons: {
      combat: "tentacle-strike", scenes: "lighthouse", actors: "cultist", items: "lantern", journal: "newspaper",
      cards: "tarot-18-the-moon", macros: "third-eye", compendium: "book-aura", settings: "pocket-watch"
    },
    font: "special-elite",
    particles: { kind: "spores", color: "#9dffcf" },
    glow: "breathe"
  },
  neon: {
    id: "neon",
    palette: {
      panel: "#0b0d18", panelAlt: "#171a30", edge: "#5a2f7a", accent: "#ff3ec8", glow: "rgba(255, 62, 200, 0.55)",
      text: "#e9f6ff", muted: "#9aa9c8", ink: "#d8f6ff", sender: "#3ee8ff", paper: "#0e1122", paperEdge: "#2fd4ff",
      go: "#1f8fa8", stop: "#b0205c"
    },
    panel: { texture: "plate", shade: 0.78, tint: "#1a0b2e" },
    paper: { texture: null, tint: null, scheme: "dark" },
    paperCss: "scanlines",
    css: "grid",
    icons: {
      chat: "smartphone", combat: "pistol-gun", scenes: "modern-city", actors: "cyborg-face", items: "backpack",
      journal: "tablet", tables: "perspective-dice-six", cards: "id-card", macros: "circuitry", playlists: "headphones",
      compendium: "server-rack", settings: "settings-knobs"
    },
    iconFill: "flat",
    font: "share-tech-mono",
    glow: "pulse"
  },
  infernal: {
    id: "infernal",
    palette: {
      panel: "#1a0905", panelAlt: "#35130a", edge: "#8a3414", accent: "#ff8a3a", glow: "rgba(255, 110, 40, 0.55)",
      text: "#ffe6d0", muted: "#d0a080", ink: "#2b1208", sender: "#8a1c06", paper: "#dcb88e", paperEdge: "#8a5a34",
      go: "#7a4a12", stop: "#b0280c"
    },
    panel: { texture: "lava", shade: 0.55 },
    paper: { texture: "paper-white", tint: "#e6c49a", scheme: "light" },
    css: "stone",
    icons: {
      combat: "trident", scenes: "volcano", actors: "horned-skull", items: "locked-chest", journal: "burning-book",
      cards: "tarot-15-the-devil", macros: "fire-ring", playlists: "drum", compendium: "evil-book"
    },
    font: "metamorphous",
    particles: { kind: "embers", color: "#ffae5a" },
    glow: "flicker"
  },
  frost: {
    id: "frost",
    palette: {
      panel: "#0d1b26", panelAlt: "#17303f", edge: "#6d9cb8", accent: "#aee8ff", glow: "rgba(170, 230, 255, 0.5)",
      text: "#eef8ff", muted: "#a8c4d6", ink: "#14293a", sender: "#1d5a85", paper: "#e3eef4", paperEdge: "#8fb0c4",
      go: "#2f6f8f", stop: "#7a2f4a"
    },
    panel: { texture: "ice", shade: 0.55, tint: "#0c2a40" },
    paper: { texture: "paper-white", tint: "#e8f3f9", scheme: "light" },
    css: "stone",
    icons: { combat: "ice-spear", scenes: "mountains", actors: "hood", items: "knapsack", macros: "snowflake-1", playlists: "harp" },
    font: "cinzel",
    particles: { kind: "snow", color: "#ffffff" },
    glow: "breathe"
  },
  fey: {
    id: "fey",
    palette: {
      panel: "#0f1a0c", panelAlt: "#1f3318", edge: "#6b8a3a", accent: "#d4f27a", glow: "rgba(212, 242, 122, 0.5)",
      text: "#f0f7dc", muted: "#b4c79a", ink: "#233018", sender: "#3d6b1f", paper: "#eef0c8", paperEdge: "#a3a86e",
      go: "#4f7a2a", stop: "#8a3a4a"
    },
    panel: { texture: "moss", shade: 0.6 },
    paper: { texture: "paper-white", tint: "#eef0c8", scheme: "light" },
    css: "stone",
    icons: {
      combat: "bow-arrow", scenes: "forest", actors: "fairy", items: "acorn", cards: "tarot-17-the-star",
      macros: "fairy-wand", playlists: "pan-flute", compendium: "spell-book"
    },
    font: "uncial-antiqua",
    particles: { kind: "fireflies", color: "#f4ff9a" },
    glow: "breathe"
  }
};

export const THEME_IDS = Object.keys(THEMES);

/** A theme's icon for a sidebar tab. */
export function iconFor(theme, tab) {
  return theme.icons[tab] ?? DEFAULT_ICONS[tab];
}
