import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyChoices, resolveTheme } from "../modules/flexui-revived/scripts/lib/choice.mjs";
import { THEME_IDS } from "../modules/flexui-revived/scripts/lib/themes.mjs";

test("resolveTheme: a player's own choice beats the table default; off and unknown mean Foundry's look", () => {
  assert.equal(resolveTheme({ choice: "stone", tableDefault: "fantasy", themeIds: THEME_IDS }), "stone");
  assert.equal(resolveTheme({ choice: "default", tableDefault: "scifi", themeIds: THEME_IDS }), "scifi");
  assert.equal(resolveTheme({ choice: "default", tableDefault: "off", themeIds: THEME_IDS }), null);
  assert.equal(resolveTheme({ choice: "off", tableDefault: "fantasy", themeIds: THEME_IDS }), null);
  assert.equal(resolveTheme({ choice: "vaporwave", tableDefault: "fantasy", themeIds: THEME_IDS }), null);
});

const storage = entries => key => (key in entries ? entries[key] : null);

test("legacyChoices maps the original FlexUI's stored client settings", () => {
  assert.deepEqual(legacyChoices(storage({
    "flexui.theme": "\"st\"", "flexui.smallUI": "true", "flexui.fontSize": "\"l\""
  })), { theme: "stone", size: "compact", font: "large" });
  assert.deepEqual(legacyChoices(storage({ "flexui.theme": "\"c\"", "flexui.smallUI": "false" })),
    { theme: "classic", size: "large" });
});

test("legacyChoices: disabled styles mean off, and nothing stored means no opinion", () => {
  assert.deepEqual(legacyChoices(storage({ "flexui.disableStyles": "true", "flexui.theme": "\"s\"" })), { theme: "off" });
  assert.deepEqual(legacyChoices(storage({})), {});
});

test("legacyChoices ignores unreadable or unknown values", () => {
  assert.deepEqual(legacyChoices(storage({ "flexui.theme": "{not json", "flexui.fontSize": "\"xl\"", "flexui.smallUI": "1" })), {});
  assert.deepEqual(legacyChoices(() => { throw new Error("storage blocked"); }), {});
});
