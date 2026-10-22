/**
 * Styles for this module's windows, injected the first time one opens instead of shipping a stylesheet that every
 * client would download and parse at startup.
 */
const STYLE_ID = "performance-triage-style";

const CSS = `
.ptriage .window-content { overflow-y: auto; padding: 0.5rem 0.75rem; font-size: var(--font-size-13, 13px); }
.ptriage-header > p { margin: 0 0 0.5rem; opacity: 0.8; }
.ptriage-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.5rem; margin-bottom: 0.5rem; }
.ptriage-card { border: 1px solid var(--color-border, #7a7971); border-radius: 4px; padding: 0.35rem 0.5rem; display: flex; flex-direction: column; }
.ptriage-card span { font-size: 0.85em; opacity: 0.75; }
.ptriage-card strong { font-size: 1.1em; }
.ptriage-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.5rem 0; }
.ptriage-actions button { flex: 0 0 auto; width: auto; padding: 0 0.6rem; }
.ptriage-findings { padding-left: 1.25rem; margin: 0.25rem 0 0.75rem; }
.ptriage-findings li { margin-bottom: 0.5rem; }
.ptriage-findings p { margin: 0.15rem 0; }
.ptriage-fix { opacity: 0.85; font-style: italic; }
.ptriage-badge { display: inline-block; min-width: 4.5em; text-align: center; border-radius: 3px; padding: 0 0.3rem; font-size: 0.8em; font-weight: bold; color: #fff; background: #6b6b6b; }
.sev-high .ptriage-badge { background: #b3261e; }
.sev-medium .ptriage-badge { background: #b26a00; }
.sev-low .ptriage-badge { background: #3f6fb5; }
.ptriage-area { font-size: 0.85em; opacity: 0.7; margin-right: 0.25rem; }
.ptriage-section { border-top: 1px solid var(--color-border, #7a7971); padding: 0.35rem 0; }
.ptriage-section > summary { cursor: pointer; font-weight: bold; font-size: 1.05em; }
.ptriage-table { width: 100%; border-collapse: collapse; margin: 0.4rem 0 0.6rem; font-size: 0.92em; }
.ptriage-table caption { text-align: left; font-weight: bold; padding: 0.2rem 0; }
.ptriage-table th, .ptriage-table td { padding: 0.15rem 0.35rem; text-align: left; vertical-align: top; border-bottom: 1px solid rgba(127,127,127,0.25); word-break: break-word; }
.ptriage-table td:not(:first-child), .ptriage-table th { white-space: nowrap; }
.ptriage-profiles select { width: 100%; }
.ptriage-profiles .ptriage-summary { font-size: 0.85em; opacity: 0.8; }
.ptriage-profiles footer { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.ptriage-plan .ptriage-summary { font-size: 0.85em; opacity: 0.8; }
.ptriage-table td.ptriage-wrap { white-space: normal; min-width: 14em; }
.ptriage-plan-small, .ptriage-plan-inUse { opacity: 0.65; }
.ptriage-area { margin: 0.2rem 0 0.2rem 0.4rem; border-left: 3px solid rgba(127,127,127,0.35); padding-left: 0.5rem; }
.ptriage-area > summary { cursor: pointer; padding: 0.2rem 0; font-size: 1.02em; }
.ptriage-area > summary .ptriage-summary { margin-left: 0.4rem; }
.ptriage-area > p { margin: 0.25rem 0; }
.ptriage-plan ol { margin: 0.3rem 0 0.3rem 1.2rem; padding: 0; }
.ptriage-plan ol li { margin-bottom: 0.25rem; }
.ptriage-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--color-border, #7a7971); margin-bottom: 0.5rem; }
.ptriage-tabs button { flex: 0 0 auto; width: auto; padding: 0 0.8rem; border-radius: 4px 4px 0 0; opacity: 0.7; }
.ptriage-tabs button.active { opacity: 1; font-weight: bold; }
.ptriage-census-filter { align-items: center; }
.ptriage-census-filter input[type=search] { flex: 1 1 16em; max-width: 24em; }
.ptriage-census-filter label { display: flex; align-items: center; gap: 0.25rem; white-space: nowrap; }
.ptriage-census th.ptriage-sort { cursor: pointer; user-select: none; }
.ptriage-census-row { cursor: pointer; }
.ptriage-census-row:hover { background: rgba(127,127,127,0.12); }
.ptriage-census-detail > td { padding-left: 1.2rem; }
.ptriage-chip { display: inline-block; width: auto; line-height: 1.5; margin: 0 0.2rem 0.2rem 0; padding: 0 0.4rem; font-size: 0.9em; }
.ptriage-chip-flag { border-color: #b26a00; }
`;

export function injectStyle() {
  if ( document.getElementById(STYLE_ID) ) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}
