import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AREAS, DEFAULT_AREAS, buildStylesheet, cssString, normalizeAreas
} from "../modules/flexui-revived/scripts/lib/stylesheet.mjs";
import { THEMES, THEME_IDS, noise } from "../modules/flexui-revived/scripts/lib/themes.mjs";
import { ART_ROLES, resolveArt } from "../modules/flexui-revived/scripts/lib/art.mjs";

const allOriginal = id => resolveArt({ theme: THEMES[id], source: "original", originalInstalled: true });

/** Strip comments and strings so brace counting only sees CSS structure. */
function structure(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"/g, "\"\"");
}

test("every theme defines the same palette tokens", () => {
  const tokens = Object.keys(THEMES.fantasy.palette).sort();
  for ( const id of THEME_IDS ) {
    assert.equal(THEMES[id].id, id);
    assert.deepEqual(Object.keys(THEMES[id].palette).sort(), tokens, id);
  }
});

test("every theme builds balanced CSS inside Foundry's modules layer, with and without artwork", () => {
  for ( const id of THEME_IDS ) {
    for ( const art of [{}, allOriginal(id)] ) {
      const css = buildStylesheet({ theme: THEMES[id], art, areas: normalizeAreas({ windows: true }) });
      assert.match(css, /^\/\* FlexUI Revived: \w+ \*\/\n@layer modules \{\n/);
      const s = structure(css);
      assert.equal((s.match(/\{/g) ?? []).length, (s.match(/\}/g) ?? []).length, `${id} braces`);
      assert.doesNotMatch(css, /undefined|NaN|\[object/, id);
      for ( const token of Object.keys(THEMES[id].palette) ) {
        assert.ok(css.includes(`--fxr-${token.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}:`), `${id} ${token}`);
      }
    }
  }
});

test("the stylesheet never sets layout on the sidebar itself", () => {
  // The original's position/width rules on #sidebar are what broke Foundry v13's interface
  const css = buildStylesheet({ theme: THEMES.fantasy, art: allOriginal("fantasy"), areas: normalizeAreas({ windows: true }) });
  for ( const block of css.matchAll(/(^|\n)#sidebar(?:\s*,[^{]*)?\s*\{([^}]*)\}/g) ) {
    assert.doesNotMatch(block[2], /\b(position|width|height|display)\s*:/);
  }
  assert.doesNotMatch(css, /position\s*:\s*fixed/);
});

test("areas switch their rules on and off", () => {
  const theme = THEMES.stone;
  const all = buildStylesheet({ theme, areas: normalizeAreas({ windows: true }) });
  const markers = {
    tabs: "#sidebar-tabs .ui-control", panel: "#sidebar-content {", chat: ".chat-message {",
    directories: ".directory-item.folder > .folder-header", combat: ".combat-controls", controls: "#scene-controls .ui-control",
    navigation: "#scene-navigation", hotbar: "#hotbar .slot", players: "#players {", windows: "> .window-header"
  };
  assert.deepEqual(Object.keys(markers).sort(), [...AREAS].sort());
  for ( const [area, marker] of Object.entries(markers) ) {
    assert.ok(all.includes(marker), `${area} present when on`);
    const without = buildStylesheet({ theme, areas: normalizeAreas({ windows: true, [area]: false }) });
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

test("tab artwork replaces the icon glyph per tab, through the route", () => {
  const css = buildStylesheet({ theme: THEMES.fantasy, art: allOriginal("fantasy"), route: p => `/vtt/${p}` });
  assert.ok(css.includes("#sidebar-tabs [data-tab=\"chat\"]::before { background-image: url(\"/vtt/modules/flexui/ui/img/fantasy/icon_chat.webp\"); }"));
  assert.ok(css.includes("#sidebar-tabs [data-tab=\"playlists\"]::before { background-image: url(\"/vtt/modules/flexui/ui/img/fantasy/icon_audio.webp\"); }"));
  assert.ok(css.includes(".fa-caret-left"), "collapse arrows use artwork");
  assert.ok(css.includes("#scene-navigation-expand:is(.fa-caret-down"), "so does the navigation toggle");
  assert.ok(css.includes("border-image: url(\"/vtt/modules/flexui/ui/img/fantasy/main_panel.webp\") 20 fill"));
  assert.doesNotMatch(css, /url\("\/modules/, "no hard-coded root paths");
});

test("without artwork no images are referenced except inline textures", () => {
  for ( const id of THEME_IDS ) {
    const css = buildStylesheet({ theme: THEMES[id] });
    const urls = [...css.matchAll(/url\("([^"]*)"\)/g)].map(m => m[1]);
    assert.ok(urls.length > 0);
    for ( const u of urls ) assert.ok(u.startsWith("data:image/svg+xml,"), `${id}: ${u.slice(0, 40)}`);
    assert.ok(!css.includes("[data-tab=\"chat\"]::before"), `${id}: no per-tab art rules`);
  }
});

test("the sci-fi theme gets hexagonal tabs only without tab artwork", () => {
  assert.ok(buildStylesheet({ theme: THEMES.scifi }).includes("clip-path: polygon"));
  assert.ok(!buildStylesheet({ theme: THEMES.scifi, art: allOriginal("scifi") }).includes("clip-path"));
  assert.ok(!buildStylesheet({ theme: THEMES.fantasy }).includes("clip-path"));
});

test("a theme's panel-art palette applies only when the panel image is used", () => {
  const plain = buildStylesheet({ theme: THEMES.scifi });
  assert.ok(plain.includes(`--fxr-text: ${THEMES.scifi.palette.text};`));
  const art = buildStylesheet({ theme: THEMES.scifi, art: allOriginal("scifi") });
  assert.ok(art.includes(`--fxr-text: ${THEMES.scifi.panelArtPalette.text};`));
  assert.ok(art.includes(`--fxr-texture-text: ${THEMES.scifi.palette.text};`), "CSS textures keep readable text");
  const light = resolveArt({ theme: THEMES.scifi, source: "original", originalInstalled: true, lightweight: true });
  assert.ok(buildStylesheet({ theme: THEMES.scifi, art: light }).includes(`--fxr-text: ${THEMES.scifi.palette.text};`));
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
  assert.ok(ART_ROLES.length > 20);
});
