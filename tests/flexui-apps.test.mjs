/**
 * FlexUI Revived's two settings windows: their HTML and their form handlers, against the Foundry mock. The mock's
 * ApplicationV2 has no rendering, so each test calls _renderHTML and the configured handlers directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry({ userId: "gm1", role: 4 });
const MODULE = "flexui-revived";
env.modules.set(MODULE, { id: MODULE, active: true });

const appended = [];
globalThis.document = {
  head: { append: el => appended.push(el) },
  getElementById: id => appended.find(el => el.id === id) ?? null,
  createElement: () => ({ id: "", textContent: "" })
};

const browsed = [];
let listing = { files: [] };
foundry.applications.apps = {
  FilePicker: {
    implementation: {
      browse: async (source, target) => {
        browsed.push([source, target]);
        if ( listing instanceof Error ) throw listing;
        return listing;
      }
    }
  }
};

await import("../modules/flexui-revived/scripts/main.mjs");
env.Hooks.callAll("init");
game.user = { id: "gm1", isGM: true };

const { AreasApp } = await import("../modules/flexui-revived/scripts/apps/areas-app.mjs");
const { CustomArtApp } = await import("../modules/flexui-revived/scripts/apps/custom-art-app.mjs");

test("the areas window lists every area with its current state and injects its style once", async () => {
  await game.settings.set(MODULE, "areas", { chat: false });
  const app = new AreasApp();
  const html = await app._renderHTML();
  assert.ok(html.includes("name=\"chat\">"), "chat is unticked");
  assert.ok(html.includes("name=\"tabs\" checked>"));
  assert.ok(html.includes("name=\"windows\">"), "windows default off");
  await app._renderHTML();
  assert.equal(appended.filter(el => el.id === "flexui-revived-app-style").length, 1);
});

test("saving areas stores a complete boolean map", async () => {
  const handler = AreasApp.DEFAULT_OPTIONS.form.handler;
  await handler.call(new AreasApp(), new Event("submit"), null, { object: { tabs: true, chat: true, hotbar: false } });
  const areas = game.settings.get(MODULE, "areas");
  assert.equal(areas.chat, true);
  assert.equal(areas.hotbar, false);
  assert.equal(areas.panel, false, "unticked boxes are absent from form data and saved as off");
  assert.equal(Object.values(areas).every(v => typeof v === "boolean"), true);
});

test("scanning a folder stores the matched images once, in a world setting", async () => {
  listing = { files: ["worlds/w/art/icon_chat.webp", "worlds/w/art/MAIN_PANEL.png", "worlds/w/art/notes.txt"] };
  const app = new CustomArtApp();
  let rendered = 0;
  app.render = () => rendered++;
  await CustomArtApp.DEFAULT_OPTIONS.form.handler.call(app, new Event("submit"), null, { object: { folder: " worlds/w/art/ " } });
  assert.deepEqual(browsed.at(-1), ["data", "worlds/w/art"]);
  assert.deepEqual(game.settings.get(MODULE, "customArt"), {
    folder: "worlds/w/art",
    files: { icon_chat: "worlds/w/art/icon_chat.webp", main_panel: "worlds/w/art/MAIN_PANEL.png" }
  });
  assert.equal(rendered, 1);
  assert.equal(env.notifications.at(-1)[0], "info");

  const html = await app._renderHTML();
  assert.ok(html.includes("value=\"worlds/w/art\""));
  assert.ok(html.includes("class=\"found\" title=\"worlds/w/art/icon_chat.webp\""));
  assert.ok(html.includes("FLEXUI.CustomArt.NotSelected"), "reminds the GM to pick the custom source");
});

test("a folder that cannot be read leaves the saved artwork alone", async () => {
  const before = game.settings.get(MODULE, "customArt");
  listing = new Error("EACCES");
  const app = new CustomArtApp();
  app.render = () => {};
  await CustomArtApp.DEFAULT_OPTIONS.form.handler.call(app, new Event("submit"), null, { object: { folder: "nope" } });
  assert.deepEqual(game.settings.get(MODULE, "customArt"), before);
  assert.equal(env.notifications.at(-1)[0], "error");
  assert.match(env.notifications.at(-1)[1], /EACCES/);
});

test("an empty folder or Clear forgets the custom artwork", async () => {
  const app = new CustomArtApp();
  app.render = () => {};
  await CustomArtApp.DEFAULT_OPTIONS.form.handler.call(app, new Event("submit"), null, { object: { folder: "" } });
  assert.deepEqual(game.settings.get(MODULE, "customArt"), { folder: "", files: {} });
  await game.settings.set(MODULE, "customArt", { folder: "x", files: { icon_chat: "x/icon_chat.webp" } });
  await CustomArtApp.DEFAULT_OPTIONS.actions.clear.call(app);
  assert.deepEqual(game.settings.get(MODULE, "customArt"), { folder: "", files: {} });
});

test("only a GM can open the custom artwork window", () => {
  game.user = { id: "player1", isGM: false };
  assert.equal(CustomArtApp.open(), null);
});
