/**
 * The bundled assets: everything a theme names exists, nothing ships unused, every file is credited, and fonts carry
 * their licenses. Keeps the zip honest as themes are added.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ICONS, FONTS, THEMES, iconFor } from "../modules/flexui-revived/scripts/lib/themes.mjs";

const MODULE = new URL("../modules/flexui-revived/", import.meta.url).pathname;
const ASSETS = join(MODULE, "assets");
const credits = readFileSync(join(MODULE, "CREDITS.md"), "utf8");
const list = dir => readdirSync(join(ASSETS, dir));

const usedIcons = new Set();
const usedTextures = new Set();
const usedFonts = new Set();
for ( const theme of Object.values(THEMES) ) {
  for ( const tab of Object.keys(DEFAULT_ICONS) ) usedIcons.add(`${iconFor(theme, tab)}.svg`);
  if ( theme.panel?.texture ) usedTextures.add(`${theme.panel.texture}.webp`);
  if ( theme.paper?.texture ) usedTextures.add(`${theme.paper.texture}.webp`);
  if ( theme.font ) usedFonts.add(FONTS[theme.font].file);
}

test("every icon, texture and font a theme names is bundled", () => {
  for ( const f of usedIcons ) assert.ok(existsSync(join(ASSETS, "icons", f)), f);
  for ( const f of usedTextures ) assert.ok(existsSync(join(ASSETS, "textures", f)), f);
  for ( const f of usedFonts ) assert.ok(existsSync(join(ASSETS, "fonts", f)), f);
  for ( const theme of Object.values(THEMES) ) assert.ok(!theme.font || FONTS[theme.font], `${theme.id} font`);
});

test("nothing is bundled that no theme uses", () => {
  assert.deepEqual(list("icons").filter(f => !usedIcons.has(f)), []);
  assert.deepEqual(list("textures").filter(f => !usedTextures.has(f)), []);
  assert.deepEqual(list("fonts").filter(f => f.endsWith(".woff2") && !usedFonts.has(f)), []);
});

test("every bundled file is credited", () => {
  for ( const f of list("icons") ) assert.ok(credits.includes(f.replace(".svg", "")), `icon ${f}`);
  for ( const f of list("textures") ) assert.ok(credits.includes(`\`${f}\``), `texture ${f}`);
  for ( const f of list("fonts").filter(n => n.endsWith(".woff2")) ) assert.ok(credits.includes(`\`${f}\``), `font ${f}`);
});

test("every font ships with its license", () => {
  for ( const f of list("fonts").filter(n => n.endsWith(".woff2")) ) {
    const license = join(ASSETS, "fonts", f.replace(".woff2", "-LICENSE.txt"));
    assert.ok(existsSync(license), license);
    assert.match(readFileSync(license, "utf8"), /SIL Open Font License|Apache License/);
  }
});

test("icons are usable as masks: no background square, opaque fill", () => {
  for ( const f of list("icons") ) {
    const svg = readFileSync(join(ASSETS, "icons", f), "utf8");
    assert.match(svg, /^<svg [^>]*viewBox="0 0 512 512"/, f);
    assert.ok(!svg.includes("M0 0h512v512H0z"), `${f} still has its background`);
    assert.ok(!/fill="#fff/.test(svg), `${f} still white`);
  }
});

test("assets stay small", () => {
  const sizes = dir => list(dir).map(f => statSync(join(ASSETS, dir, f)).size);
  assert.ok(Math.max(...sizes("textures")) < 80 * 1024, "each texture under 80 KB");
  assert.ok(Math.max(...sizes("icons")) < 8 * 1024, "each icon under 8 KB");
  const total = ["icons", "textures", "fonts"].flatMap(sizes).reduce((a, b) => a + b, 0);
  assert.ok(total < 1024 * 1024, `all assets under 1 MB (${total} bytes)`);
});
