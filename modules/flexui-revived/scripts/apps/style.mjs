/**
 * Helpers for this module's two settings windows, injected the first time one opens instead of shipping a stylesheet
 * every client would download at startup.
 */
const STYLE_ID = "flexui-revived-app-style";

const CSS = `
.flexui-revived-app .window-content { padding: 0.5rem 0.75rem; gap: 0.5rem; }
.flexui-revived-app .fxr-intro { margin: 0 0 0.25rem; }
.flexui-revived-app .form-group { align-items: flex-start; }
.flexui-revived-app .form-group .hint { flex: 0 0 100%; margin: 0.1rem 0 0.35rem; }
.flexui-revived-app .fxr-roles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.1rem 0.75rem;
  margin: 0.25rem 0; padding: 0; list-style: none; font-family: var(--font-monospace, monospace); font-size: 0.85em; }
.flexui-revived-app .fxr-roles .found { font-weight: bold; }
.flexui-revived-app .fxr-roles .missing { opacity: 0.55; }
.flexui-revived-app footer { display: flex; gap: 0.5rem; }
`;

export function injectStyle() {
  if ( document.getElementById(STYLE_ID) ) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/** Escape text for HTML. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
}
