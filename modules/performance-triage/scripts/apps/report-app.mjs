/**
 * The diagnostics report window. Loaded on demand; renders static HTML once per refresh, with no templates to fetch.
 */
import { MODULE_ID, STORAGE_KEYS } from "../constants.mjs";
import { telemetry, readStorageFlag, writeStorageFlag } from "../telemetry.mjs";
import { collectReport, benchmarkActors } from "../audit.mjs";
import { samplerSupport, recordProfile } from "../sampler.mjs";
import { reportToHtml, reportToMarkdown } from "../lib/report-format.mjs";
import { injectStyle } from "./style.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

export class ReportApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-report`,
    classes: ["ptriage"],
    window: { title: "PTRIAGE.Report.Title", icon: "fa-solid fa-gauge-high", resizable: true },
    position: { width: 900, height: 760 },
    actions: {
      refresh: ReportApp.#onRefresh,
      copyMarkdown: ReportApp.#onCopyMarkdown,
      downloadJson: ReportApp.#onDownloadJson,
      toggleHookProfiler: ReportApp.#onToggleHookProfiler,
      resetHooks: ReportApp.#onResetHooks,
      recordProfile: ReportApp.#onRecordProfile,
      benchmarkActors: ReportApp.#onBenchmarkActors,
      openProfiles: () => game.modules.get(MODULE_ID).api.openProfiles()
    }
  };

  static #instance;

  static open() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  /** The collected report; cleared to force re-collection on the next render. */
  report = null;

  /** Sections the user has expanded, kept across refreshes. */
  #open = new Set(["timeline"]);

  async _prepareContext() {
    this.report ??= await collectReport();
    return { report: this.report };
  }

  async _renderHTML(context) {
    injectStyle();
    return reportToHtml(context.report, { sampler: samplerSupport(), open: this.#open });
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

  #refresh() {
    this.report = null;
    return this.render();
  }

  static #onRefresh() {
    return this.#refresh();
  }

  static async #onCopyMarkdown() {
    await game.clipboard.copyPlainText(reportToMarkdown(this.report, { sampler: samplerSupport() }));
    ui.notifications.info(game.i18n.localize("PTRIAGE.Report.Copied"));
  }

  static #onDownloadJson() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    foundry.utils.saveDataToFile(JSON.stringify(this.report, null, 2), "application/json", `performance-triage-${stamp}.json`);
  }

  static async #onToggleHookProfiler() {
    const enable = !readStorageFlag(STORAGE_KEYS.hookProfiler);
    writeStorageFlag(STORAGE_KEYS.hookProfiler, enable);
    const reload = await DialogV2.confirm({
      window: { title: game.i18n.localize("PTRIAGE.Reload.Title") },
      content: `<p>${game.i18n.localize(enable ? "PTRIAGE.Report.ProfilerOn" : "PTRIAGE.Report.ProfilerOff")}</p>`,
      rejectClose: false
    });
    if ( reload ) foundry.utils.debouncedReload();
  }

  static #onResetHooks() {
    telemetry.hookProfiler?.reset();
    return this.#refresh();
  }

  static async #onRecordProfile(event, target) {
    target.disabled = true;
    ui.notifications.info(game.i18n.localize("PTRIAGE.Report.Recording"));
    try {
      await recordProfile(20);
    } catch(err) {
      ui.notifications.error(game.i18n.localize("PTRIAGE.Report.RecordFailed"));
      console.error(err);
    }
    this.#open.add("cpu");
    return this.#refresh();
  }

  static async #onBenchmarkActors(event, target) {
    target.disabled = true;
    await benchmarkActors();
    this.#open.add("world");
    return this.#refresh();
  }
}
