export const MODULE_ID = "dal-segno";

/**
 * How far ahead a control change takes effect, in milliseconds. Every client must receive the new deck before then,
 * so they all switch at the same moment; a client that receives it late catches up with a short crossfade.
 */
export const LEAD_MS = 600;

/** Lead for starting a track that clients may still have to load. */
export const START_LEAD_MS = 1200;

/** The core setting holding each channel's volume slider. */
export const VOLUME_SETTINGS = { music: "globalPlaylistVolume", environment: "globalAmbientVolume", interface: "globalInterfaceVolume" };

/** The one flag this module writes, on PlaylistSound documents: {sections, seam, duration}. */
export const ARRANGEMENT_FLAG = "arrangement";
