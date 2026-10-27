import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AREAS, DEFAULT_AREAS, DRIFT_LOOP_SECONDS, LAYER, buildStylesheet, cssString, normalizeAreas
} from "../modules/flexui-revived/scripts/lib/stylesheet.mjs";
import {
  PARTICLE_KINDS, PARTICLE_TILE, THEMES, THEME_IDS, noise, particles
} from "../modules/flexui-revived/scripts/lib/themes.mjs";
import { resolveArt } from "../modules/flexui-revived/scripts/lib/art.mjs";

const bundled = id => resolveArt({ theme: THEMES[id], source: "bundled" });
const ALL = normalizeAreas({ windows: true });

/** Strip comments and strings so brace counting only sees CSS structure. */
function structure(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"/g, "\"\"");
}

test("every theme defines the same palette tokens and the parts the builder needs", () => {
  const tokens = Object.keys(THEMES.fantasy.palette).sort();
  for ( const id of THEME_IDS ) {
    const theme = THEMES[id];
    assert.equal(theme.id, id);
    assert.deepEqual(Object.keys(theme.palette).sort(), tokens, id);
    assert.ok(theme.panel && ("shade" in theme.panel), `${id} panel`);
    assert.ok(theme.paper && ["light", "dark"].includes(theme.paper.scheme), `${id} paper`);
    assert.ok(["breathe", "pulse", "flicker"].includes(theme.glow), `${id} glow`);
  }
});

test("every theme builds balanced CSS in its own sub-layer of modules, in every combination", () => {
  for ( const id of THEME_IDS ) {
    for ( const art of [{}, bundled(id)] ) {
      for ( const motion of [false, true] ) {
        const css = buildStylesheet({ theme: THEMES[id], art, areas: ALL, motion });
        assert.ok(css.includes(`@layer ${LAYER} {`), id);
        assert.equal(LAYER, "modules.flexui-revived");
        const s = structure(css);
        assert.equal((s.match(/\{/g) ?? []).length, (s.match(/\}/g) ?? []).length, `${id} braces`);
        assert.doesNotMatch(css, /undefined|NaN|null|\[object/, id);
      }
    }
  }
});

test("the stylesheet never sets layout on the sidebar itself", () => {
  for ( const id of THEME_IDS ) {
    const css = buildStylesheet({ theme: THEMES[id], art: bundled(id), areas: ALL, motion: true });
    for ( const block of css.matchAll(/(^|\n)#sidebar(?:\s*,[^{]*)?\s*\{([^}]*)\}/g) ) {
      assert.doesNotMatch(block[2], /\b(position|width|height|display)\s*:/);
    }
    assert.doesNotMatch(css, /position\s*:\s*fixed/);
    assert.doesNotMatch(css, /!important/, "nothing forces its way past other modules");
  }
});

test("areas switch their rules on and off", () => {
  const theme = THEMES.stone;
  const all = buildStylesheet({ theme, art: bundled("stone"), areas: ALL });
  const markers = {
    tabs: "#sidebar-tabs .ui-control", panel: "#sidebar-content {", chat: ".chat-message {",
    directories: ".directory-item.folder > .folder-header", combat: ".combat-controls", controls: "#scene-controls .ui-control",
    navigation: "#scene-navigation", hotbar: "#hotbar .slot", players: "#players {", windows: "> .window-header"
  };
  assert.deepEqual(Object.keys(markers).sort(), [...AREAS].sort());
  for ( const [area, marker] of Object.entries(markers) ) {
    assert.ok(all.includes(marker), `${area} present when on`);
    const without = buildStylesheet({ theme, art: bundled("stone"), areas: normalizeAreas({ windows: true, [area]: false }) });
    assert.ok(!without.includes(marker), `${area} absent when off`);
  }
});

test("window title bars are off by default; normalizeAreas fills gaps and ignores junk", () => {
  assert.equal(DEFAULT_AREAS.windows, false);
  assert.equal(DEFAULT_AREAS.chat, true);
  assert.deepEqual(normalizeAreas(undefined), { ...DEFAULT_AREAS });
  const n = normalizeAreas({ chat: false, hotbar: "no", bogus: true });
  assert.equal(n.chat, false);
  assert.equal(n.hotbar, true);
  assert.equal("bogus" in n, false);
});

test("bundled tab icons are tinted masks loaded through the route", () => {
  const css = buildStylesheet({ theme: THEMES.fantasy, art: bundled("fantasy"), route: p => `/vtt/${p}` });
  const icon = "url(\"/vtt/modules/flexui-revived/assets/icons/conversation.svg\")";
  assert.ok(css.includes(`#sidebar-tabs [data-tab="chat"]::before { -webkit-mask-image: ${icon}; mask-image: ${icon}; }`));
  assert.ok(css.includes("background: var(--fxr-icon-fill);"));
  assert.ok(css.includes("url(\"/vtt/modules/flexui-revived/assets/textures/wood.webp\")"));
  assert.doesNotMatch(css, /url\("\/modules/, "no hard-coded root paths");
});

test("custom pictures are drawn in full color and a custom frame replaces the panel texture", () => {
  const art = resolveArt({ theme: THEMES.fantasy, source: "custom",
    custom: { icon_chat: "worlds/w/chat.png", main_panel: "worlds/w/frame.webp", arrow_left: "worlds/w/left.webp" } });
  const css = buildStylesheet({ theme: THEMES.fantasy, art });
  assert.ok(css.includes("#sidebar-tabs [data-tab=\"chat\"]::before { background-image: url(\"/worlds/w/chat.png\"); }"));
  assert.ok(css.includes("border-image: url(\"/worlds/w/frame.webp\") 20 fill / 10px stretch;"));
  assert.ok(css.includes(".fa-caret-left"), "custom arrows replace the collapse caret");
  assert.ok(css.includes("mask-image: url(\"/modules/flexui-revived/assets/icons/crossed-swords.svg\")"), "others stay bundled");
});

test("without images nothing is fetched except fonts", () => {
  for ( const id of THEME_IDS ) {
    const css = buildStylesheet({ theme: THEMES[id], areas: ALL, motion: true });
    const urls = [...css.matchAll(/url\("([^"]*)"\)/g)].map(m => m[1]).filter(u => !u.startsWith("data:image/svg+xml,"));
    assert.deepEqual(urls.filter(u => !u.endsWith(".woff2")), [], id);
    assert.ok(!css.includes("mask-image"), `${id}: Font Awesome icons stay`);
  }
});

test("display fonts are declared once, outside the layer, and only when wanted", () => {
  const on = buildStylesheet({ theme: THEMES.gothic, art: bundled("gothic") });
  assert.match(on, /^\/\* FlexUI Revived: gothic \*\/\n@font-face \{\n  font-family: "FXR Pirata One";/);
  assert.equal(on.match(/@font-face/g).length, 1);
  assert.ok(on.includes("--fxr-font-display: \"FXR Pirata One\", serif;"));
  assert.ok(on.includes("font-family: var(--fxr-font-display);"));
  const off = buildStylesheet({ theme: THEMES.gothic, art: bundled("gothic"), fonts: false });
  assert.ok(!off.includes("@font-face"));
  assert.ok(!off.includes("font-family: var(--fxr-font-display)"));
});

test("motion is opt-in, never a CSS animation, and off for reduced-motion users", () => {
  for ( const id of THEME_IDS ) {
    const still = buildStylesheet({ theme: THEMES[id], art: bundled(id) });
    assert.doesNotMatch(still, /--fxr-step|--fxr-glow-level|@property/, `${id} still by default`);
    const moving = buildStylesheet({ theme: THEMES[id], art: bundled(id), motion: true });
    // CSS animations, even stepped ones, make Chromium restyle on every frame; motion.mjs steps once a second
    assert.doesNotMatch(moving, /animation|@keyframes|transition/, id);
    assert.ok(moving.includes("@media (prefers-reduced-motion: no-preference) {"), id);
    const [globals] = moving.split(`@layer ${LAYER}`);
    assert.match(globals, /@property --fxr-step \{\n  syntax: "<integer>";\n  inherits: false;/, `${id}: registered outside the layer`);
    assert.match(globals, /@property --fxr-glow-level \{\n  syntax: "<number>";\n  inherits: false;/);
    assert.ok(moving.includes("var(--fxr-glow-level)"), id);
  }
});

test("drifting layers return exactly to where they started", () => {
  const moving = buildStylesheet({ theme: THEMES.infernal, art: bundled("infernal"), motion: true });
  const block = /#sidebar-content \{\n  background-position: ([^;]+);/.exec(moving.slice(moving.indexOf("@media (prefers-reduced")))[1];
  const positions = block.split(/, (?=calc|0 0)/);
  // Particles first (256 px tiles), then vignette and shade (still), then the 512 px texture
  const tiles = [PARTICLE_TILE, null, null, 512];
  assert.equal(positions.length, tiles.length);
  positions.forEach((pos, i) => {
    if ( !tiles[i] ) return assert.equal(pos, "0 0");
    const speeds = [...pos.matchAll(/\* (-?[\d.]+)px/g)].map(m => Number(m[1]));
    assert.equal(speeds.length, 2, pos);
    for ( const v of speeds ) assert.equal(Math.abs((v * DRIFT_LOOP_SECONDS) % tiles[i]), 0, `layer ${i} speed ${v}`);
  });
  assert.ok(moving.includes("calc(var(--fxr-step) * -2px)"), "embers rise");
  for ( const kind of Object.values(PARTICLE_KINDS) ) {
    for ( const v of [kind.dx, kind.dy] ) assert.equal(Math.abs((v * DRIFT_LOOP_SECONDS) % PARTICLE_TILE), 0, `speed ${v}`);
  }
});

test("particles are deterministic, self-contained images", () => {
  assert.equal(particles("embers", "#f80"), particles("embers", "#f80"));
  assert.notEqual(particles("embers", "#f80", 1), particles("embers", "#f80", 2));
  assert.match(particles("snow", "#fff"), /^url\("data:image\/svg\+xml,%3Csvg/);
  assert.equal(particles("nonsense", "#fff"), null);
});

test("sizes and font scales reach the variables", () => {
  const compact = buildStylesheet({ theme: THEMES.classic, size: "compact", font: "small" });
  assert.ok(compact.includes("--fxr-tab: 32px;"));
  assert.ok(compact.includes("--fxr-icon: 22px;"));
  assert.ok(compact.includes("--fxr-font-scale: 0.9;"));
  const large = buildStylesheet({ theme: THEMES.classic, size: "large", font: "large" });
  assert.ok(large.includes("--fxr-icon: 40px;"));
  assert.ok(large.includes("--fxr-item-height: 48px;"));
  const unknown = buildStylesheet({ theme: THEMES.classic, size: "huge", font: "tiny" });
  assert.ok(unknown.includes("--fxr-icon: 40px;") && unknown.includes("--fxr-font-scale: 1;"), "falls back to defaults");
});

test("a dark chat surface glows and uses a dark color scheme", () => {
  const neon = buildStylesheet({ theme: THEMES.neon, art: bundled("neon") });
  assert.ok(neon.includes("color-scheme: dark;\n  --color-text-primary: var(--fxr-ink);"));
  assert.ok(neon.includes("text-shadow: 0 0 6px"));
  assert.ok(neon.includes("--fxr-paper-blend: normal;"), "scanlines stay visible on dark glass");
  const fantasy = buildStylesheet({ theme: THEMES.fantasy, art: bundled("fantasy") });
  assert.ok(fantasy.includes("color-scheme: light;"));
  assert.ok(fantasy.includes("--fxr-paper-blend: multiply;"));
});

test("chat labels are localized and safely quoted", () => {
  const css = buildStylesheet({ theme: THEMES.fantasy, labels: { whisper: "(Murmure)", blind: "Aveugle \"x\"" } });
  assert.ok(css.includes("content: \"(Murmure)\" \" \";"));
  assert.ok(css.includes("content: \"Aveugle \\\"x\\\"\" \" \";"));
  assert.equal(cssString("a\\b\nc"), "\"a\\\\b c\"");
});

test("noise textures are self-contained SVG data URIs", () => {
  const n = noise(0.3, "0.5");
  assert.match(n, /^url\("data:image\/svg\+xml,%3Csvg/);
  assert.ok(!n.slice(5, -2).includes("\""), "no unescaped double quotes inside url()");
});
