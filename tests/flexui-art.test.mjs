import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ART_ROLES, ASSET_ROOT, HEAVY_ROLES, TAB_ART, cssUrl, matchArtFiles, normalizeSource, resolveArt
} from "../modules/flexui-revived/scripts/lib/art.mjs";
import { THEMES } from "../modules/flexui-revived/scripts/lib/themes.mjs";

const { fantasy, neon } = THEMES;

test("every sidebar tab with art has a role, and roles are unique", () => {
  for ( const role of Object.values(TAB_ART) ) assert.ok(ART_ROLES.includes(role), role);
  assert.equal(new Set(ART_ROLES).size, ART_ROLES.length);
  for ( const role of HEAVY_ROLES ) assert.ok(ART_ROLES.includes(role), role);
});

test("0.1's artwork choices become the bundled artwork", () => {
  assert.equal(normalizeSource("auto"), "bundled");
  assert.equal(normalizeSource("original"), "bundled");
  assert.equal(normalizeSource(undefined), "bundled");
  assert.equal(normalizeSource("custom"), "custom");
  assert.equal(normalizeSource("none"), "none");
});

test("bundled artwork gives masked icons for every tab and the theme's textures", () => {
  const art = resolveArt({ theme: fantasy, source: "bundled" });
  for ( const role of Object.values(TAB_ART) ) assert.equal(art[role].kind, "mask", role);
  assert.deepEqual(art.icon_chat, { path: `${ASSET_ROOT}/icons/conversation.svg`, kind: "mask" });
  assert.deepEqual(art.panel_texture, { path: `${ASSET_ROOT}/textures/wood.webp`, kind: "tile" });
  assert.deepEqual(art.parchment, { path: `${ASSET_ROOT}/textures/paper-white.webp`, kind: "tile" });
});

test("a theme's own icons replace the defaults; a theme without paper art gets none", () => {
  const art = resolveArt({ theme: neon, source: "bundled" });
  assert.equal(art.icon_combat.path, `${ASSET_ROOT}/icons/pistol-gun.svg`);
  assert.equal(art.parchment, undefined, "neon's chat is drawn with CSS");
});

test("none means no images at all", () => {
  assert.deepEqual(resolveArt({ theme: fantasy, source: "none" }), {});
});

test("a custom folder overrides roles it has, with the right drawing kind, and the bundled art fills the rest", () => {
  const custom = {
    icon_chat: "worlds/w/art/icon_chat.png",
    main_panel: "worlds/w/art/main_panel.webp",
    panel_texture: "worlds/w/art/panel_texture.webp",
    button_green: "worlds/w/art/button_green.webp",
    not_a_role: "worlds/w/art/x.webp"
  };
  const art = resolveArt({ theme: fantasy, source: "custom", custom });
  assert.deepEqual(art.icon_chat, { path: "worlds/w/art/icon_chat.png", kind: "image" });
  assert.equal(art.main_panel.kind, "frame");
  assert.equal(art.panel_texture.kind, "tile");
  assert.equal(art.button_green.kind, "image");
  assert.equal(art.icon_combat.kind, "mask", "missing roles come from the bundled set");
  assert.equal(art.not_a_role, undefined);
});

test("custom files are ignored unless the source is custom", () => {
  const art = resolveArt({ theme: fantasy, source: "bundled", custom: { icon_chat: "x.png" } });
  assert.equal(art.icon_chat.kind, "mask");
});

test("lightweight textures drop only the surfaces", () => {
  const art = resolveArt({ theme: fantasy, source: "custom", custom: { main_panel: "m.webp" }, lightweight: true });
  for ( const role of HEAVY_ROLES ) assert.equal(art[role], undefined, role);
  assert.equal(art.icon_chat.kind, "mask");
});

test("matchArtFiles matches by name regardless of case and extension, first file wins", () => {
  const found = matchArtFiles([
    "worlds/w/art/Icon_Chat.PNG",
    "worlds/w/art/icon_chat.webp",
    "worlds/w/art/main_panel.jpg",
    "worlds/w/art/panel_texture.avif",
    "worlds/w/art/readme.txt",
    "worlds/w/art/icon_chat.txt",
    "worlds/w/art/portrait.webp",
    "https://bucket.example/art/button%20green.webp",
    "https://bucket.example/art/button_red.webp?v=2"
  ]);
  assert.deepEqual(found, {
    icon_chat: "worlds/w/art/Icon_Chat.PNG",
    main_panel: "worlds/w/art/main_panel.jpg",
    panel_texture: "worlds/w/art/panel_texture.avif",
    button_red: "https://bucket.example/art/button_red.webp?v=2"
  });
});

test("cssUrl routes relative paths and leaves absolute ones alone", () => {
  const route = p => `/foundry/${p}`;
  assert.equal(cssUrl("modules/flexui-revived/assets/a.webp", route), "url(\"/foundry/modules/flexui-revived/assets/a.webp\")");
  assert.equal(cssUrl("https://cdn.example/a.webp", route), "url(\"https://cdn.example/a.webp\")");
  assert.equal(cssUrl("/already/rooted.webp", route), "url(\"/already/rooted.webp\")");
  assert.equal(cssUrl("data:image/png;base64,AA", route), "url(\"data:image/png;base64,AA\")");
});

test("cssUrl escapes characters that would end the CSS string", () => {
  const out = cssUrl("worlds/a\"b\\c.webp", p => `/${p}`);
  assert.equal(out, "url(\"/worlds/a\\\"b\\\\c.webp\")");
});
