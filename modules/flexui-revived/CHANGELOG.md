# Changelog

## 0.2.0

Own artwork, six new themes, display fonts and optional motion. The original FlexUI's images are no longer used.

- **Bundled free artwork**: 77 icons from game-icons.net (CC BY 3.0), 12 CC0 textures from Poly Haven and ambientCG,
  and seven display fonts (OFL and Apache 2.0), credited in CREDITS.md. Icons are tinted with each theme's accent and
  glow softly. A theme downloads 32 to 108 KB, against 1 to 2.7 MB with the original's art.
- **Six new themes**: Gothic Horror, Cosmic Horror, Neon Noir, Infernal, Frostbound and Faerie Wood, each with its
  own icons for the sidebar tabs, texture, paper, font, particles and glow. The four original themes now use the
  bundled art too.
- **Themed fonts** (on by default, per computer): the theme's display font for speaker, folder and scene names and
  headings.
- **Ambient motion** (off by default, per computer): drifting texture and particles and a breathing, pulsing or
  flickering glow on the active tab, stepped once a second by a timer that stops while the page is hidden and never
  runs under reduced motion. Measured at about 0.2% of a core in headless Chromium; CSS animations cost ten to thirty
  times more main-thread time, so none are used.
- **Yields to other modules**: rules moved into the cascade layer `modules.flexui-revived`, so any module's own
  stylesheet wins over the theme where both style the same thing.
- **For module authors**: documented `--fxr-*` tokens, `api.theme`, and a `flexuiRevived.themeChanged` hook.
- **Artwork setting** is now Bundled, Custom folder or None (a new setting key; 0.1's Automatic/Original choices are
  gone). Custom folders gain a `panel_texture` image; missing images fall back to the bundled set.
- The sidebar tab strip is drawn on the theme's surface, and the panel gets a vignette.

## 0.1.1

- The manifest now names v13 as its verified version. Sqyre refused to install 0.1.0 ("Install failed due to a
  problem with the manifest") while Foundry's own installer accepted the files; a missing verified version is the
  likely reason, since Sqyre sorts modules by it. The module itself is unchanged and still hasn't been confirmed in a
  world.
- Dropped the optional `license` manifest field; LICENSE.md still ships in the zip.

## 0.1.0

First release of the rewrite of iotech's FlexUI 0.3.0 for Foundry v13. Not yet run in a Foundry world.

- The four themes (Fantasy, Sci-Fi, Stone, Classic FantasyUI) for v13's sidebar tabs and panel, chat, directories,
  combat tracker, scene controls and scene navigation, plus the hotbar, players list and (opt-in) window title bars.
- One generated stylesheet in Foundry's `modules` cascade layer, switched live on every setting change.
- Table default theme (GM) with a per-player choice, large or compact tabs, three directory text sizes, lightweight
  textures, and per-area toggles for use next to other interface modules.
- Artwork from an installed copy of the original FlexUI, from a scanned folder of your own images, or none (CSS
  textures and Font Awesome icons).
- If the original FlexUI is active, its v11 stylesheets are removed before the interface renders and the GM is warned.
- Theme, compact and font size choices from the original carry over in the same browser.
- Image paths go through Foundry's route, so servers under a URL prefix work.
