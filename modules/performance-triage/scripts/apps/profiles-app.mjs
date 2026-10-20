/**
 * GM window for assigning performance profiles to users. Loaded on demand.
 */
import { MODULE_ID } from "../constants.mjs";
import { PROFILES, PROFILE_IDS, suggestProfile } from "../lib/profiles.mjs";
import { describeSummary } from "../lib/recommend.mjs";
import { esc } from "../lib/report-format.mjs";
import { injectStyle } from "./style.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class ProfilesApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-profiles`,
    tag: "form",
    classes: ["ptriage", "ptriage-profiles"],
    window: { title: "PTRIAGE.Profiles.Title", icon: "fa-solid fa-users-gear", resizable: true },
    position: { width: 820, height: "auto" },
    form: { handler: ProfilesApp.#onSubmit, closeOnSubmit: true }
  };

  static #instance;

  static open() {
    if ( !game.user.isGM ) return null;
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  async _prepareContext() {
    return {
      assignments: game.settings.get(MODULE_ID, "assignments") ?? {},
      users: game.users.contents
    };
  }

  async _renderHTML({ assignments, users }) {
    injectStyle();
    const t = key => esc(game.i18n.localize(key));
    const options = (selected, includeDefault) => {
      const ids = includeDefault ? ["default", ...PROFILE_IDS] : PROFILE_IDS;
      return ids.map(id => {
        const label = id === "default" ? t("PTRIAGE.Profiles.UseDefault") : t(`PTRIAGE.Profile.${id}.Name`);
        return `<option value="${id}"${id === selected ? " selected" : ""}>${label}</option>`;
      }).join("");
    };

    const rows = users.map(u => {
      const summary = u.getFlag(MODULE_ID, "summary");
      const suggestion = suggestProfile(summary);
      const running = summary?.profile ? t(`PTRIAGE.Profile.${summary.profile}.Name`) : "–";
      return `<tr>
        <td><strong>${esc(u.name)}</strong>${u.isGM ? " (GM)" : ""}${u.active ? ` <i class="fa-solid fa-circle" style="color:#3a3;font-size:0.6em" title="online"></i>` : ""}
          <div class="ptriage-summary">${esc(describeSummary(summary))}</div></td>
        <td>${running}</td>
        <td>${suggestion ? t(`PTRIAGE.Profile.${suggestion}.Name`) : "–"}</td>
        <td><select name="assign.${esc(u.id)}">${options(assignments[u.id] ?? "default", true)}</select></td>
      </tr>`;
    }).join("");

    const profileRows = PROFILE_IDS.filter(id => id !== "none").map(id => {
      const p = PROFILES[id];
      const settings = Object.entries(p.settings).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ");
      const idle = p.idle ? `idle ${p.idle.fps} fps after ${p.idle.delay} s` : "no idle throttle";
      return `<tr><td><strong>${t(`PTRIAGE.Profile.${id}.Name`)}</strong><div class="ptriage-summary">${t(`PTRIAGE.Profile.${id}.Hint`)}</div></td>
        <td class="ptriage-summary">${esc(settings)}; chat batch ${p.chatBatchSize}; ${esc(idle)}</td></tr>`;
    }).join("");

    return `<p>${t("PTRIAGE.Profiles.Intro")}</p>
      <div class="form-group">
        <label>${t("PTRIAGE.Profiles.Default")}</label>
        <select name="assign.*">${options(assignments["*"] ?? "none", false)}</select>
      </div>
      <table class="ptriage-table">
        <thead><tr><th>${t("PTRIAGE.Profiles.User")}</th><th>${t("PTRIAGE.Profiles.Running")}</th>
          <th>${t("PTRIAGE.Profiles.Suggested")}</th><th>${t("PTRIAGE.Profiles.Assigned")}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <details><summary>${t("PTRIAGE.Profiles.WhatTheyDo")}</summary>
        <table class="ptriage-table"><tbody>${profileRows}</tbody></table>
      </details>
      <footer><button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${t("PTRIAGE.Profiles.Save")}</button></footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #onSubmit(event, form, formData) {
    const assign = foundry.utils.expandObject(formData.object).assign ?? {};
    const next = {};
    for ( const [userId, profileId] of Object.entries(assign) ) {
      if ( (profileId === "default") || !PROFILES[profileId] ) continue;
      if ( (userId === "*") && (profileId === "none") ) continue;
      next[userId] = profileId;
    }
    await game.settings.set(MODULE_ID, "assignments", next);
    ui.notifications.info(game.i18n.localize("PTRIAGE.Profiles.Saved"));
  }
}
