import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ART_ROLES, HEAVY_ROLES, TAB_ART, cssUrl, matchArtFiles, originalArtPath, resolveArt
} from "../modules/flexui-revived/scripts/lib/art.mjs";
import { THEMES } from "../modules/flexui-revived/scripts/lib/themes.mjs";

const fantasy = THEMES.fantasy;

test("every sidebar tab with art has a role, and roles are unique", () => {
  for ( const role of Object.values(TAB_ART) ) assert.ok(ART_ROLES.includes(role), role);
  assert.equal(new Set(ART_ROLES).size, ART_ROLES.length);
  for ( const role of HEAVY_ROLES ) assert.ok(ART_ROLES.includes(role), role);
});

test("original artwork paths match the original FlexUI 0.3.0 layout", () => {
  assert.equal(originalArtPath("stone", "icon_chat"), "modules/flexui/ui/img/stone/icon_chat.webp");
});

test("automatic artwork uses the original only when it is installed", () => {
  const without = resolveArt({ theme: fantasy, source: "auto", originalInstalled: false });
  assert.deepEqual(without, {});
  const withOriginal = resolveArt({ theme: fantasy, source: "auto", originalInstalled: true });
  assert.equal(Object.keys(withOriginal).length, ART_ROLES.length);
  assert.equal(withOriginal.icon_chat, "modules/flexui/ui/img/fantasy/icon_chat.webp");
});

test("original artwork can be forced, and none means none", () => {
  assert.equal(resolveArt({ theme: fantasy, source: "original", originalInstalled: false }).parchment,
    "modules/flexui/ui/img/fantasy/parchment.webp");
  assert.deepEqual(resolveArt({ theme: fantasy, source: "none", originalInstalled: true }), {});
});

test("a custom folder overrides roles it has and the original fills the rest", () => {
  const custom = { icon_chat: "worlds/w/art/icon_chat.png" };
  const alone = resolveArt({ theme: fantasy, source: "custom", originalInstalled: false, custom });
  assert.deepEqual(alone, custom);
  const filled = resolveArt({ theme: fantasy, source: "custom", originalInstalled: true, custom });
  assert.equal(filled.icon_chat, "worlds/w/art/icon_chat.png");
  assert.equal(filled.icon_combat, "modules/flexui/ui/img/fantasy/icon_combat.webp");
});

test("custom files are ignored unless the source is custom", () => {
  const art = resolveArt({ theme: fantasy, source: "auto", originalInstalled: false, custom: { icon_chat: "x.png" } });
  assert.deepEqual(art, {});
});

test("lightweight textures drop only the heavy images", () => {
  const art = resolveArt({ theme: fantasy, source: "original", originalInstalled: true, lightweight: true });
  for ( const role of HEAVY_ROLES ) assert.equal(art[role], undefined, role);
  assert.ok(art.icon_chat);
  assert.ok(art.button_green);
});

test("matchArtFiles matches by name regardless of case and extension, first file wins", () => {
  const found = matchArtFiles([
    "worlds/w/art/Icon_Chat.PNG",
    "worlds/w/art/icon_chat.webp",
    "worlds/w/art/main_panel.jpg",
    "worlds/w/art/readme.txt",
    "worlds/w/art/icon_chat.txt",
    "worlds/w/art/portrait.webp",
    "https://bucket.example/art/button%20green.webp",
    "https://bucket.example/art/button_red.webp?v=2"
  ]);
  assert.deepEqual(found, {
    icon_chat: "worlds/w/art/Icon_Chat.PNG",
    main_panel: "worlds/w/art/main_panel.jpg",
    button_red: "https://bucket.example/art/button_red.webp?v=2"
  });
});

test("cssUrl routes relative paths and leaves absolute ones alone", () => {
  const route = p => `/foundry/${p}`;
  assert.equal(cssUrl("modules/flexui/ui/img/a.webp", route), "url(\"/foundry/modules/flexui/ui/img/a.webp\")");
  assert.equal(cssUrl("https://cdn.example/a.webp", route), "url(\"https://cdn.example/a.webp\")");
  assert.equal(cssUrl("/already/rooted.webp", route), "url(\"/already/rooted.webp\")");
  assert.equal(cssUrl("data:image/png;base64,AA", route), "url(\"data:image/png;base64,AA\")");
});

test("cssUrl escapes characters that would end the CSS string", () => {
  const out = cssUrl("worlds/a\"b\\c.webp", p => `/${p}`);
  assert.equal(out, "url(\"/worlds/a\\\"b\\\\c.webp\")");
});
