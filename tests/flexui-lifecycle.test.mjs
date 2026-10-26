/**
 * Runs FlexUI Revived's entry point through init -> i18nInit -> setup -> ready against the Foundry mock, as the GM of
 * a world where the original FlexUI is still active and the server runs under a URL prefix. The browser document is a
 * small stand-in with just what the module touches. Tests in this file run in order and share state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

/** A minimal element: id, text, children, attributes and a classList. */
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.id = "";
    this.textContent = "";
    this.children = [];
    this.parent = null;
    this.attributes = {};
    const classes = new Set();
    this.classList = {
      contains: c => classes.has(c),
      toggle: (c, force) => {
        const on = force ?? !classes.has(c);
        if ( on ) classes.add(c);
        else classes.delete(c);
        return on;
      }
    };
  }

  append(...elements) {
    for ( const el of elements ) {
      el.parent = this;
      this.children.push(el);
    }
  }

  remove() {
    if ( !this.parent ) return;
    this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

const head = new FakeElement("head");
const body = new FakeElement("body");
const all = () => [...head.children, ...body.children];
const fakeDocument = {
  head,
  body,
  createElement: tag => new FakeElement(tag),
  getElementById: id => all().find(el => el.id === id) ?? null,
  // Only the one selector shape the module uses: tag[attr*="text"]
  querySelectorAll: selector => {
    const m = /^(\w+)\[(\w+)\*="([^"]+)"\]$/.exec(selector);
    if ( !m ) throw new Error(`unsupported selector ${selector}`);
    return all().filter(el => (el.tagName === m[1].toUpperCase()) && el.attributes[m[2]]?.includes(m[3]));
  }
};

const env = installFoundry({ userId: "gm1", role: 4 });
globalThis.document = fakeDocument;
globalThis.ROUTE_PREFIX = "vtt";
const MODULE = "flexui-revived";
env.modules.set(MODULE, { id: MODULE, active: true });
env.modules.set("flexui", { id: "flexui", active: true });

// The original FlexUI stored this player's choices in this browser years ago
env.localStorage.setItem("flexui.theme", "\"st\"");
env.localStorage.setItem("flexui.smallUI", "true");

await import("../modules/flexui-revived/scripts/main.mjs");
const style = () => fakeDocument.getElementById("flexui-revived-theme");

test("init registers settings and menus, starting from the original FlexUI's stored choices", () => {
  env.Hooks.callAll("init");
  assert.equal(game.settings.get(MODULE, "theme"), "stone");
  assert.equal(game.settings.get(MODULE, "size"), "compact");
  assert.equal(game.settings.get(MODULE, "font"), "medium");
  assert.equal(game.settings.get(MODULE, "defaultTheme"), "fantasy");
  assert.equal(game.settings.get(MODULE, "artSource"), "auto");
  assert.ok(env.settings.menus.has(`${MODULE}.areasMenu`));
  assert.equal(env.settings.menus.get(`${MODULE}.customArtMenu`).restricted, true);
  assert.equal(typeof game.modules.get(MODULE).api.apply, "function");
  assert.equal(style(), null, "nothing is written before translations load");
});

test("i18nInit writes one stylesheet with the original's artwork through the URL prefix", () => {
  // The original FlexUI's own init injected its v11 stylesheets
  for ( const href of ["modules/flexui/css/stone/stoneui.css", "modules/flexui/css/stone/small.css", "css/other-module.css"] ) {
    const link = fakeDocument.createElement("link");
    link.setAttribute("href", href);
    head.append(link);
  }
  env.Hooks.callAll("i18nInit");
  const css = style()?.textContent ?? "";
  assert.match(css, /FlexUI Revived: stone/);
  assert.ok(css.includes("url(\"/vtt/modules/flexui/ui/img/stone/icon_chat.webp\")"));
  assert.ok(css.includes("--fxr-icon: 22px;"));
  assert.ok(css.includes("FLEXUI.Chat.Whisper"), "chat labels come from the localization");
  assert.equal(head.children.filter(el => el.id === "flexui-revived-theme").length, 1);
  assert.ok(body.classList.contains("flexui-revived"));
  assert.ok(body.classList.contains("flexui-revived-stone"));
});

test("setup removes only the original FlexUI's stylesheets", () => {
  env.Hooks.callAll("setup");
  const hrefs = head.children.filter(el => el.tagName === "LINK").map(el => el.attributes.href);
  assert.deepEqual(hrefs, ["css/other-module.css"]);
});

test("ready tells the GM to deactivate the original", () => {
  game.user = { id: "gm1", isGM: true };
  env.Hooks.callAll("ready");
  assert.equal(env.notifications.length, 1);
  assert.equal(env.notifications[0][0], "warn");
  assert.equal(env.notifications[0][1], "FLEXUI.Notify.OriginalActive");
  assert.ok(style(), "the theme is still in place");
});

test("settings apply live: theme, table default and off", async () => {
  await game.settings.set(MODULE, "theme", "scifi");
  assert.match(style().textContent, /FlexUI Revived: scifi/);
  assert.ok(body.classList.contains("flexui-revived-scifi"));
  assert.ok(!body.classList.contains("flexui-revived-stone"));

  await game.settings.set(MODULE, "theme", "default");
  assert.match(style().textContent, /FlexUI Revived: fantasy/);
  await game.settings.set(MODULE, "defaultTheme", "classic");
  assert.match(style().textContent, /FlexUI Revived: classic/, "a GM's world change reaches players who follow it");

  await game.settings.set(MODULE, "theme", "off");
  assert.equal(style(), null);
  assert.ok(!body.classList.contains("flexui-revived"));
  await game.settings.set(MODULE, "theme", "fantasy");
  assert.match(style().textContent, /FlexUI Revived: fantasy/);
});

test("areas, sizes, lightweight textures and artwork source rewrite the same element", async () => {
  const element = style();
  await game.settings.set(MODULE, "areas", { chat: false });
  assert.equal(style(), element);
  assert.ok(!element.textContent.includes(".chat-message {"));
  assert.ok(element.textContent.includes("#sidebar-tabs"));

  await game.settings.set(MODULE, "size", "large");
  assert.ok(element.textContent.includes("--fxr-icon: 40px;"));

  await game.settings.set(MODULE, "lightweight", true);
  assert.ok(!element.textContent.includes("main_panel.webp"));
  assert.ok(element.textContent.includes("icon_chat.webp"));

  await game.settings.set(MODULE, "artSource", "none");
  assert.ok(!element.textContent.includes("modules/flexui/"));

  await game.settings.set(MODULE, "customArt", { folder: "worlds/w/art", files: { icon_chat: "worlds/w/art/chat.png" } });
  await game.settings.set(MODULE, "artSource", "custom");
  assert.ok(element.textContent.includes("url(\"/vtt/worlds/w/art/chat.png\")"));
  assert.ok(element.textContent.includes("modules/flexui/ui/img/fantasy/icon_combat.webp"), "the original fills gaps");
});

test("choosing the original's artwork without it installed warns the GM and still draws the theme", async () => {
  env.modules.delete("flexui");
  env.notifications.length = 0;
  await game.settings.set(MODULE, "artSource", "auto");
  assert.equal(env.notifications.length, 0);
  assert.ok(!style().textContent.includes("modules/flexui/"), "automatic falls back to CSS");
  await game.settings.set(MODULE, "artSource", "original");
  assert.deepEqual(env.notifications.map(n => n[1]), ["FLEXUI.Notify.OriginalMissing"]);
  assert.ok(style().textContent.includes("modules/flexui/ui/img/fantasy/icon_chat.webp"), "an explicit choice is honored");
});
