/**
 * GM window listing which scenes to move to a compendium and what to prepare first. Loaded on demand.
 */
import { MODULE_ID } from "../constants.mjs";
import { collectScenePlan } from "../scene-plan.mjs";
import { scenePlanToHtml, scenePlanToMarkdown } from "../lib/scene-plan.mjs";
import { injectStyle } from "./style.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class ScenePlanApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-scene-plan`,
    classes: ["ptriage", "ptriage-plan"],
    window: { title: "PTRIAGE.ScenePlan.Title", icon: "fa-solid fa-box-archive", resizable: true },
    position: { width: 1000, height: 760 },
    actions: {
      refresh: ScenePlanApp.#onRefresh,
      copyMarkdown: ScenePlanApp.#onCopyMarkdown
    }
  };

  static #instance;

  static open() {
    if ( !game.user.isGM ) return null;
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  /** The current plan; cleared to force re-collection on the next render. */
  plan = null;

  async _prepareContext() {
    this.plan ??= collectScenePlan();
    return { plan: this.plan };
  }

  async _renderHTML({ plan }) {
    injectStyle();
    return scenePlanToHtml(plan);
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static #onRefresh() {
    this.plan = null;
    return this.render();
  }

  static async #onCopyMarkdown() {
    await game.clipboard.copyPlainText(scenePlanToMarkdown(this.plan));
    ui.notifications.info(game.i18n.localize("PTRIAGE.ScenePlan.Copied"));
  }
}
