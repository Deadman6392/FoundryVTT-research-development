# FoundryVTT research & development

Foundry VTT modules for a dnd5e table that runs a large automation stack (~100 modules) with players on very
different hardware. The first module is `modules/performance-triage`. Every module in this repo must be cheap to
load and cheap to run: performance is a feature here, not a polish step.

## Layout

- `modules/<id>/` — one folder per Foundry module, installable by copying it to `Data/modules/<id>`.
  - `scripts/main.mjs` is the entry point; `scripts/lib/` holds pure logic with no Foundry globals.
  - `scripts/apps/` holds UI, always loaded with dynamic `import()` when opened.
- `tests/` — `node:test` suites. `tests/helpers/foundry-mock.mjs` is a small Foundry stand-in for lifecycle tests.
- `scripts/check.mjs` — static checks (manifest, syntax, localization keys, release URLs, load budget).
- `scripts/package.mjs`, `scripts/set-version.mjs`, `scripts/lib/release.mjs` — release tooling.
- `docs/` — GM-facing guides.

## Commands

- `npm test` — all tests. Must pass before every commit.
- `npm run check` — manifest/syntax/i18n/release-URL checks and the eager-load budget. Must pass before every commit.
- `npm run set-version -- <id> <x.y.z>` — bump a module's version and its download URL together.
- `npm run package` — build `dist/<id>.zip` locally (CI does this on every push as a dry run).

## Releasing

Foundry installs from a module's `manifest` URL (its `module.json` on `main`, which must stay stable) and downloads the
zip named in `download`. To release: run `npm run set-version`, commit, and merge to `main`. The `Release modules`
workflow then publishes a GitHub release `<id>-v<version>` with `<id>.zip` and `module.json` attached. It skips versions
that already have a release, so merging other changes never republishes. Never edit a published release's zip;
release a new version instead.

No dependencies or build step: modules ship as plain ES modules so the folder in the repo is exactly what Foundry runs.

## Target platform

- Foundry VTT v13 is the baseline (`compatibility.minimum: "13"`). As of October 2026, v14 is current but midi-qol is
  only verified for v13 / dnd5e 5.3, so most heavy dnd5e tables are still on v13. Keep code working on v14 where the
  APIs allow; only mark a version as verified after it has actually been run.
- dnd5e 5.x (v13) and 6.x (v14).

## Verify APIs, don't recall them

Foundry's APIs move between major versions. Before using an API, confirm it in a source and say where in the commit
or code comment when it is not obvious:

- Type definitions that track core closely: <https://github.com/League-of-Foundry-Developers/foundry-vtt-types>
  (`src/configuration/configuration.d.mts` lists core setting keys).
- API docs: `https://foundryvtt.com/api/v13/` and `/api/v14/` (the TypeDoc search index at `assets/search.js` is
  handy for checking whether a member exists in each version).
- dnd5e source: <https://github.com/foundryvtt/dnd5e>.
- Third-party module settings: read the module's own `settings.js` (key, scope, `requiresReload`) before touching it.

## Performance rules

These are requirements, not suggestions. `npm run check` enforces the first one.

1. **Eager load budget.** At most 10 files, 64 KB unminified, and 2 sequential fetch waves before the module runs. The
   entry file imports every eagerly needed file directly so the browser fetches them in one parallel wave.
2. **Lazy UI.** Applications, report builders and anything only needed on demand are loaded with `import()` when
   opened. Settings menus register a tiny launcher class that imports the real app on render.
3. **No startup fetches for presentation.** No `styles` in the manifest and no template preloading unless something
   visible at startup needs them. Inject CSS the first time a window opens; for small apps, render HTML strings in
   `_renderHTML` instead of fetching Handlebars templates.
4. **Stay off hot paths.** Don't listen to per-frame or high-frequency hooks (`refreshToken`, `sightRefresh`,
   `canvasPan`, pointer moves) unless the feature requires it, and then keep the handler O(1) and allocation-free.
5. **Never make data preparation slower.** dnd5e prepares every actor on every client at load and after every change.
   Don't wrap `prepareData`/`prepareDerivedData` or add per-actor work there.
6. **Prefer hooks to wrappers.** If a core method must be wrapped, use libWrapper (WRAPPER type when possible) and
   explain the cost in a comment.
7. **No polling.** Use hooks and events. If a timer is unavoidable, use intervals of a second or more and stop them
   when the feature is idle or off.
8. **Writes are broadcasts.** Every document or world-setting write goes to all clients. Never write on load as a
   habit; at most once per session per user, only when the value changed or is useful.
9. **Opt-in for anything with ongoing cost.** Profilers, verbose logging, and heavy visual features default to off,
   and when on they must be visible (a notification or a line in the report).
10. **State the cost.** Each module README has a "Cost of this module" section: eager files and size, always-on
    listeners and timers, and any document writes.
11. **Measure claims.** Don't claim a speed-up without a measurement. Performance Triage's report and hook profiler
    should show a module's own cost; check it there.

## Code conventions

- ES modules with `.mjs`, two-space indentation, double quotes, and Foundry's spacing style inside control-statement
  parentheses: `if ( x )`, `for ( const y of z )`.
- JSDoc on exported functions. Comments explain why, not what.
- Pure logic goes in `scripts/lib/` and gets unit tests. Foundry glue is covered by lifecycle tests against the mock;
  extend the mock only to mirror real Foundry behavior.
- All user-facing settings, dialogs and notifications are localized; `npm run check` fails on missing keys.
- Settings: `client` scope for per-machine choices, `world` for GM-controlled data, `user` (v13+) for per-player
  preferences that should follow the account. Avoid `requiresReload` unless the value is only read at startup.
- Don't touch other modules' settings unless the module is active, the setting is registered as client-scoped, and
  the user (or their GM) asked for it; always back up and restore the user's own value.

## Honesty in docs and UI

Say what a feature can't do. If something overlaps an existing package, say so and explain when to use which.
