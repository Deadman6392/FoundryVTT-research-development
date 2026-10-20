/**
 * Pure helpers that map URLs and stack traces to the Foundry package responsible for them.
 * No Foundry globals are referenced here so the logic can be unit tested in Node.
 */

/** Matches /modules/<id>/, /systems/<id>/ or /worlds/<id>/ anywhere in a path (route prefixes are allowed). */
const PACKAGE_PATH = /\/(modules|systems|worlds)\/([^/?#]+)\//;

const TYPE_FOR_DIR = { modules: "module", systems: "system", worlds: "world" };

const MEDIA_EXT = /\.(png|jpe?g|webp|avif|gif|svg|bmp|tiff?|webm|mp4|m4v|ogv|mov|ogg|oga|mp3|wav|flac|m4a|opus)(\?|#|$)/i;

/** Text resources that should always be served compressed. */
const TEXT_EXT = /\.(m?js|css|json|hbs|html?|txt|xml|svg|map)(\?|#|$)/i;

/** Packages that sit between callers and callees and should not be blamed for the work they forward. */
export const TRANSPARENT_PACKAGES = new Set(["module:lib-wrapper"]);

/**
 * Classify a resource URL.
 * @param {string} url
 * @param {string} [origin]   The page origin. Resources from other origins are reported as external.
 * @returns {string}          A key such as "module:midi-qol", "system:dnd5e", "core", "media" or "external:host"
 */
export function packageFromUrl(url, origin) {
  if ( !url ) return "unknown";
  let path = url;
  let host = null;
  try {
    const u = new URL(url, origin ?? "http://localhost/");
    path = decodeURIComponent(u.pathname);
    if ( origin && (u.origin !== new URL(origin).origin) ) host = u.host;
  } catch {
    // Not a parseable URL, fall through and test the raw string
  }
  if ( host ) return `external:${host}`;
  const m = PACKAGE_PATH.exec(path);
  if ( m ) return `${TYPE_FOR_DIR[m[1]]}:${m[2]}`;
  if ( MEDIA_EXT.test(path) ) return "media";
  return "core";
}

/** Is this URL a text resource that benefits from HTTP compression? */
export function isTextResource(url) {
  return TEXT_EXT.test(url ?? "");
}

/** Is this URL a media file (image, video, audio)? */
export function isMediaResource(url) {
  return MEDIA_EXT.test(url ?? "");
}

/** Extract the script URL from a single stack frame line (V8 and SpiderMonkey/JSC formats). */
const FRAME_URL = /((?:https?|file):\/\/[^\s()]+?)(?::\d+){1,2}\)?\s*$/;

/**
 * Find the package that called into the profiler, skipping frames that belong to the profiler itself.
 * @param {string} stack       An Error#stack string
 * @param {string} selfKey     The package key of the calling module, e.g. "module:performance-triage"
 * @param {string} [origin]
 * @returns {string}           The first package key which is not selfKey, or selfKey when only our frames exist
 */
export function packageFromStack(stack, selfKey, origin) {
  if ( !stack ) return "unknown";
  let sawSelf = false;
  for ( const line of stack.split("\n") ) {
    const m = FRAME_URL.exec(line);
    if ( !m ) continue;
    const key = packageFromUrl(m[1], origin);
    if ( key === selfKey ) {
      sawSelf = true;
      continue;
    }
    return key;
  }
  return sawSelf ? selfKey : "unknown";
}

/** Split a package key into its parts for display. */
export function splitKey(key) {
  const i = key.indexOf(":");
  if ( i < 0 ) return { type: key, id: key };
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}
