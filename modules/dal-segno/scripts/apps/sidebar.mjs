/**
 * Small additions to Foundry's Playlists sidebar: for the GM, a button that opens the deck and a disc on each sound
 * that loads it into the deck; for everyone while the deck has a track, a line saying what it is playing. Sounds with
 * saved sections are marked. Loaded the first time the Playlists tab renders for a GM, or for a player once the deck
 * has a track; the sidebar's own rows and controls are left alone.
 */
import { ARRANGEMENT_FLAG, MODULE_ID } from "../constants.mjs";
import { esc, injectStyle } from "./style.mjs";

/**
 * Add (or refresh) the deck's controls in a rendered Playlists directory. Safe to call on every render.
 * @param {HTMLElement} root
 * @param {object} api   The module API
 */
export function decorate(root, api) {
  if ( !root ) return;
  injectStyle();
  const t = key => esc(game.i18n.localize(key));
  if ( game.user.isGM ) {
    if ( !root.querySelector(".dal-segno-open") ) {
      const actions = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dal-segno-open";
      button.innerHTML = `<i class="fa-solid fa-compact-disc"></i> ${t("DALSEGNO.Sidebar.Open")}`;
      if ( actions ) actions.append(button);
      else root.prepend(button);
    }
    for ( const li of root.querySelectorAll("li.sound[data-sound-id]") ) markSound(li, t);
  }
  showNowPlaying(root, api, t);
  if ( !root.dataset.dalSegno ) {
    root.dataset.dalSegno = "1";
    // Capture, so a click on the deck's own controls is handled before (and never reaches) the directory's handlers
    root.addEventListener("click", event => onClick(event, api), true);
  }
}

function soundFor(li) {
  const playlistId = li.dataset.playlistId ?? li.closest("[data-entry-id]")?.dataset.entryId;
  return game.playlists.get(playlistId)?.sounds.get(li.dataset.soundId) ?? null;
}

function markSound(li, t) {
  if ( li.querySelector(".dal-segno-load") ) return;
  const sound = soundFor(li);
  if ( !sound ) return;
  const controls = li.querySelector(".sound-controls") ?? li;
  const load = document.createElement("a");
  load.className = "inline-control sound-control dal-segno-load";
  load.dataset.tooltip = game.i18n.localize("DALSEGNO.Sidebar.Load");
  load.setAttribute("aria-label", load.dataset.tooltip);
  load.innerHTML = "<i class=\"fa-solid fa-compact-disc\"></i>";
  controls.prepend(load);
  if ( sound.getFlag(MODULE_ID, ARRANGEMENT_FLAG) ) {
    const name = li.querySelector(".sound-name, .name") ?? li;
    const mark = document.createElement("i");
    mark.className = "fa-solid fa-sliders dal-segno-mark";
    mark.dataset.tooltip = t("DALSEGNO.Sidebar.Arranged");
    name.append(mark);
  }
}

function showNowPlaying(root, api, t) {
  const deck = api.deck;
  let line = root.querySelector(".dal-segno-now");
  if ( !deck?.track ) {
    line?.remove();
    return;
  }
  if ( !line ) {
    line = document.createElement("div");
    line.className = "dal-segno-now";
    const header = root.querySelector(".directory-header");
    if ( header ) header.after(line);
    else root.prepend(line);
  }
  const status = deck.transport.status;
  line.innerHTML = `<i class="fa-solid fa-compact-disc"></i><span class="dsg-name">${esc(deck.track.name)}</span>`
    + `<span class="dsg-state">${t(`DALSEGNO.Status.${status}`)}</span>`;
  line.dataset.tooltip = game.i18n.localize("DALSEGNO.Sidebar.NowPlaying");
}

function onClick(event, api) {
  if ( event.target.closest(".dal-segno-open") ) {
    event.stopPropagation();
    api.openDeck();
    return;
  }
  const load = event.target.closest(".dal-segno-load");
  if ( !load ) return;
  event.preventDefault();
  event.stopPropagation();
  const sound = soundFor(load.closest("li.sound"));
  if ( !sound ) return;
  // Shift-click plays at once; a plain click cues it so every client loads it, ready to start without a wait
  api.load(sound, { play: event.shiftKey });
  api.openDeck();
}
