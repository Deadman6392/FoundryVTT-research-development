# Performance Triage

Find out what is slowing your Foundry VTT game down, and give struggling players a lighter client.

Built for dnd5e tables running large automation stacks, but nothing in it is system-specific except a few report
labels. Requires Foundry VTT v13 (v14 is expected to work but is not yet verified).

## What it does

**Diagnostics report** (every user, for their own client): load timeline, files and bytes per module, whether your
server uses HTTP/2 and compression, stutters (long frames) attributed to the module that caused them, GPU memory and
the largest images on the scene, world bloat (chat log, world actors, compendium indexes), modules not verified for
your Foundry version, debug logging left on, and a ranked list of findings with fixes. Export as Markdown or JSON.

**Hook profiler** (opt-in, per client): times every hook listener and attributes it to the module that registered it,
with exclusive "self" time so nested hooks aren't double counted. It also measures the size of each part of the world
data at startup. Turn it on for a session, read the tables, turn it off.

**CPU profile** (optional): when the server sends `Document-Policy: js-profiling` (see
[docs/hosting.md](../../docs/hosting.md)), records 20 seconds of real CPU samples and charges time to the module
responsible, including inside libWrapper wrappers.

**Actor preparation timing** (button in the report): re-prepares every world actor, and the actor of every unlinked
token on every scene, and lists the slowest actors and scenes. World actors are prepared on every client at load and
after every change to them. A token's actor is built when something first reads it: drawing its scene, or a module
that walks every token (Sequencer's GM-only startup check does).

**Scene planner** (GM only, *Configure Settings > Performance Triage > Open the scene planner*, or the buttons on
the report's scene and token findings) has two tabs.

*Archive plan* groups scenes by folder, since Foundry exports a whole folder to a compendium in one
step, and ranks the folders by how much world data archiving them would take off every player's load. Each scene is
marked "archive, no prep", "archive after prep" (it has journal entries on its map, or a teleport region or tile
trigger in another area leads to it), "small" or "in use now" (the active scene, or one an online player is viewing).
Links from journal entries and macros are listed but need no prep: with IDs kept they work again when the scene comes
back. **Time token actors** adds how long each scene's unlinked tokens take to prepare, and **Copy prep checklist**
copies a per-area Markdown checklist with the archive and restore steps. Once areas are archived, *In compendiums*
lists the world's Scene compendiums and the teleport regions or tile triggers in world scenes that lead into them.
Maps players have explored are marked, because archiving deletes their explored fog of war (it doesn't come back with
the scene); the planner asks the server for an index of fog records (scene and user only) when it opens. It reads the world and changes nothing; the
archiving itself is done with Foundry's own Export to Compendium and Import All, keeping IDs.

*Actors and tokens* lists every sidebar actor with the tokens placed from it on every world scene, most tokens
first, with columns for the number of scenes, the most on one scene, the size its tokens add to the world data and
the size of the actor itself. Click a column to sort by it, and an actor to list the scenes its tokens are on with
each token's name. Each token has a button that views its scene (for you only; players stay where they are),
selects the token and centres on it, so a leftover copy is one click and a Delete away. A filter matches actor,
token, folder and scene names; *Player-owned only* narrows it to characters and anything else a player owns, and
*On no scene* to actors no world scene uses, which are the candidates for an Actor compendium. Opening one of those
shows its folder and the journal entries and macros that link to it. Above the table it lists scenes with more than
one token of the same player-owned actor and unlinked copies of player-owned actors, which don't share the
character sheet. Counts update as tokens are created or deleted while the tab is open. Tokens on scenes in
compendiums aren't counted, and links from other modules' data (an item pile, a summoning feature) aren't seen.

**Load history** (in the report's timeline): the last 20 loads in this browser, labelled with who logged in, with time until usable, the wait for
the server, the world build, ready handlers, scene and token counts and the frame rate, so the effect of a change
(archiving an area, disabling a module) shows up as numbers.

**Layer costs** (button in the report's Canvas section): hides each part of the canvas for a few seconds (token
filters, tokens, tiles, lighting, fog and vision, interface, full-screen filters) and measures how much frame time each
one costs on this computer. It takes about 30 seconds, only changes what this client draws while it runs, and puts
everything back afterwards. This is the tool for "low frame rate while nothing is moving".

**Client profiles** (GM-assigned or self-chosen): Balanced, Low, Minimum and Theater of the Mind. Each changes this
client's own display settings, lowers the number of chat messages rendered at startup, and lowers the canvas frame
rate while idle or unfocused. See [the guide](../../docs/performance-guide.md#the-client-profiles) for exactly what
each one changes.

## Install

In Foundry's setup screen, open *Add-on Modules > Install Module* and paste this manifest URL:

```
https://raw.githubusercontent.com/Deadman6392/FoundryVTT-research-development/main/modules/performance-triage/module.json
```

Then enable the module in your world; every player's client runs it from then on. Foundry checks the same URL for
updates.

To run unreleased code instead, copy the `modules/performance-triage` folder to `Data/modules/performance-triage`.

## Use

1. *Configure Settings > Performance Triage > Open report.* Read the findings at the top.
2. To find expensive modules, expand **Hook listener profiler** and click **Enable profiler (reload)**. Play normally
   for a while, then reopen the report. Disable it again when you are done.
3. *Configure Settings > Performance Triage > Open the scene planner* (GM only) when the world data is large; see
   [Shrinking the world data](../../docs/performance-guide.md#shrinking-the-world-data).
4. *Configure Settings > Performance Triage > Manage profiles* (GM only) to assign profiles. Players who have
   **Share a performance summary with the GM** on (the default) show their measured frame rate, load time and hardware
   there, with a suggested profile.

Players can always choose their own profile, or go back to *Unmanaged*, under *My performance profile*. Their original
settings are backed up the first time a profile changes them and restored exactly when it no longer does.

Macro access: `game.modules.get("performance-triage").api` exposes `openReport()`, `openProfiles()`,
`openScenePlan()`, `collectReport()` (returns the report object) and `recordCpuProfile(seconds)`.

## Cost of this module

It was written to the budgets in [CLAUDE.md](../../CLAUDE.md):

- 9 small files (~48 KB unminified) load at startup, all in one parallel wave. The report, profile manager, scene
  planner, CPU sampler and layer cost measurement are loaded only when opened. No templates or stylesheets are fetched at startup.
- Always on: two `PerformanceObserver`s that only run when the browser already produced an entry (a file finished
  loading, or a frame took over 50 ms), folded into small aggregates immediately.
- For the first minute after loading (when summary sharing is on): a frame counter on the canvas ticker, one
  increment per rendered frame, and a check every 5 seconds. Both stop after the minute.
- With a profile: one passive input listener that stores a timestamp, a dozen trivial hook listeners, and a
  once-per-second check.
- Hook profiler, when enabled: two `performance.now()` calls per hook listener invocation. Its own listeners show up
  in its own tables. It also measures the world data once, right after init, from a file that is only fetched while
  the profiler is on. That takes a fraction of a second for a 140 MB world on a desktop (about 0.55 s in Node for a
  synthetic 124 MB world) and the report shows how long it took on your computer.
- Summary sharing: one update to your own User document per session, about a minute after loading.
- Scene planner, while its *Actors and tokens* tab has been opened and the window is open: a `createToken` and a
  `deleteToken` listener that recount once a burst of changes settles. A count took 20 to 75 ms for 377 actors
  (23 MB) and about 30 ms for 300 tokens carrying 22 MB of item copies, measured in headless Chromium.
  Both are removed when the window closes. Nothing is listened to otherwise.
- Load history: one timer a minute after loading, which writes one small entry to this browser's localStorage. It is
  never sent anywhere.

## Why it is marked as a library

The manifest sets `"library": true` because Foundry loads library modules before other packages, which lets the hook
profiler see (and attribute) hook registrations from almost every other module. It has user-facing features, so this
is a deliberate trade-off rather than an accurate label.

## Limitations

- Report text is English only for now; settings and dialogs are localized.
- The hook profiler measures only the synchronous part of each listener, which is the part that blocks a frame.
  Listeners registered before this module loaded (core, sometimes the system and earlier libraries) are timed but
  listed as "registered before profiler".
- Long-frame attribution and CPU profiling need a Chromium-based browser or the Foundry desktop app.
- Some changes from a profile only take effect after a reload; the module asks when that's the case.
