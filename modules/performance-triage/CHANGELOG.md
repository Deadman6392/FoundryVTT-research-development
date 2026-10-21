# Changelog

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
