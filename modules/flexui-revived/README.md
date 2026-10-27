# FlexUI Revived

Themes for Foundry VTT v13's interface: textured sidebar and controls, glowing tab icons, parchment chat, display
fonts and, if you want it, slow ambient motion. Ten themes, from the four FlexUI originals to genre presets for horror,
cyberpunk, infernal, frozen and faerie games. Every image, icon and font ships with the module under a free license.

It started as a rewrite of iotech's [FlexUI](https://github.com/iotech-fvtt/flexui), whose last release (0.3.0,
Foundry v11) breaks the v13 interface ([issue #20](https://github.com/iotech-fvtt/flexui/issues/20)). Since 0.2 it
no longer uses any of the original's artwork; see [Credits](#credits-and-license).

**Status: 0.2.0.** 0.1.1 ran on a v13.351 table (hosted on Sqyre) without problems. 0.2's new art, fonts and motion were
checked on a static model of the v13 interface in Chromium, not yet in a Foundry world; see
[Trying it out](#trying-it-out).

## Themes

| Theme | Look | Display font | Particles | Glow |
| --- | --- | --- | --- | --- |
| Fantasy | Dark wood, gold, cream parchment | Cinzel | Dust motes | Breathing |
| Sci-Fi | Brushed steel, cyan, light grey paper | Orbitron | Stars | Pulse |
| Stone | Slate, bone, parchment; axe, helm and chest icons | Cinzel | – | Breathing |
| Classic FantasyUI | Black leather, brass, parchment | Cinzel | – | Breathing |
| Gothic Horror | Crimson velvet, candle-gold glow; stake, castle, coffin icons | Pirata One | – | Candle flicker |
| Cosmic Horror | Green-tinged rock, yellowed paper, typewriter names; tentacle, lighthouse, cultist icons | Special Elite | Spores | Breathing |
| Neon Noir | Dark diamond plate, magenta neon, dark glass chat; pistol, city, cyborg icons | Share Tech Mono | – | Pulse |
| Infernal | Lava, ember glow, scorched paper; trident, volcano, horned skull icons | Metamorphous | Rising embers | Flicker |
| Frostbound | Ice, pale blue, frosted paper; ice spear, mountains, snowflake icons | Cinzel | Falling snow | Breathing |
| Faerie Wood | Moss, lime-gold, leafy paper; bow, forest, fairy icons | Uncial Antiqua | Fireflies | Breathing |

The genre themes are named for genres rather than for particular games. Each theme picks its own icon for every
sidebar tab from a shared set (crossed swords for combat in Fantasy, a ray gun in Sci-Fi, a pistol in Neon Noir).

## What it styles

- **Sidebar tabs** on a textured strip: the theme's icons tinted with its accent colour and a soft glow, large (40 px
  icons, the original FlexUI's size) or compact. The active tab glows brighter.
- **Sidebar panel**: the theme's texture under a shade and vignette, with its particles.
- **Chat**: paper messages tinted per theme (dark glass in Neon Noir), speaker names in the display font, "(Whisper)"
  and "(Blind)" labels on private messages, a paper message box and themed roll-mode buttons.
- **Directories**: paper search boxes, the theme's create buttons, folders drawn as bevelled buttons over each
  folder's own colour, display-font folder names and settings headings, and small, medium or large list text.
- **Combat tracker**: the theme's danger colour on Begin/End Combat and the active combatant highlighted.
- **Scene controls, scene navigation, hotbar, players list**, and (off by default) **window title bars**.

Each of these is an area a player can switch off under *Styled areas*.

## Settings

| Setting | Who | Stored | What it does |
| --- | --- | --- | --- |
| My theme | Everyone | This computer | Table default, one of the ten themes, or Off. |
| Sidebar tab size | Everyone | This computer | Large (40 px icons) or compact. |
| Directory text size | Everyone | This computer | Small, medium or large text in sidebar lists. |
| Themed fonts | Everyone | This computer | The theme's display font for names and headings (never body text). On by default. |
| Ambient motion | Everyone | This computer | Slowly drifting texture and particles, a breathing or flickering glow on the active tab. Off by default. |
| Lightweight textures | Everyone | This computer | CSS instead of texture images. |
| Styled areas | Everyone | This computer | Which parts of the interface are themed. |
| Table default theme | GM | World | The theme for players who follow the table default. |
| Artwork | GM | World | Bundled (default), Custom folder, or None (CSS and Foundry's own icons). |
| Custom artwork | GM | World | A scanned folder of your own images. |

Every setting applies immediately, without a reload. Choices are per computer because the right size, motion and
texture weight depend on the screen and the machine.

## Ambient motion

Off by default, because anything that moves costs something on every computer that shows it. When a player turns it
on, the sidebar's texture drifts a quarter of a pixel a second, the theme's particles drift (embers rise, snow falls,
fireflies wander), and the active tab's glow breathes, pulses or flickers. Every layer loops seamlessly after 2048
seconds.

It is deliberately stepped: a one-second timer writes the step into two CSS custom properties, registered as
non-inherited so only the panel and the active tab are restyled, not the chat log inside the panel. Between ticks the
browser has nothing to do. The timer stops while the Foundry tab is hidden, and never runs for players whose system
asks for reduced motion. Measured in headless Chromium over 12 seconds on the Infernal theme:

| | Frames drawn | Style recalculations | Main-thread time |
| --- | --- | --- | --- |
| Motion off | 0 | 0 | 2 ms |
| Ambient motion (as shipped) | 12 | 12 | 26 ms |
| Same, with 400 more chat messages in the panel | 12 | 12 | 35 ms |
| For comparison: stepped CSS animations | 28 | 742 | 247 ms |
| For comparison: smooth CSS animations | 721 | 770 | 813 ms |

That is about 0.2% of one core. Headless Chromium draws in software, so these numbers show how often the browser
works, not how long a graphics card takes; check a weak computer with Performance Triage before recommending motion
to your table.

## Artwork

The *Artwork* setting (GM) chooses where images come from:

| Choice | What it uses |
| --- | --- |
| Bundled (default) | The icons, textures and fonts in `assets/`, all free to use (see [CREDITS.md](CREDITS.md)). |
| Custom folder | Images from the folder chosen under *Custom artwork*; anything missing comes from the bundled set. |
| None | CSS textures and Foundry's own Font Awesome tab icons. Fonts still apply unless *Themed fonts* is off. |

**Custom artwork**: put images in a folder in your Foundry data (for example `worlds/<world>/flexui`) named after the
part they replace: `icon_chat`, `icon_combat`, `icon_scene`, `icon_actor`, `icon_item`, `icon_journal`, `icon_table`,
`icon_card`, `icon_macro`, `icon_audio`, `icon_compendium`, `icon_settings` (tab icons, shown in full colour),
`panel_texture` and `parchment` (repeating textures), `main_panel` (a frame stretched around the sidebar),
`button_clear`, `button_green`, `button_red`, `dropdown_border`, and `arrow_left`/`right`/`up`/`down`. Any image
extension works. Open *Custom artwork*, choose the folder and press *Scan folder and save*. The GM lists the folder
once and the matches are stored in a world setting, so players need no file-browsing permission. Only folders in your
user data can be scanned; S3 and other file sources can't yet. The names follow the original FlexUI's, so a folder of
its images works too, if you have the rights to use them.

## For module authors

FlexUI Revived is meant to sit under other modules, not fight them:

- **It always loses to your stylesheet.** Its rules live in the cascade layer `modules.flexui-revived`, a sub-layer of
  the `modules` layer Foundry puts every manifest stylesheet in. Rules directly in `modules` beat a sub-layer at any
  specificity, so where your module styles something, your look wins. If you inject CSS yourself, wrap it in
  `@layer modules { ... }` to get the same result.
- **Match the theme with its tokens**, with fallbacks so your module works without it: `--fxr-panel`,
  `--fxr-panel-alt`, `--fxr-edge`, `--fxr-accent`, `--fxr-glow`, `--fxr-text`, `--fxr-muted`, `--fxr-paper`,
  `--fxr-paper-edge`, `--fxr-ink`, `--fxr-sender`, `--fxr-go`, `--fxr-stop` (colours), `--fxr-surface-image` and
  `--fxr-surface-size` (the panel texture), `--fxr-icon-fill` (the icon gradient) and `--fxr-font-display`. For
  example: `background: var(--fxr-panel, var(--control-bg-color)); color: var(--fxr-text, inherit);`. They are set on
  `:root` only while a theme is on, and their names won't change within 0.x.
- **From JavaScript**: `game.modules.get("flexui-revived")?.api?.theme` is `null` or
  `{ id, palette, font, motion, layer }`, and the hook `flexuiRevived.themeChanged` is called with the same object
  (or `null`) whenever any of those change, including once at startup before the interface renders.
- The body has the classes `flexui-revived` and `flexui-revived-<theme>` while a theme is on.

## Alongside other interface modules

[Carolingian UI](https://foundryvtt.com/packages/crlngn-ui), [Classic UI](https://foundryvtt.com/packages/classic-ui)
and similar packages change layout and behaviour (moving the hotbar, resizing the sidebar, adding scene folders); this
module only changes colours, textures, icons, fonts and a few sizes. Because its styles yield to theirs (see above),
you can usually run both; untick an area under *Styled areas* if the two looks clash there.

dnd5e draws its own chat cards inside each message, so the paper should only show around them.

## What it can't do

- 0.2's artwork, fonts and motion haven't been checked in a Foundry world yet (see the status note).
- Foundry v14 is expected to mostly work (the stylesheet also targets v14's renamed roll-mode buttons), but nothing
  has been checked on v14.
- Sidebar tabs a module adds keep their Font Awesome icon, in the theme's colour and glow; only core tabs have icons.
- It doesn't theme the inside of sheets and other windows; systems style those.
- Text inside chat messages that hard-codes a light or dark colour (some modules' cards) may be hard to read on a
  theme's paper. Turn the Chat area off if that happens.
- Display fonts cover Latin script only; other scripts fall back to the system font.

## Trying it out

Install from the manifest, enable it, and check:

1. A few themes on the chat, actors, combat and settings tabs, expanded and collapsed sidebar.
2. Large and compact tab sizes; the icons glow and the active tab stands out.
3. A whisper and a blind roll show their labels; dnd5e attack and damage cards are readable, including in Neon Noir.
4. Folders keep their colours; create buttons and search boxes look right.
5. Scene controls, navigation, hotbar and players list.
6. Ambient motion on: Infernal's embers rise and the active tab flickers about once a second.
7. *Artwork* None and Custom folder; changing *My theme* as a player and *Table default theme* as the GM.

If something looks wrong, a screenshot and the Foundry version are enough to fix it.

## Cost of this module

Written to the budgets in [CLAUDE.md](../../CLAUDE.md):

- 6 files (56 KB unminified) load at startup in two parallel waves. The settings windows and the motion timer load
  only when used. The theme is one generated `<style>` element of 18 to 21 KB, built in about 0.1 ms (Node, averaged
  over 1,000 builds); no stylesheet or template is fetched for it.
- Downloads, once per browser and then cached: the theme's 12 icons, its textures and its font, 32 KB (Sci-Fi) to
  108 KB (Faerie Wood). The whole `assets/` folder is about 500 KB, but a client only fetches its own theme's files.
- No always-on listeners. Four one-time startup hooks (`init`, `i18nInit`, `setup`, `ready`); after that, work happens
  only when a setting changes, which rewrites the one style element.
- With *Ambient motion* on: one one-second timer, stopped while the page is hidden (see the measurements above), and a
  `visibilitychange` listener.
- Static glow and shadows are drawn once. Turning an area off removes its rules entirely.
- Document writes: none on load. A player changing their own settings writes only to their browser; the GM changing
  the table default, artwork or custom folder writes one world setting, which every client applies.

## Credits and license

Icons from [game-icons.net](https://game-icons.net) (CC BY 3.0) by Lorc, Delapouite, Caro Asercion, Skoll,
Faithtoken, John Colburn and Zajkonur; CC0 textures from [Poly Haven](https://polyhaven.com) and
[ambientCG](https://ambientcg.com); fonts under the SIL Open Font License and Apache 2.0. Full list in
[CREDITS.md](CREDITS.md).

FlexUI Revived began as a rewrite of FlexUI by [iotech](https://github.com/iotech-fvtt) (code under CC BY 3.0),
which had help from GrumpyVader, Darkiller25, Tarmorax, kayhos, Mrlial and Mistamichal. See [LICENSE.md](LICENSE.md).
