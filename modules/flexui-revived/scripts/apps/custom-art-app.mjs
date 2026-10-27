/**
 * GM window for a folder of the table's own theme images. The folder is listed once, here, and the matches are
 * stored in a world setting, so players never need permission to browse files and no client looks anything up at
 * startup. Loaded on demand.
 */
import { MODULE_ID } from "../constants.mjs";
import { ART_ROLES, matchArtFiles } from "../lib/art.mjs";
import { esc, injectStyle } from "./style.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class CustomArtApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-custom-art`,
    tag: "form",
    classes: ["flexui-revived-app", "standard-form"],
    window: { title: "FLEXUI.CustomArt.Title", icon: "fa-solid fa-folder-open", resizable: true },
    position: { width: 560, height: "auto" },
    form: { handler: CustomArtApp.#onSubmit, closeOnSubmit: false },
    actions: { clear: CustomArtApp.#onClear }
  };

  static #instance;

  static open() {
    if ( !game.user.isGM ) return null;
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  async _renderHTML() {
    injectStyle();
    const t = key => esc(game.i18n.localize(key));
    const stored = game.settings.get(MODULE_ID, "customArt") ?? { folder: "", files: {} };
    const files = stored.files ?? {};
    const found = ART_ROLES.filter(role => files[role]).length;
    const roles = ART_ROLES.map(role => {
      const has = Boolean(files[role]);
      return `<li class="${has ? "found" : "missing"}" title="${esc(files[role] ?? "")}">`
        + `<i class="fa-solid ${has ? "fa-check" : "fa-minus"} fa-fw"></i> ${role}</li>`;
    }).join("");
    const usingCustom = game.settings.get(MODULE_ID, "artwork") === "custom";
    return `<p class="fxr-intro">${t("FLEXUI.CustomArt.Intro")}</p>
      <div class="form-group">
        <label>${t("FLEXUI.CustomArt.Folder")}</label>
        <div class="form-fields"><file-picker name="folder" type="folder" value="${esc(stored.folder)}"></file-picker></div>
        <p class="hint">${t("FLEXUI.CustomArt.FolderHint")}</p>
      </div>
      <p>${esc(game.i18n.format("FLEXUI.CustomArt.Found", { found, total: ART_ROLES.length }))}</p>
      <ul class="fxr-roles">${roles}</ul>
      ${usingCustom ? "" : `<p class="hint"><i class="fa-solid fa-circle-info"></i> ${t("FLEXUI.CustomArt.NotSelected")}</p>`}
      <footer class="form-footer">
        <button type="submit"><i class="fa-solid fa-magnifying-glass"></i> ${t("FLEXUI.CustomArt.Scan")}</button>
        <button type="button" data-action="clear"><i class="fa-solid fa-eraser"></i> ${t("FLEXUI.CustomArt.Clear")}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #onSubmit(event, form, formData) {
    const folder = String(formData.object.folder ?? "").trim().replace(/\/+$/, "");
    if ( !folder ) return CustomArtApp.#onClear.call(this);
    let listing;
    try {
      listing = await foundry.applications.apps.FilePicker.implementation.browse("data", folder);
    } catch(err) {
      ui.notifications.error(game.i18n.format("FLEXUI.CustomArt.ReadFailed", { folder, error: err?.message ?? err }));
      return;
    }
    const files = matchArtFiles(listing.files ?? []);
    await game.settings.set(MODULE_ID, "customArt", { folder, files });
    ui.notifications.info(game.i18n.format("FLEXUI.CustomArt.Saved", { found: Object.keys(files).length, total: ART_ROLES.length }));
    this.render();
  }

  static async #onClear() {
    await game.settings.set(MODULE_ID, "customArt", { folder: "", files: {} });
    this.render();
  }
}
