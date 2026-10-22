export const MODULE_ID = "performance-triage";

/** Package key used by attribution helpers for this module's own code. */
export const SELF_KEY = `module:${MODULE_ID}`;

/**
 * Raw localStorage keys owned by this module. They are read before Foundry's settings are registered, so they live
 * outside the settings API. The colon keeps them from looking like a "namespace.key" setting.
 */
export const STORAGE_KEYS = {
  hookProfiler: `${MODULE_ID}:hookProfiler`,
  history: `${MODULE_ID}:history`,
  play: `${MODULE_ID}:play`
};
