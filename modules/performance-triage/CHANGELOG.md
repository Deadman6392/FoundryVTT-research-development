# Changelog

## 0.13.0

From two work PC reports (Intel HD 4600) zoomed in on the 48-light interior, where lighting cost 51.5 ms of a 74 ms
frame and Lighting resolution at 50% took the frame rate from 15 to 23 with no visible difference:

- **Automatic lighting resolution in the profiles**: Balanced, Low and Minimum set Lighting resolution to Automatic.
  On the work PC, Automatic reached 50% by itself in two steps (15, 18.7, 23.9 fps); on a computer that keeps up it
  changes nothing. A profile's setting now takes effect on the load that applies it.
- **A 25% step**, as a fixed choice and as Automatic's last step, for computers still behind at 50%. It softens light
  edges at walls; like every automatic step, it is kept only if the frame rate rose.
- **Layer costs timed in pairs**: each part is drawn with and without the change alternately and the saving is the
  median of the pairs, so a computer that slows down during the test no longer shows parts costing minus 6 to 7 ms,
  as one work PC run did. Half-resolution lighting is now tried from whatever resolution is in use, down to 25%.
- **Stutter counts leave out measurements**: the long frames a layer cost measurement draws are no longer counted as
  play, so the report's stutters a minute reflect the session.
- **Automatic ignores stalls**: a 3-second check with a frame over 400 ms (and three times the average frame) neither
  triggers a step nor judges one. On a 0.12 work PC load, the first step came seconds after a 5.6 s load freeze, at
  "6.9 fps", and was judged a success when loading ended. Lighting resolution can't fix a stall, so stalls no longer
  count either way.
- The notification says Automatic may step lower or back up, and that the report lists every step; it still appears
  once per session.
- The report and scene planner styles sit in Foundry's `modules` cascade layer, as the repository now requires, so
  themes such as FlexUI Revived aren't fought by unlayered CSS.
- The report notes that lighting costs more zoomed in, and shows "none measured" instead of a negative saving.

## 0.12.0

From two reports on the GM's desktop (RX 9060 XT, 1440p, 144 Hz), where the 48-light interior drew at the screen's
refresh rate with lighting at 100% and at 50%, and every layer measured as free:

- **Layer costs time the draw**: each measurement draws the canvas between two pixel read-backs, which wait for the
  graphics card to finish, and takes the median of 15 draws. It works on a computer that keeps up with its screen,
  where counting frames saw nothing, and isn't limited to whole frames on a slow one. Parts are broken down when a
  layer costs 5 ms or a fifth of the frame. The frame rate before and after is still shown.
- **Automatic lighting resolution**: a third choice for Lighting resolution. It lowers lighting a step only when this
  computer falls below 80% of its frame cap on a scene for two 3-second checks, keeps the step only if the frame rate
  rose by 8%, tries the sharper step again after ten minutes near the cap, and remembers each scene's step. It pauses
  while idle-throttled, hidden or measuring, and notifies once per session. The report lists its changes.
- **Lighting resolution confirmed in a world**: the desktop report showed both lighting layers at 50% in Foundry
  13.351, so the setting is no longer marked experimental. What it saves on a slow computer is still to be measured.

## 0.11.0

From two work PC reports of the same 48-light interior at full and 75% render scale, where lighting cost 44.8 ms and
then 25.1 ms per frame, in proportion to the pixels drawn:

- **Lighting resolution** (per computer, experimental, off by default): draws light and light colours at 75% or 50%
  of the canvas resolution, leaving the map, tokens and interface sharp, by lowering the resolution of the masking
  filter the illumination and coloration layers already draw through. It applies at once and to every scene drawn
  after, and 100% restores Foundry's own values. The mechanism was checked in headless Chromium with PIXI 7.4.2
  (software WebGL, so the times aren't GPU times): 40 overlapping lights blended with SCREEN in a filtered container
  took 302 ms a frame at full filter resolution, 187 ms at 75% and 112 ms at 50%; the picture changed by 0.24 of 255
  on average, only at light edges, and a light's centre didn't move. It hasn't run in a Foundry world yet, so the
  report shows the resolution the layers actually use and Measure layer costs shows what it saves.
- **Lighting measurements**: when lighting costs 5 ms or more, Measure layer costs also hides just the lights while
  keeping the layers (the share of lighting that grows with lights), and tries lighting at half resolution.
- **Light coverage**: the report computes how many times over the scene's lights cover its area, how much they reach
  and how deep they overlap, from the shapes Foundry draws them with, and lists the largest lights. A finding points
  at overlap and lights that ignore walls, and the GM can select the largest lights to edit them.
- **Steadier frame counts**: layer costs and the frame rate shown when the report opens are now the rate between
  the first and last frame counted, not whole frames per window. At 12 fps a 2.5 s window holds about 30 frames, so
  one frame more or less moved a reading by about 3 ms, as much as a cheap layer costs (tiles measured 2.9 ms on the
  work PC).
- **Corrected advice**: the report and guide no longer say an uncoloured light skips the colour pass. Foundry's
  light API (v13/v14 type definitions) shows nothing that skips that layer for white lights, and it was never
  measured. The lighting advice now says that Low performance mode doesn't make a still light cheaper to draw.

## 0.10.0

From the first play measurements, on a work PC (Intel HD 4600) at 12 fps on a 48-light interior:

- **Move stalls and stutters on slow computers**: at 12 fps every frame is over the browser's 50 ms long-frame mark,
  so 0.9.0 counted every frame after a move as a stall (2.8 s per move). A stall is now the time frames took beyond
  the scene's normal frame time, a stutter is a frame over 50 ms and 2.5 times that time, and the canvas's own draw
  callback is left out of the per-module script time. Checked in headless Chromium: a 150 ms burst after a move on
  a 60 fps scene reads as a 132 ms stall, charged to the module that ran it.
- **Lighting and interface breakdown**: when lighting or the interface costs 5 ms a frame or more, Measure layer
  costs also measures their parts (illumination, light colours, background changes, darkness; grid, drawings,
  templates, regions, notes, token bars), listed under them.
- **Advice that knows the computer**: the lighting advice says when the computer is already at Low performance mode,
  names the scene's light count, and suggests render scale when it isn't on. The animated lights finding only appears
  where Foundry actually animates lights.
- **Aura modules**: auras on sidebar items count too (custom DAE auras often live there), and the finding no longer
  suggests disabling an aura module: with no auras in play, their work after a move is a cheap pass over the tokens.

## 0.9.0

Frame rate during play, after the load-time work:

- **Measure frame rate during play** (GM setting, off by default): every computer counts its frame rate per scene in
  five-second stretches (focused, not idle-throttled), long frames per minute, and the long frames from each token
  move until two seconds after its animation ends, with their script time by module. The report shows this session
  and the previous one; the previous session travels with the summary players already share once per session, so
  Client profiles shows each player's slowest scene, and a slow scene counts toward the suggested profile.
- **Render scale** (per computer): draws the map at fewer pixels through Foundry's canvasConfig hook. Nothing is
  removed; it needs a reload and hasn't been tried in a real world yet, so no profile uses it.
- **Settings that cost on every move**: the report reads module settings known, from their source, to add work on
  token moves (Chris's Premades' Movement Event Accuracy, ActiveAuras' walls block auras and its combat-only option
  that doesn't gate movement in 0.12.4 to 0.12.7, Levels, midi-qol's walls block range) and says what each costs.
  With several aura modules active it counts the auras each has in the world.
- Token move findings explain where Chris's Premades, ActiveAuras, Aura Effects and midi-qol do their movement work
  and which of their settings change it.
- **Profiles**: Low draws Sequencer's above-interface effects in the map instead of a second canvas over the
  interface; Minimum also turns off Aura Effects' radius drawings. Profile descriptions say that Balanced and Low
  thin FXMaster weather (through Foundry's performance mode) instead of removing it.

## 0.8.0

From the report after clearing tokens off the maps (12 tokens left, world data 42 MB, actors over half of it):

- **Actors and tokens** (the planner tab, renamed from Tokens by actor) lists every sidebar actor, including those no
  world scene uses, with the actor's own size. *On no scene* filters to those, heaviest first; opening one shows its
  folder and the journal entries and macros linking to it, which break while it is in a compendium.
- **Actors on no scene**: with the hook profiler on, the report counts actors no token on a world scene uses and no
  player owns, by type, and the actor finding says how to move them to a compendium keeping IDs.
- **Settings of inactive modules**: world settings whose package is disabled or not installed are listed with their
  size, since Foundry still sends them to every client, with a macro to delete one.
- **Large list settings**: the largest settings show how many entries they hold and how many repeat another entry's
  label or content.
- Long frames from this module's own measurements (timing actors) no longer appear in the finding about modules
  that started long frames during play; the table still shows them.

## 0.7.0

- **Tokens by actor**: a second tab in the scene planner (renamed from scene archive planner) counts every token on
  every world scene by the sidebar actor it was placed from, most first, sortable by any column. Each actor opens to
  the scenes its tokens are on, with a button per token that views the scene for the GM, selects the token and
  centres on it. It filters by actor, token or scene name and by player-owned actors, lists player-owned actors with
  several tokens on one scene or unlinked copies, and recounts when tokens are created or deleted while it is open.
  The report's token findings and world section link to it.

## 0.6.0

From the GM's notes on the first archive and restore:

- **Fog of war**: archiving deletes players' explored fog on those maps and it doesn't come back with the scene. The
  planner now marks maps players have explored (from an index of fog records, scene and user only) as needing prep,
  lists them per area, and says so in the steps instead of asking you to check.
- **Repeated items on tokens**: items with the same name, type and size on at least five tokens, that the sidebar
  actor doesn't have, are listed with the module flags they carry. In the measured world these are generic actions a
  module adds to every placed token; the finding says how much of the token data they are.
- **Token names under each actor**: tokens are grouped by the sidebar actor they're based on, which an adventure often
  renames (72 tokens on one generic actor, most with their own names). The report now lists those names.
- **Load history** records who logged in, since one browser can hold several logins (a GM testing as a player); the
  median is for the user viewing the report.

## 0.5.0

From the first archiving session (39 of 128 scenes archived: world data 141.8 to 98.6 MB, GM load 46 to 36 s):

- **Correction**: unlinked tokens' actors are not all built at load. The world build barely changed (9.9 to 9.2 s)
  while 35% of the tokens left, so a token's actor is built when something first reads it. The report and planner no
  longer say every player pays for every token at load.
- **Sequencer**: when the hook profiler names Sequencer's ready handler in a freeze, the finding explains it: a
  GM-only migration check that reads every token's actor on every scene, which fell from 16.6 to 10.1 s with the
  archiving above.
- **Token copies**: when most item copies are items the sidebar actor doesn't have (16,329 of 16,471 in that world),
  the finding says not to replace those tokens, since a fresh token would be missing them. Tokens that probably show
  an item twice are named, with the items.
- **Planner, archived areas**: a new *In compendiums* section lists the world's Scene compendiums, the scenes in
  them, the teleport regions and tile triggers in world scenes that lead into them, and the journal entries that
  link there. Scenes in the world that lead into an archived area say so.
- **Load history**: the report's timeline shows the last 20 loads on this computer, so before-and-after comparisons
  don't depend on anyone keeping notes. One local write per load, never sent.
- **Texture memory**: when most of it is textures kept from earlier scenes rather than the current one, the finding
  says so and suggests a reload; Foundry keeps a texture for 15 minutes after last use.

## 0.4.1

Review pass on the scene archive planner before its first real use:

- Scenes are grouped into areas (their folder, shown with its parent folders), ranked by how much archiving the area
  saves; scenes in use are left out of that total and out of the area's prep.
- "After prep" now means journal entries on the map, or a way in from another area (a teleport region or tile
  trigger in a scene outside the folder). Links from journal entries and macros are still listed, but no longer mark
  a scene as needing prep: with IDs kept they work again when it comes back. In an adventure world almost every scene
  is linked from a journal entry, so the old rule marked nearly everything.
- The archive and restore steps are spelled out, including creating a Scene compendium first and leaving scenes in
  use in the world.
- **Time token actors** in the planner, and the report's actor timing, now record time per scene; the planner shows
  it as a column, and the report lists the slowest scenes.
- The checklist is per area, with a checkbox for each area.
- Actor timing shows a notice while it runs; the planner shows one while it measures, remembers which sections are
  open, and says how long measuring took.
- The report's token tables drop the "matching" column (zero for every token in the world measured) and the caption
  splits item copies into differing, added and identical.
- The startup frame rate sample also drops intervals in which the tab was hidden and shown again.

## 0.4.0

- **Scene archive planner** (GM only): ranks every scene by the world data it costs each player at load, totals it
  by folder, and sorts scenes into archive with no prep, archive after prep (map notes that open journal entries, or
  journal entries, macros or other scenes that link to it), small, and in use. Copies a Markdown prep checklist. It
  reads the world and changes nothing. Opened from the settings menu, the report's World section, or the scene
  findings.
- Token item copies are split into copies that differ from the sidebar actor's item, items the sidebar actor doesn't
  have, and identical copies; added items with the same name and type as a sidebar item are counted, since those
  tokens probably show the item twice.
- The archiving advice now says to keep IDs on export and import, so links to an archived scene work again when it
  comes back.
- The startup frame rate sample also drops intervals in which the idle throttle started and stopped again.
- Actor timing yields to the browser every 50 ms instead of every 20 actors; token actors made those pauses ~0.8 s.

## 0.3.0

Changes driven by player reports from the same heavy world:

- **Frame rate fix**: the startup frame rate sample now counts rendered frames. It used to read PIXI's
  `ticker.FPS`, which reports skipped frames under a frame cap, so a client capped at 30 fps on a 144 Hz screen
  showed 63 fps.
- **Waiting for the server**: the timeline and the headline now show when the world data arrived. Before that point
  the page is idle while the server sends the world; a new finding says how long that took and that a faster
  computer doesn't shorten it. In the reports so far it was 10 to 22 seconds on both computers measured.
- **Token data**: the world data measurement breaks unlinked tokens' own data down by part (items, effects, system),
  by sidebar actor, and token by token, and counts item copies that are identical to the sidebar actor's item apart
  from timestamps. A new finding explains large item copies, and one flags linked tokens that still store data.
- **Settings**: the largest individual world settings are listed, not just totals by package.
- **Actor timing** also times the actors of unlinked tokens on every scene, which Foundry v13 builds at load.
- The world data measurement moved to its own file that is only fetched while the hook profiler is on, keeping the
  startup files at 46 KB, and the report shows how long the measurement took.
- Resource timings that browsers report as negative no longer subtract from package totals.

## 0.2.2

- Startup freezes now name what the measurements found inside them: the hook listener responsible (for example
  "sequencer's ready handler at 40.0 s") and how much of a setup freeze is actor preparation.
- The world data measurement (taken while the hook profiler is on) breaks scenes down by part (tokens and the
  actor data unlinked tokens carry, walls, tiles, flags...), lists the largest scenes and actors, and groups world
  settings by package. New findings explain large scene, actor and settings data.
- This module's own cost while profiling is kept out of the culprit lists (it still shows in the tables).
- The actor preparation finding states the total for all world actors.

## 0.2.1

- Findings now carry the button for their next step: turn on the hook profiler for a freeze around ready, time actor
  preparation for a freeze before setup, use the Low profile or measure layer costs for a low frame rate. Buttons
  disappear once that step has been done. Previously these lived in collapsed sections below the findings.
- The load time shared with the GM now counts until the ready handlers finish, not when the ready hook started.

## 0.2.0

Changes driven by the first real report from a heavy dnd5e world (158 modules, Intel HD 4600):

- **Layer costs**: a new measurement in the Canvas section shows how much frame time each part of the canvas costs
  on this computer, by hiding it briefly and counting frames.
- **Startup freezes**: single tasks that block the page for more than 5 seconds are now findings, with the startup
  phases they span and the tool to use next (hook profiler for ready-time freezes, actor timing for setup-time ones).
- **Real load time**: the timeline now shows when the ready handlers finished and when the page stopped freezing.
  The "ready" mark alone fires when the ready hook starts and could understate load time by more than half.
- **Live frame rate**: measured when the report opens if the one-minute startup sample hasn't finished.
- **Fewer false alarms**: content-only packs (maps, compendiums) no longer count as unverified modules, since they
  run no code.
- **Overlaps**: flags other active performance modules that change the same settings, and profile settings that
  something changed back after they were applied.
- The worst-frames table now includes startup frames, and long browser invoker names are shortened.
- The network section says when early file timings were already dropped by the browser before this module loaded.

## 0.1.0

First release: diagnostics report, opt-in hook profiler, optional CPU sampling, actor preparation timing, and
client profiles with idle frame-rate throttling.
