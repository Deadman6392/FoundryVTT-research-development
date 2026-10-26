# Changelog

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
