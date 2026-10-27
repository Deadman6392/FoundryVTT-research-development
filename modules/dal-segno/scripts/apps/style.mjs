/**
 * Styles for the sidebar additions and the windows, injected the first time any of them appears instead of a manifest
 * stylesheet every client would download at startup. Everything sits in Foundry's `modules` cascade layer and reads
 * FlexUI Revived's tokens with fallbacks, so it matches a theme without depending on one and never fights another
 * module's rules.
 */
const STYLE_ID = "dal-segno-style";

const CSS = `
@layer modules {
  .dal-segno-app, .dal-segno-now {
    --dsg-accent: var(--fxr-accent, var(--color-warm-2, #ee9b3a));
    --dsg-panel: var(--fxr-panel-alt, rgba(0, 0, 0, 0.25));
    --dsg-edge: var(--fxr-edge, rgba(255, 255, 255, 0.15));
    --dsg-muted: var(--fxr-muted, var(--color-text-secondary, #9a9a9a));
    --dsg-go: var(--fxr-go, #5fb35f);
    --dsg-stop: var(--fxr-stop, #c4553e);
  }
  .dal-segno-open { flex: 0 0 auto; }
  .dal-segno-now { display: flex; align-items: center; gap: 0.4rem; margin: 0.25rem 0.5rem; padding: 0.2rem 0.4rem;
    border: 1px solid var(--dsg-edge); border-radius: 4px; font-size: var(--font-size-12, 12px); }
  .dal-segno-now .dsg-name { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .dal-segno-now .dsg-state { color: var(--dsg-muted); }
  li.sound .dal-segno-mark { margin-inline-start: 0.3rem; color: var(--dsg-accent); font-size: 0.8em; }

  .dal-segno-app .window-content { padding: 0.5rem 0.6rem; gap: 0.5rem; }
  .dal-segno-app .dsg-row { display: flex; align-items: center; gap: 0.35rem; }
  .dal-segno-app .dsg-grow { flex: 1; min-width: 0; }
  .dal-segno-app .dsg-muted { color: var(--dsg-muted); }
  .dal-segno-app .dsg-hint { margin: 0; color: var(--dsg-muted); font-size: var(--font-size-12, 12px); }
  .dal-segno-app button.dsg-icon { flex: 0 0 auto; width: 2rem; height: 2rem; padding: 0; }
  .dal-segno-app button.dsg-icon.dsg-big { width: 2.6rem; height: 2.6rem; font-size: 1.2em; }
  .dal-segno-app .dsg-panel { padding: 0.4rem; border: 1px solid var(--dsg-edge); border-radius: 5px; background: var(--dsg-panel); }

  .dal-segno-app .dsg-tracks { max-height: 11rem; margin: 0.3rem 0 0; padding: 0; overflow-y: auto; list-style: none; }
  .dal-segno-app .dsg-tracks li { display: flex; align-items: center; gap: 0.3rem; padding: 0.1rem 0.25rem; border-radius: 3px; cursor: pointer; }
  .dal-segno-app .dsg-tracks li:hover { background: rgba(255, 255, 255, 0.06); }
  .dal-segno-app .dsg-tracks li.dsg-current { outline: 1px solid var(--dsg-accent); }
  .dal-segno-app .dsg-tracks li[hidden] { display: none; }
  .dal-segno-app .dsg-tracks .dsg-name { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .dal-segno-app .dsg-tracks a { padding: 0 0.2rem; opacity: 0.75; }
  .dal-segno-app .dsg-tracks a:hover { opacity: 1; }

  .dal-segno-app .dsg-title { font-weight: bold; font-size: 1.05em; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .dal-segno-app .dsg-badge { padding: 0 0.35rem; border: 1px solid var(--dsg-edge); border-radius: 999px; font-size: 0.75em; color: var(--dsg-muted); white-space: nowrap; }
  .dal-segno-app .dsg-badge.dsg-error { border-color: var(--dsg-stop); color: var(--dsg-stop); }
  .dal-segno-app .dsg-chips { display: flex; flex-wrap: wrap; gap: 0.25rem; margin: 0.35rem 0; }
  .dal-segno-app .dsg-chip { flex: 0 1 auto; width: auto; min-height: 1.8rem; padding: 0 0.6rem; line-height: 1.6rem; }
  .dal-segno-app .dsg-chip.dsg-here { border-color: var(--dsg-accent); box-shadow: 0 0 0 1px var(--dsg-accent) inset; }
  .dal-segno-app .dsg-chip.dsg-next { border-style: dashed; border-color: var(--dsg-accent); }

  .dal-segno-app .dsg-timeline { position: relative; height: 1.6rem; margin: 0.25rem 0; border: 1px solid var(--dsg-edge);
    border-radius: 3px; background: repeating-linear-gradient(-45deg, transparent 0 4px, rgba(127, 127, 127, 0.12) 4px 8px); cursor: pointer; overflow: hidden; }
  .dal-segno-app .dsg-region { position: absolute; top: 0; bottom: 0; background: rgba(127, 127, 127, 0.28); border-inline: 1px solid rgba(0, 0, 0, 0.35); pointer-events: none; }
  .dal-segno-app .dsg-region.dsg-loop { background: color-mix(in srgb, var(--dsg-accent) 32%, transparent); }
  .dal-segno-app .dsg-region span { position: absolute; left: 0.2rem; top: 0.1rem; font-size: 0.7em; white-space: nowrap; opacity: 0.85; }
  .dal-segno-app .dsg-playhead { position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: var(--dsg-accent);
    transform: translateX(var(--dsg-x, 0px)); pointer-events: none; }
  .dal-segno-app .dsg-playhead.dsg-glide { transition: transform 1s linear; }
  .dal-segno-app .dsg-time { font-variant-numeric: tabular-nums; }
  .dal-segno-app .dsg-transport { justify-content: center; margin: 0.25rem 0; }

  .dal-segno-app details > summary { cursor: pointer; font-weight: bold; margin: 0.15rem 0; }
  .dal-segno-app .dsg-sliders { display: grid; grid-template-columns: 6.5rem 1fr 3.2rem; align-items: center; gap: 0.15rem 0.4rem; }
  .dal-segno-app .dsg-sliders output { text-align: end; font-variant-numeric: tabular-nums; }
  .dal-segno-app .dsg-sliders input[type="range"] { width: 100%; }

  .dal-segno-editor canvas { display: block; width: 100%; border: 1px solid var(--dsg-edge); border-radius: 3px; background: var(--dsg-panel); cursor: crosshair; }
  .dal-segno-editor .dsg-zoom { height: 5rem; }
  .dal-segno-editor .dsg-wave { height: 7.5rem; }
  .dal-segno-editor table { width: 100%; margin: 0; border-collapse: collapse; }
  .dal-segno-editor th { font-size: 0.8em; text-align: start; color: var(--dsg-muted); }
  .dal-segno-editor td { padding: 0.1rem 0.15rem; }
  .dal-segno-editor td input[type="number"] { width: 5.5rem; }
  .dal-segno-editor td input[type="text"] { width: 100%; }
  .dal-segno-editor tr.dsg-selected td { background: color-mix(in srgb, var(--dsg-accent) 18%, transparent); }
  .dal-segno-editor .dsg-actions button { width: auto; flex: 0 0 auto; padding: 0 0.5rem; }
  .dal-segno-editor footer { display: flex; gap: 0.4rem; }

  .dal-segno-shrink .dsg-progress { width: 100%; }
  .dal-segno-shrink dl { display: grid; grid-template-columns: auto 1fr; gap: 0.1rem 0.6rem; margin: 0; }
  .dal-segno-shrink dt { color: var(--dsg-muted); }
  .dal-segno-shrink dd { margin: 0; }
}
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

/** Seconds as m:ss (or h:mm:ss). */
export function clock(seconds) {
  if ( !Number.isFinite(seconds) ) return "–:––";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}
