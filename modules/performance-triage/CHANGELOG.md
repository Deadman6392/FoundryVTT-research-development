# Changelog

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
