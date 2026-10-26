# FlexUI Revived

The four FlexUI themes (Fantasy, Sci-Fi, Stone and Classic FantasyUI) rebuilt for Foundry VTT v13's interface.

Based on [FlexUI](https://github.com/iotech-fvtt/flexui) by iotech, whose last release (0.3.0) supports Foundry v11.
On v13 the original wrecks the interface, because its stylesheets set the layout of a sidebar that no longer exists in
that shape ([issue #20](https://github.com/iotech-fvtt/flexui/issues/20)). This is a rewrite, not a patch: none of
the original's selectors survive, but the themes, their palettes, the image names and the settings are carried over.

**Status: 0.1.0, not yet run in a Foundry world.** The stylesheet targets v13's markup as documented by Foundry's type
definitions and by maintained v13 interface modules, and it was checked on a static model of the v13 interface in
Chromium, but no one has loaded it in Foundry yet. See [Trying it out](#trying-it-out) before using it at the table.

## What it restores

Everything the original styled that still exists in v13:

- **Sidebar tabs** with the theme's icons, in large (40 px icons, the original's default) or compact size, and the
  theme's arrows on the collapse button.
- **Sidebar panel** framed with the theme's panel image.
- **Chat**: parchment messages, speaker names in the theme's ink, "(Whisper)" and "(Blind)" labels on private
  messages, a parchment message box and themed roll-mode buttons.
- **Directories**: parchment search boxes, the theme's green create buttons, folders drawn as buttons (keeping each
  folder's own colour underneath), themed buttons in the Settings tab, and the small, medium or large text size.
- **Combat tracker** with the theme's red buttons.
- **Scene controls** and **scene navigation** drawn on the theme's panel, with the theme's arrows on the navigation
  toggle.
- **Turning it off** per player, as before.

Not restored: the Ko-fi and "report issue" line the original added to the Settings tab (that was iotech's own link),
and the French and Brazilian Portuguese translations, since every string is new. Translations are welcome.

## What's new

- **Live switching.** Every setting applies immediately. The original reloaded the page on every change.
- **A table default.** The GM picks the theme for everyone; each player can keep it, pick another, or turn the theme
  off on their own computer.
- **Styled areas.** Each part of the interface (tabs, panel, chat, directories, combat, scene controls, navigation,
  hotbar, players list, window title bars) can be switched off per player, so FlexUI Revived can sit next to a module
  that styles the same thing.
- **Hotbar, players list and window title bars**, which are new or changed in v13. Title bars are off by default
  because many systems and modules style their own.
- **Works without any artwork**: each theme has a CSS-only version with drawn wood, brushed metal, stone and parchment
  textures and Font Awesome icons (hexagonal ones for Sci-Fi).
- **Your own artwork**: point the GM setting at a folder of images named like the original's.
- **Lightweight textures** per computer: skips the original's 2 MB parchment image and the panel image.
- **Servers under a URL prefix** (`https://host/foundry/`) work; the original's hard-coded `/modules/...` paths
  didn't ([issue #8](https://github.com/iotech-fvtt/flexui/issues/8)).
- **The original is kept from breaking things.** If the original FlexUI is still active, its v11 stylesheets are
  removed before anything renders and the GM is told to deactivate it.
- **Your old choices carry over.** If you used the original in the same browser, your theme, compact setting and font
  size become the starting values.

## Artwork

FlexUI Revived contains no images. The original's license covers its code (CC BY 3.0) but not its artwork: the icons
are from Rexard's commercial collections and the rest is iotech's, and they "may not be redistributed without
permission and attribution". So the *Artwork* setting (GM) offers:

| Choice | What it uses |
| --- | --- |
| Automatic (default) | The original FlexUI's images if that module is installed, otherwise CSS only. |
| Original FlexUI | The original's images even if Foundry doesn't list the module (for example, files copied by hand). |
| Custom folder | Images from the folder chosen under *Custom artwork*; anything missing comes from the original if installed, otherwise CSS. |
| None | CSS textures and Font Awesome icons only. |

**To use the original artwork**, install FlexUI from Foundry's package browser (search "FlexUI"), and **leave it
deactivated**. Foundry serves an installed module's files whether or not it is active, which is the same approach
iotech used for the v13 preview in issue #20. Players download the images from your server like any other module
asset. Its package page lists 0.3.0, verified for v11; 0.2.0 and 0.3.0 keep their images in the same place under the
same names. If Foundry refuses to install it on your version, unzip a
[release](https://github.com/iotech-fvtt/flexui/releases) into `Data/modules/flexui` and set *Artwork* to Original
FlexUI, since Foundry may then not list the module for Automatic to find.

**Custom artwork**: put images in a folder in your Foundry data (for example `worlds/<world>/flexui`), named after the
original's files (`icon_chat`, `icon_combat`, `icon_scene`, `icon_actor`, `icon_item`, `icon_journal`, `icon_table`,
`icon_card`, `icon_macro`, `icon_audio`, `icon_compendium`, `icon_settings`, `arrow_left`, `arrow_right`,
`arrow_up`, `arrow_down`, `main_panel`, `parchment`, `button_clear`, `button_fancy`, `button_green`, `button_red`,
`dropdown_border`) with any image extension. Open *Custom artwork*, choose the folder and press *Scan folder and
save*. The folder is listed once, by the GM, and the matches are stored in a world setting, so players need no
file-browsing permission. Only folders in your user data can be scanned; S3 and other file sources can't yet.

## Settings

| Setting | Who | Stored | What it does |
| --- | --- | --- | --- |
| My theme | Everyone | This computer | Table default, one of the four themes, or Off. |
| Sidebar tab size | Everyone | This computer | Large (40 px icons) or compact. |
| Directory text size | Everyone | This computer | Small, medium or large text in sidebar lists. |
| Lightweight textures | Everyone | This computer | CSS instead of the panel and parchment images. |
| Styled areas | Everyone | This computer | Which parts of the interface are themed. |
| Table default theme | GM | World | The theme for players who follow the table default. |
| Artwork | GM | World | Where images come from (see above). |
| Custom artwork | GM | World | The scanned folder of your own images. |

Choices are per computer rather than per account because the right size and texture weight depend on the screen and
the machine, and because the original stored them the same way.

## Alongside other interface modules

FlexUI Revived restyles the same elements as [Carolingian UI](https://foundryvtt.com/packages/crlngn-ui),
[Classic UI](https://foundryvtt.com/packages/classic-ui) and similar packages. Those change layout and behaviour
(moving the hotbar, resizing the sidebar, adding scene folders); this module only changes colours, textures, icons and
a few sizes. If you want their features and FlexUI's look, untick the areas they also style under *Styled areas*;
whichever loads later wins where both are on. If all you want is a dark fantasy skin without the original's artwork,
any of them alone may be simpler.

dnd5e draws its own chat cards inside each message, so the parchment should only show around them; check this on
your table (step 3 below).

## What it can't do

- It hasn't run in Foundry yet (see the status note). Some selectors may need adjusting after the first real test.
- Foundry v14 is expected to mostly work (the stylesheet also targets v14's renamed roll-mode buttons), but nothing
  has been checked on v14 and `compatibility.verified` is unset.
- Sidebar tabs a module adds keep their Font Awesome icon (in the theme's colours); only core tabs have artwork.
- It doesn't theme the inside of sheets and other windows; systems style those.
- Text inside chat messages that hard-codes a light colour (some modules' cards) may be hard to read on parchment.
  Turn the Chat area off if that happens.

## Trying it out

Copy `modules/flexui-revived` to `Data/modules/flexui-revived` (or install from the manifest once released), enable
it, and check, with the original FlexUI installed but inactive and then with *Artwork* on None:

1. Each theme on the chat, actors, combat and settings tabs, expanded and collapsed sidebar.
2. Large and compact tab sizes; the collapse arrow.
3. A whisper and a blind roll show their labels; dnd5e attack and damage cards are readable.
4. Folders keep their colours; create buttons and search boxes look right.
5. Scene controls, navigation (including the expand arrow), hotbar and players list.
6. Changing *My theme* as a player and *Table default theme* as the GM switches without a reload.
7. Activate the original FlexUI too, reload: the interface stays intact and the GM gets the warning.

Once it holds up, set `"verified": "13"` in `module.json`.

## Your own tweaks

The body gets `flexui-revived` and `flexui-revived-<theme>` classes while a theme is on, and every colour is a CSS
variable (`--fxr-panel`, `--fxr-accent`, `--fxr-paper`, `--fxr-ink`, ...), so a world script or a custom CSS module
can adjust a theme without forking it, for example
`body.flexui-revived-fantasy { --fxr-accent: #d4af37; }`.

## Cost of this module

Written to the budgets in [CLAUDE.md](../../CLAUDE.md):

- 6 files (~35 KB unminified) load at startup in two parallel waves. The two settings windows load only when opened.
  No stylesheets or templates are fetched: the theme is one generated `<style>` element of about 13 to 17 KB, built
  in about 0.04 ms (Node, measured over 1,000 builds).
- No always-on listeners and no timers. Four one-time startup hooks (`init`, `i18nInit`, `setup`, `ready`); after
  that, work happens only when a setting changes, which rewrites the one style element.
- Images, only with artwork: the browser downloads the images the visible interface uses, once, then caches them.
  With every original image in use that is about 2.7 MB for Fantasy, 2.6 MB for Stone and Classic and 1 MB for Sci-Fi,
  most of it the parchment (2 MB in three themes). *Lightweight textures* brings that down to 0.4 to 0.75 MB. Without
  artwork, nothing is downloaded; the textures are small inline SVGs the browser draws once per size.
- Document writes: none on load. A player changing their own settings writes only to their browser; the GM changing
  the table default, artwork source or custom folder writes one world setting, which every client applies.
- Rendering: the textures and shadows are static; nothing animates. Turning areas off removes their rules entirely.

## Credits and license

FlexUI is by [iotech](https://github.com/iotech-fvtt), with advice from GrumpyVader, Darkiller25, Tarmorax, kayhos,
Mrlial and Mistamichal. Its icons are from Rexard's collections and `button_fancy` from a free collection by
dycha.net. See [LICENSE.md](LICENSE.md).
