/**
 * GM window with two tabs: which scene folders to move to a compendium and what to prepare first, and where each
 * actor's tokens are across the world's scenes. Loaded on demand.
 */
import { MODULE_ID } from "../constants.mjs";
import { collectScenePlan, collectTokenCensus } from "../scene-plan.mjs";
import { benchmarkActors } from "../audit.mjs";
import { scenePlanToHtml, scenePlanToMarkdown } from "../lib/scene-plan.mjs";
import { censusToHtml, matchesFilter, SORT_KEYS } from "../lib/token-census.mjs";
import { esc } from "../lib/report-format.mjs";
import { injectStyle } from "./style.mjs";

const { ApplicationV2 } = foundry.applications.api;

const TABS = { plan: "Archive plan", tokens: "Tokens by actor" };

/** Tokens are often pasted or deleted in groups; recount once a burst settles instead of once per token. */
const RECOUNT_MS = 300;

/** Give the browser a frame to show a notification before a long synchronous step. */
const nextFrame = () => new Promise(resolve => setTimeout(() => resolve(), 50));

export class ScenePlanApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-scene-plan`,
    classes: ["ptriage", "ptriage-plan"],
    window: { title: "PTRIAGE.ScenePlan.Title", icon: "fa-solid fa-box-archive", resizable: true },
    position: { width: 1000, height: 780 },
    actions: {
      // Not "tab": ApplicationV2 handles that action itself, for tab groups
      switchTab: ScenePlanApp.#onSwitchTab,
      refresh: ScenePlanApp.#onRefresh,
      copyMarkdown: ScenePlanApp.#onCopyMarkdown,
      timeActors: ScenePlanApp.#onTimeActors,
      sortCensus: ScenePlanApp.#onSortCensus,
      toggleActor: ScenePlanApp.#onToggleActor,
      showToken: ScenePlanApp.#onShowToken
    }
  };

  static #instance;

  /** @param {{tab?: "plan"|"tokens"}} [options] */
  static open({ tab } = {}) {
    if ( !game.user.isGM ) return null;
    this.#instance ??= new this();
    if ( tab in TABS ) this.#instance.tab = tab;
    return this.#instance.render({ force: true });
  }

  tab = "plan";

  /** The current plan and token count; each is cleared to force re-collection on the next render. */
  plan = null;
  census = null;

  #measuredMs = null;
  #countedMs = null;

  /** Plan sections and census actors the GM has expanded, kept across refreshes. */
  #open = new Set(["areas"]);
  #expanded = new Set();

  #sort = { key: "tokens" };
  #filter = { text: "", players: false };

  /** Token hooks, only registered while the token count is open. */
  #hooks = null;
  #recount = null;
  #shownTab = null;

  async _prepareContext() {
    if ( (this.tab === "plan") && !this.plan ) {
      ui.notifications.info(game.i18n.localize("PTRIAGE.ScenePlan.Measuring"));
      await nextFrame();
      const t0 = performance.now();
      this.plan = await collectScenePlan();
      this.#measuredMs = performance.now() - t0;
    }
    if ( (this.tab === "tokens") && !this.census ) {
      const t0 = performance.now();
      this.census = collectTokenCensus();
      this.#countedMs = performance.now() - t0;
      this.#watchTokens();
    }
    return { tab: this.tab, plan: this.plan, census: this.census };
  }

  async _renderHTML({ tab, plan, census }) {
    injectStyle();
    const nav = Object.entries(TABS).map(([id, label]) => `<button type="button" data-action="switchTab" data-tab="${id}"`
      + `${id === tab ? " class=\"active\" aria-pressed=\"true\"" : ""}>${esc(label)}</button>`).join("");
    const body = (tab === "tokens")
      ? censusToHtml(census, { sort: this.#sort, expanded: this.#expanded, filter: this.#filter, measuredMs: this.#countedMs })
      : scenePlanToHtml(plan, { open: this.#open, measuredMs: this.#measuredMs });
    return `<nav class="ptriage-tabs">${nav}</nav>${body}`;
  }

  _replaceHTML(result, content) {
    // Re-rendering the same tab (a sort, or a recount after deleting a token) keeps the GM's place in the list
    const top = (this.#shownTab === this.tab) ? content.scrollTop : 0;
    content.innerHTML = result;
    content.scrollTop = top;
    this.#shownTab = this.tab;
    for ( const el of content.querySelectorAll("details[data-section]") ) {
      el.addEventListener("toggle", () => {
        if ( el.open ) this.#open.add(el.dataset.section);
        else this.#open.delete(el.dataset.section);
      });
    }
    // Filtering only hides rows, so typing never re-renders or loses focus
    const text = content.querySelector("input[name=censusText]");
    const players = content.querySelector("input[name=censusPlayers]");
    if ( !text || !players ) return;
    text.addEventListener("input", () => {
      this.#filter.text = text.value;
      this.#applyFilter(content);
    });
    players.addEventListener("change", () => {
      this.#filter.players = players.checked;
      this.#applyFilter(content);
    });
    this.#applyFilter(content);
  }

  #applyFilter(content) {
    let shown = 0;
    for ( const body of content.querySelectorAll("tbody[data-actor]") ) {
      const match = matchesFilter({ search: body.dataset.search, player: body.dataset.player === "1" }, this.#filter);
      body.hidden = !match;
      if ( match ) shown++;
    }
    const empty = content.querySelector(".ptriage-census-empty");
    if ( empty ) empty.hidden = shown > 0;
  }

  /** Keep the count current while the GM clears out tokens; token creation and deletion are rare events. */
  #watchTokens() {
    if ( this.#hooks ) return;
    const recount = () => {
      this.census = null;
      clearTimeout(this.#recount);
      this.#recount = setTimeout(() => {
        if ( this.rendered && (this.tab === "tokens") ) this.render();
      }, RECOUNT_MS);
    };
    this.#hooks = ["createToken", "deleteToken"].map(hook => [hook, Hooks.on(hook, recount)]);
  }

  _onClose(options) {
    super._onClose(options);
    for ( const [hook, id] of this.#hooks ?? [] ) Hooks.off(hook, id);
    this.#hooks = null;
    clearTimeout(this.#recount);
    // Without the hooks the count would go stale, so it is taken again next time
    this.census = null;
  }

  static #onSwitchTab(event, target) {
    if ( !(target.dataset.tab in TABS) ) return;
    this.tab = target.dataset.tab;
    return this.render();
  }

  static #onRefresh() {
    if ( this.tab === "tokens" ) this.census = null;
    else this.plan = null;
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

  static #onSortCensus(event, target) {
    const key = target.dataset.key;
    if ( !(key in SORT_KEYS) ) return;
    // A second click on the same column reverses it
    const dir = this.#sort.dir ?? SORT_KEYS[this.#sort.key];
    this.#sort = (this.#sort.key === key) ? { key, dir: (dir === "asc") ? "desc" : "asc" } : { key };
    return this.render();
  }

  static #onToggleActor(event, target) {
    const body = target.closest("tbody[data-actor]");
    const detail = body?.querySelector(".ptriage-census-detail");
    if ( !detail ) return;
    const id = body.dataset.actor;
    const open = !this.#expanded.has(id);
    if ( open ) this.#expanded.add(id);
    else this.#expanded.delete(id);
    detail.hidden = !open;
    target.setAttribute("aria-expanded", String(open));
    target.querySelector("i.fa-solid")?.classList.replace(open ? "fa-caret-right" : "fa-caret-down",
      open ? "fa-caret-down" : "fa-caret-right");
  }

  /** View the token's scene (for the GM only; players stay where they are), select the token and centre on it. */
  static async #onShowToken(event, target) {
    const { scene: sceneId, token: tokenId } = target.dataset;
    const scene = game.scenes.get(sceneId);
    if ( !scene?.tokens.get(tokenId) ) return ui.notifications.warn(game.i18n.localize("PTRIAGE.Census.Gone"));
    if ( game.settings.get("core", "noCanvas") ) return ui.notifications.warn(game.i18n.localize("PTRIAGE.Census.NoCanvas"));
    // Scene#view warns by itself if the canvas is still drawing another scene
    if ( canvas.scene?.id !== sceneId ) await scene.view();
    if ( canvas.scene?.id !== sceneId ) return;
    const token = canvas.tokens?.get(tokenId);
    if ( !token ) return ui.notifications.warn(game.i18n.localize("PTRIAGE.Census.Gone"));
    // On the token layer, so the Delete key removes the selected token whatever tool the GM had open
    canvas.tokens.activate();
    token.control({ releaseOthers: true });
    // Out of the way so the token is visible; clicking the title bar brings the window back
    await this.minimize();
    return canvas.animatePan({ x: token.center.x, y: token.center.y, scale: Math.max(canvas.stage.scale.x, 1) });
  }
}
