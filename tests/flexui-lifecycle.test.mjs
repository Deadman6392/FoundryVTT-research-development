/**
 * Runs FlexUI Revived's entry point through init -> i18nInit -> setup -> ready against the Foundry mock, as the GM of
 * a world where the original FlexUI is still active and the server runs under a URL prefix. A stand-in sibling module
 * listens to the theme hook the way a music player or other UI module would. The browser document is a
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
  hidden: false,
  addEventListener() {},
  querySelector: () => null,
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

// A sibling module listening for theme changes, registered before FlexUI Revived applies anything
const announced = [];
env.Hooks.on("flexuiRevived.themeChanged", info => announced.push(info));

await import("../modules/flexui-revived/scripts/main.mjs");
const style = () => fakeDocument.getElementById("flexui-revived-theme");
const css = () => style()?.textContent ?? "";
const api = () => game.modules.get(MODULE).api;

test("init registers settings and menus, starting from the original FlexUI's stored choices", () => {
  env.Hooks.callAll("init");
  assert.equal(game.settings.get(MODULE, "theme"), "stone");
  assert.equal(game.settings.get(MODULE, "size"), "compact");
  assert.equal(game.settings.get(MODULE, "font"), "medium");
  assert.equal(game.settings.get(MODULE, "defaultTheme"), "fantasy");
  assert.equal(game.settings.get(MODULE, "artwork"), "bundled");
  assert.equal(game.settings.get(MODULE, "fonts"), true);
  assert.equal(game.settings.get(MODULE, "motion"), false, "motion is opt-in");
  assert.ok(env.settings.menus.has(`${MODULE}.areasMenu`));
  assert.equal(env.settings.menus.get(`${MODULE}.customArtMenu`).restricted, true);
  assert.equal(typeof api().apply, "function");
  assert.equal(api().theme, null);
  assert.equal(style(), null, "nothing is written before translations load");
});

test("i18nInit writes one stylesheet with the bundled art through the URL prefix and announces the theme", () => {
  // The original FlexUI's own init injected its v11 stylesheets
  for ( const href of ["modules/flexui/css/stone/stoneui.css", "modules/flexui/css/stone/small.css", "css/other-module.css"] ) {
    const link = fakeDocument.createElement("link");
    link.setAttribute("href", href);
    head.append(link);
  }
  env.Hooks.callAll("i18nInit");
  assert.match(css(), /FlexUI Revived: stone/);
  assert.ok(css().includes("url(\"/vtt/modules/flexui-revived/assets/icons/visored-helm.svg\")"));
  assert.ok(css().includes("url(\"/vtt/modules/flexui-revived/assets/textures/slate.webp\")"));
  assert.ok(css().includes("url(\"/vtt/modules/flexui-revived/assets/fonts/cinzel.woff2\")"));
  assert.ok(css().includes("--fxr-icon: 22px;"));
  assert.ok(css().includes("FLEXUI.Chat.Whisper"), "chat labels come from the localization");
  assert.doesNotMatch(css(), /animation/, "no motion unless asked for");
  assert.equal(head.children.filter(el => el.id === "flexui-revived-theme").length, 1);
  assert.ok(body.classList.contains("flexui-revived"));
  assert.ok(body.classList.contains("flexui-revived-stone"));

  assert.equal(announced.length, 1);
  assert.deepEqual(announced[0], api().theme);
  assert.equal(announced[0].id, "stone");
  assert.equal(announced[0].palette.accent, "#d9c9a3");
  assert.equal(announced[0].font, "Cinzel");
  assert.equal(announced[0].layer, "modules.flexui-revived");
});

test("setup removes only the original FlexUI's stylesheets", () => {
  env.Hooks.callAll("setup");
  const hrefs = head.children.filter(el => el.tagName === "LINK").map(el => el.attributes.href);
  assert.deepEqual(hrefs, ["css/other-module.css"]);
});

test("ready tells the GM to deactivate the original, and re-applying announces nothing new", () => {
  game.user = { id: "gm1", isGM: true };
  env.Hooks.callAll("ready");
  assert.deepEqual(env.notifications.map(n => n.slice(0, 2)), [["warn", "FLEXUI.Notify.OriginalActive"]]);
  assert.ok(style(), "the theme is still in place");
  assert.equal(announced.length, 1);
});

test("settings apply live: theme, table default and off, each announced once", async () => {
  await game.settings.set(MODULE, "theme", "infernal");
  assert.match(css(), /FlexUI Revived: infernal/);
  assert.ok(body.classList.contains("flexui-revived-infernal"));
  assert.ok(!body.classList.contains("flexui-revived-stone"));
  assert.equal(announced.at(-1).id, "infernal");

  await game.settings.set(MODULE, "theme", "default");
  assert.match(css(), /FlexUI Revived: fantasy/);
  await game.settings.set(MODULE, "defaultTheme", "frost");
  assert.match(css(), /FlexUI Revived: frost/, "a GM's world change reaches players who follow it");

  await game.settings.set(MODULE, "theme", "off");
  assert.equal(style(), null);
  assert.ok(!body.classList.contains("flexui-revived"));
  assert.equal(api().theme, null);
  assert.equal(announced.at(-1), null, "modules hear that the theme went away");

  await game.settings.set(MODULE, "theme", "fantasy");
  assert.match(css(), /FlexUI Revived: fantasy/);
  assert.deepEqual(announced.map(i => i?.id ?? null), ["stone", "infernal", "fantasy", "frost", null, "fantasy"]);
});

test("motion and fonts are announced; sizes and areas rewrite the same element silently", async () => {
  const element = style();
  const count = announced.length;
  await game.settings.set(MODULE, "areas", { chat: false });
  await game.settings.set(MODULE, "size", "large");
  assert.equal(style(), element);
  assert.ok(!element.textContent.includes(".chat-message {"));
  assert.ok(element.textContent.includes("--fxr-icon: 40px;"));
  assert.equal(announced.length, count, "nothing a sibling module needs changed");

  await game.settings.set(MODULE, "motion", true);
  assert.ok(element.textContent.includes("@media (prefers-reduced-motion: no-preference)"));
  assert.equal(announced.at(-1).motion, true);
  // The timer module is fetched on demand; the same module instance is what main.mjs loaded
  const motion = await import("../modules/flexui-revived/scripts/motion.mjs");
  await new Promise(r => setTimeout(r, 0));
  assert.equal(motion.running(), true);
  await game.settings.set(MODULE, "theme", "off");
  await new Promise(r => setTimeout(r, 0));
  assert.equal(motion.running(), false, "no theme, no timer");
  await game.settings.set(MODULE, "theme", "fantasy");
  await game.settings.set(MODULE, "fonts", false);
  assert.ok(!css().includes("@font-face"));
  assert.equal(announced.at(-1).font, null);
});

test("artwork: lightweight, none and custom rewrite the same element", async () => {
  const element = style();
  await game.settings.set(MODULE, "lightweight", true);
  assert.ok(!element.textContent.includes("wood.webp"));
  assert.ok(element.textContent.includes("crossed-swords.svg"), "icons stay");

  await game.settings.set(MODULE, "artwork", "none");
  assert.ok(!element.textContent.includes("assets/icons/"));

  await game.settings.set(MODULE, "lightweight", false);
  await game.settings.set(MODULE, "customArt", { folder: "worlds/w/art", files: { icon_chat: "worlds/w/art/chat.png" } });
  await game.settings.set(MODULE, "artwork", "custom");
  assert.ok(element.textContent.includes("url(\"/vtt/worlds/w/art/chat.png\")"));
  assert.ok(element.textContent.includes("assets/icons/crossed-swords.svg"), "the bundled set fills gaps");
});
