/**
 * GM window listing which scene folders to move to a compendium and what to prepare first. Loaded on demand.
 */
import { MODULE_ID } from "../constants.mjs";
import { collectScenePlan } from "../scene-plan.mjs";
import { benchmarkActors } from "../audit.mjs";
import { scenePlanToHtml, scenePlanToMarkdown } from "../lib/scene-plan.mjs";
import { injectStyle } from "./style.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** Give the browser a frame to show a notification before a long synchronous step. */
const nextFrame = () => new Promise(resolve => setTimeout(() => resolve(), 50));

export class ScenePlanApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-scene-plan`,
    classes: ["ptriage", "ptriage-plan"],
    window: { title: "PTRIAGE.ScenePlan.Title", icon: "fa-solid fa-box-archive", resizable: true },
    position: { width: 1000, height: 780 },
    actions: {
      refresh: ScenePlanApp.#onRefresh,
      copyMarkdown: ScenePlanApp.#onCopyMarkdown,
      timeActors: ScenePlanApp.#onTimeActors
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

  #measuredMs = null;

  /** Sections the GM has expanded, kept across refreshes. */
  #open = new Set(["areas"]);

  async _prepareContext() {
    if ( !this.plan ) {
      ui.notifications.info(game.i18n.localize("PTRIAGE.ScenePlan.Measuring"));
      await nextFrame();
      const t0 = performance.now();
      this.plan = collectScenePlan();
      this.#measuredMs = performance.now() - t0;
    }
    return { plan: this.plan };
  }

  async _renderHTML({ plan }) {
    injectStyle();
    return scenePlanToHtml(plan, { open: this.#open, measuredMs: this.#measuredMs });
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    for ( const el of content.querySelectorAll("details[data-section]") ) {
      el.addEventListener("toggle", () => {
        if ( el.open ) this.#open.add(el.dataset.section);
        else this.#open.delete(el.dataset.section);
      });
    }
  }

  static #onRefresh() {
    this.plan = null;
    return this.render();
  }

  static async #onCopyMarkdown() {
    await game.clipboard.copyPlainText(scenePlanToMarkdown(this.plan));
    ui.notifications.info(game.i18n.localize("PTRIAGE.ScenePlan.Copied"));
  }

  static async #onTimeActors(event, target) {
    target.disabled = true;
    ui.notifications.info(game.i18n.localize("PTRIAGE.Report.TimingActors"));
    await nextFrame();
    await benchmarkActors();
    this.plan = null;
    return this.render();
  }
}
