/**
 * Performance Triage entry point.
 *
 * Eagerly loaded code is kept to what has to run at startup: telemetry bootstrap, settings, profile application and
 * the idle throttle. Everything with UI (the report, the profile manager, the CPU sampler) is loaded with a dynamic
 * import only when someone opens it, so it costs nothing for players who never look.
 */
import { MODULE_ID, STORAGE_KEYS } from "./constants.mjs";
import { bootstrap, telemetry, sampleFps, rendererInfo } from "./telemetry.mjs";
import { PROFILES, PROFILE_IDS, resolveProfileId } from "./lib/profiles.mjs";
import { applyProfile } from "./profile-apply.mjs";
import { IdleThrottle } from "./idle.mjs";
// Imported here only so the browser discovers every eager file after parsing this one and fetches them in a single
// parallel wave, instead of finding them one nesting level (one round trip) at a time.
import "./lib/aggregate.mjs";
import "./lib/attribution.mjs";
import "./lib/hook-profiler.mjs";

bootstrap();

/** Record load history after the one-minute frame rate sample, so its result is included. */
const HISTORY_DELAY_MS = 65_000;

const state = {
  profileId: "none",
  setup: null,
  idle: null,
  renderScale: 1
};

/* -------------------------------------------- */
/*  Lazy UI                                     */
/* -------------------------------------------- */

async function openReport() {
  const { ReportApp } = await import("./apps/report-app.mjs");
  return ReportApp.open();
}

async function openProfiles() {
  const { ProfilesApp } = await import("./apps/profiles-app.mjs");
  return ProfilesApp.open();
}

/** @param {{tab?: "plan"|"tokens"}} [options]  "tokens" opens the count of tokens by actor */
async function openScenePlan(options) {
  const { ScenePlanApp } = await import("./apps/scene-plan-app.mjs");
  return ScenePlanApp.open(options);
}

/** Settings menus need a class at registration time; these stand-ins load the real application on demand. */
const { ApplicationV2 } = foundry.applications.api;

class ReportLauncher extends ApplicationV2 {
  render() {
    openReport();
    return this;
  }
}

class ProfilesLauncher extends ApplicationV2 {
  render() {
    openProfiles();
    return this;
  }
}

class ScenePlanLauncher extends ApplicationV2 {
  render() {
    openScenePlan();
    return this;
  }
}

/* -------------------------------------------- */
/*  Profile resolution                          */
/* -------------------------------------------- */

function isGMAtInit() {
  // game.user does not exist until documents are initialized, but the raw user data does
  const role = game.data.users?.find(u => u._id === game.userId)?.role ?? 0;
  return role >= CONST.USER_ROLES.ASSISTANT;
}

function effectiveProfileId() {
  return resolveProfileId({
    selfChoice: game.settings.get(MODULE_ID, "selfProfile"),
    assignments: game.settings.get(MODULE_ID, "assignments"),
    userId: game.userId,
    isGM: game.user?.isGM ?? isGMAtInit()
  });
}

function profileLabel(id) {
  return game.i18n.localize(`PTRIAGE.Profile.${id}.Name`);
}

async function promptReload(message) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("PTRIAGE.Reload.Title") },
    content: `<p>${message}</p>`,
    yes: { label: game.i18n.localize("PTRIAGE.Reload.Now"), icon: "fa-solid fa-rotate-right" },
    no: { label: game.i18n.localize("PTRIAGE.Reload.Later") },
    rejectClose: false
  });
  if ( confirmed ) foundry.utils.debouncedReload();
}

function onAssignmentsChanged() {
  const next = effectiveProfileId();
  if ( next === state.profileId ) return;
  promptReload(game.i18n.format("PTRIAGE.Reload.Assigned", { profile: profileLabel(next) }));
}

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

function registerSettings() {
  const choices = { gm: "PTRIAGE.Settings.SelfProfile.FollowGM" };
  for ( const id of PROFILE_IDS ) choices[id] = `PTRIAGE.Profile.${id}.Name`;

  game.settings.register(MODULE_ID, "selfProfile", {
    name: "PTRIAGE.Settings.SelfProfile.Name",
    hint: "PTRIAGE.Settings.SelfProfile.Hint",
    scope: "client",
    config: true,
    type: String,
    choices,
    default: "gm",
    requiresReload: true
  });
  game.settings.register(MODULE_ID, "shareSummary", {
    name: "PTRIAGE.Settings.ShareSummary.Name",
    hint: "PTRIAGE.Settings.ShareSummary.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "renderScale", {
    name: "PTRIAGE.Settings.RenderScale.Name",
    hint: "PTRIAGE.Settings.RenderScale.Hint",
    scope: "client",
    config: true,
    type: Number,
    choices: { 1: "100%", 0.85: "85%", 0.75: "75%", 0.6: "60%", 0.5: "50%" },
    default: 1,
    // Only read when the canvas is created, once per page load
    requiresReload: true
  });
  game.settings.register(MODULE_ID, "trackPlay", {
    name: "PTRIAGE.Settings.TrackPlay.Name",
    hint: "PTRIAGE.Settings.TrackPlay.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: value => togglePlayTracking(value)
  });
  game.settings.register(MODULE_ID, "assignments", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: onAssignmentsChanged
  });
  game.settings.register(MODULE_ID, "appliedProfile", { scope: "client", config: false, type: String, default: "none" });
  game.settings.register(MODULE_ID, "backup", { scope: "client", config: false, type: Object, default: {} });

  game.settings.registerMenu(MODULE_ID, "report", {
    name: "PTRIAGE.Menu.Report.Name",
    label: "PTRIAGE.Menu.Report.Label",
    hint: "PTRIAGE.Menu.Report.Hint",
    icon: "fa-solid fa-gauge-high",
    type: ReportLauncher,
    restricted: false
  });
  game.settings.registerMenu(MODULE_ID, "profiles", {
    name: "PTRIAGE.Menu.Profiles.Name",
    label: "PTRIAGE.Menu.Profiles.Label",
    hint: "PTRIAGE.Menu.Profiles.Hint",
    icon: "fa-solid fa-users-gear",
    type: ProfilesLauncher,
    restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "scenePlan", {
    name: "PTRIAGE.Menu.ScenePlan.Name",
    label: "PTRIAGE.Menu.ScenePlan.Label",
    hint: "PTRIAGE.Menu.ScenePlan.Hint",
    icon: "fa-solid fa-box-archive",
    type: ScenePlanLauncher,
    restricted: true
  });
}

/* -------------------------------------------- */
/*  Render scale                                */
/* -------------------------------------------- */

/**
 * Draw the canvas at fewer pixels than the screen has, and let the browser stretch it. Everything on the map is
 * still drawn (lights, weather, filters, animations), so it trades sharpness for GPU time: 75% draws a little over
 * half the pixels. canvasConfig (v13 and v14) passes the PIXI.Application options before the application exists,
 * so nothing has to be resized afterwards.
 */
function applyRenderScale(config) {
  const scale = Number(game.settings.get(MODULE_ID, "renderScale")) || 1;
  if ( (scale >= 1) || (scale <= 0) ) return;
  config.resolution = (config.resolution || 1) * scale;
  state.renderScale = scale;
}

/* -------------------------------------------- */
/*  Frame rate during play                      */
/* -------------------------------------------- */

/** Start or stop the play tracker; its code is only fetched while it is on. */
async function togglePlayTracking(on) {
  try {
    const tracker = await import("./play-tracker.mjs");
    if ( on ) tracker.startPlayTracker({ isThrottled: () => !!state.idle?.throttled });
    else tracker.stopPlayTracker();
  } catch(err) {
    console.warn(`${MODULE_ID} | Could not ${on ? "start" : "stop"} frame rate tracking`, err);
  }
}

/** The play summary an earlier load in this browser saved, if any. */
async function previousPlay() {
  if ( !globalThis.localStorage?.getItem(STORAGE_KEYS.play) ) return null;
  return (await import("./play-tracker.mjs")).previousPlay();
}

/* -------------------------------------------- */
/*  Client summary shared with the GM           */
/* -------------------------------------------- */

async function shareSummary() {
  const fps = await sampleFps(() => !!state.idle?.throttled);
  const summary = {
    v: 1,
    at: Date.now(),
    core: game.version,
    profile: state.profileId,
    // The ready hook fires before other modules' ready handlers run, so it can understate load time by half
    loadSeconds: Math.round((telemetry.marks.readyComplete ?? telemetry.marks.ready ?? 0) / 100) / 10,
    fps,
    cores: navigator.hardwareConcurrency ?? null,
    memory: navigator.deviceMemory ?? null,
    dpr: globalThis.devicePixelRatio ?? 1,
    screen: `${screen.width}x${screen.height}`,
    ...rendererInfo()
  };
  // Frame rate by scene from this browser's previous session, when the GM had tracking on then
  const play = await previousPlay().catch(() => null);
  if ( play ) summary.play = { at: play.at, scenes: play.scenes, moves: play.moves };
  try {
    await game.user.update({ [`flags.${MODULE_ID}.summary`]: summary }, { render: false });
  } catch(err) {
    console.warn(`${MODULE_ID} | Could not share performance summary`, err);
  }
}

/* -------------------------------------------- */
/*  Lifecycle                                   */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  Hooks.once("canvasConfig", applyRenderScale);
  state.profileId = effectiveProfileId();
  const profile = PROFILES[state.profileId];

  // Fewer chat messages rendered at startup; older ones still load when scrolling up
  if ( profile.chatBatchSize && CONFIG.ChatMessage && (CONFIG.ChatMessage.batchSize > profile.chatBatchSize) ) {
    CONFIG.ChatMessage.batchSize = profile.chatBatchSize;
  }

  game.modules.get(MODULE_ID).api = {
    openReport,
    openProfiles,
    openScenePlan,
    telemetry,
    get profileId() { return state.profileId; },
    get renderScale() { return state.renderScale; },
    get idle() { return state.idle?.status() ?? null; },
    suspendIdle: suspended => state.idle?.suspend(suspended),
    collectReport: async () => (await import("./audit.mjs")).collectReport(),
    measureFrameCost: async () => (await import("./frame-cost.mjs")).measureFrameCost(),
    recordCpuProfile: async seconds => (await import("./sampler.mjs")).recordProfile(seconds)
  };
});

/** A failed profile application must never stop the rest of startup. */
async function safeApply(phase) {
  try {
    return await applyProfile(state.profileId, phase);
  } catch(err) {
    console.error(`${MODULE_ID} | Could not apply profile "${state.profileId}" during ${phase}`, err);
    return { changed: [], deferred: [], needsReload: false };
  }
}

Hooks.once("setup", () => {
  const applied = game.settings.get(MODULE_ID, "appliedProfile");
  if ( (state.profileId === "none") && (applied === "none") ) return; // Nothing to apply or revert
  // Not awaited: Foundry does not await hooks. Every storage write happens synchronously before the first await.
  state.setup = safeApply("setup");
});

Hooks.once("ready", async () => {
  const profile = PROFILES[state.profileId];
  if ( state.setup ) {
    const first = await state.setup;
    const late = await safeApply("ready");
    const changed = [...first.changed, ...late.changed];
    if ( first.needsReload || late.needsReload ) {
      promptReload(game.i18n.format("PTRIAGE.Reload.Applied", { profile: profileLabel(state.profileId) }));
    } else if ( changed.length ) {
      ui.notifications.info(game.i18n.format("PTRIAGE.Notify.Applied", { profile: profileLabel(state.profileId) }));
    }
  }

  if ( profile.idle && globalThis.canvas?.app ) state.idle = new IdleThrottle(profile.idle).start();

  if ( telemetry.hookProfiler?.installed ) ui.notifications.warn(game.i18n.localize("PTRIAGE.Notify.ProfilerActive"));

  if ( game.settings.get(MODULE_ID, "trackPlay") ) togglePlayTracking(true);

  if ( game.settings.get(MODULE_ID, "shareSummary") ) shareSummary();

  // One local entry per load for the report's load history; a single timer, a minute after ready
  setTimeout(() => {
    import("./history.mjs").then(m => m.recordLoad(state.profileId))
      .catch(err => console.warn(`${MODULE_ID} | Could not record load history`, err));
  }, HISTORY_DELAY_MS);
});
