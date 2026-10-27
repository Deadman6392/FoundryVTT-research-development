/**
 * Per-player choice of which parts of the interface FlexUI Revived styles. Loaded on demand.
 */
import { MODULE_ID } from "../constants.mjs";
import { AREAS, normalizeAreas } from "../lib/stylesheet.mjs";
import { esc, injectStyle } from "./style.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class AreasApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-areas`,
    tag: "form",
    classes: ["flexui-revived-app", "standard-form"],
    window: { title: "FLEXUI.Areas.Title", icon: "fa-solid fa-table-cells-large" },
    position: { width: 460, height: "auto" },
    form: { handler: AreasApp.#onSubmit, closeOnSubmit: true }
  };

  static #instance;

  static open() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  async _renderHTML() {
    injectStyle();
    const t = key => esc(game.i18n.localize(key));
    const areas = normalizeAreas(game.settings.get(MODULE_ID, "areas"));
    const rows = AREAS.map(area => `<div class="form-group">
        <label for="${MODULE_ID}-area-${area}">${t(`FLEXUI.Areas.${area}.Name`)}</label>
        <div class="form-fields"><input type="checkbox" id="${MODULE_ID}-area-${area}" name="${area}"${areas[area] ? " checked" : ""}></div>
        <p class="hint">${t(`FLEXUI.Areas.${area}.Hint`)}</p>
      </div>`).join("");
    return `<p class="fxr-intro">${t("FLEXUI.Areas.Intro")}</p>
      ${rows}
      <footer class="form-footer"><button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${t("FLEXUI.Areas.Save")}</button></footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #onSubmit(event, form, formData) {
    const next = Object.fromEntries(AREAS.map(area => [area, Boolean(formData.object[area])]));
    await game.settings.set(MODULE_ID, "areas", next);
  }
}
