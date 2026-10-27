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

**Frame rate during play** (GM setting *Measure frame rate during play*, off by default): every computer counts
the frames it draws in five-second stretches while its window has focus and isn't idle-throttled, per scene, and
notes the long frames (over 50 ms) from each token move on the scene it is viewing until two seconds after its
animation ends (automation such as Chris's Premades waits for the animation before doing its work), with the
script time in them by module. The report shows this session and the previous one; players who share a summary
send their previous session's numbers with the summary they already send once per session, so *Client profiles*
shows each player's slowest scene, and a slow scene counts toward the suggested profile. Frames under 50 ms aren't
attributed to modules (the browser only reports longer ones), so the move numbers are the stutter players notice,
not all the work a move causes.

**Settings that cost on every move** (report, GM): the current values of module settings known to add work on every
token move or frame, read from each module's source at a stated version: Chris's Premades' Movement Event Accuracy,
ActiveAuras' walls block auras (and its combat-only option, which doesn't stop movement checks in 0.12.4 to 0.12.7),
Levels' exact token visibility and token elevation scale, and midi-qol's walls block range rule. With two or more
aura modules active (Chris's Premades, ActiveAuras, Aura Effects), it counts the auras each has in the world's actors
and tokens, since a module with none still checks on every move. The move findings explain where each of those
modules does its work (Chris's Premades and ActiveAuras on one GM's computer, Aura Effects on the mover's).

**Render scale** (client setting, per computer): draws the map at 85%, 75%, 60% or 50% of the screen's pixels and
lets the browser stretch it. Everything is still drawn (lights, weather, filters, animations), just less sharply,
so it is the setting to try when a computer's graphics card is the bottleneck. It doesn't help stutters from
automation, which are CPU work. It is applied through Foundry's `canvasConfig` hook before the canvas is created, so
it needs a reload. Not yet included in any profile.

**Lighting resolution** (client setting, per computer): draws light and light colours at 75%, 50% or 25% of the
canvas resolution while the map, tokens and interface stay sharp, or picks the step automatically. Foundry draws every light
over the area it reaches, once per lighting layer, on every frame, so lighting costs in proportion to pixels even when
nothing animates; a light's glow is a smooth gradient and survives being drawn smaller, though edges at walls get
softer. It lowers the resolution of the masking filter the illumination and coloration layers already draw through,
applies straight away and to every scene drawn after, and 100% restores Foundry's own values. The background layer
(lights recolouring the map itself) is left alone, since drawing it smaller would blur the map. In headless Chromium
with PIXI 7.4.2, 40 overlapping lights in a filtered container drew in 37% of the time at 50%, with the picture
changing only at light edges. On the measured world's work PC (Intel HD 4600), zoomed in on a 48-light interior,
lighting cost 51.5 ms of a 74 ms frame; at 50% the frame took 40 ms, 15 fps became 23 to 24, and the GM saw no
difference in the lights. 25% is there for computers that still fall behind at 50%; it softens light edges at walls.

*Automatic* is for the computer nobody will tune mid-session: it keeps full resolution until this computer falls
below 80% of its frame cap on a scene for two 3-second checks in a row, then lowers lighting a step. It keeps the step
only if the frame rate rose by 8% or more (when it doesn't, lighting wasn't the bottleneck and it goes back), tries
the sharper step again after the frame rate has held near the cap and ten minutes have passed, and remembers each
scene's step for the session. It pauses while the idle throttle is lowering the frame rate, while the tab is hidden,
and while a measurement runs, and ignores checks that contain a stall (a frame over 400 ms, such as the page finishing
loading or a module's long hook), which lighting can't fix. It says once per session when it first lowers lighting;
the report lists every step with the frame rate before and after. On the work PC it went from
100% to 75% (15 to 18.7 fps) and then 50% (23.9 fps) within ten seconds of falling behind. The Balanced, Low and
Minimum profiles set it, so a computer the GM assigns one of them gets it without anyone opening a setting.

**Layer costs** (button in the report's Canvas section): hides each part of the canvas in turn (token filters, tokens,
tiles, lighting, fog and vision, interface, full-screen filters) and times how long a frame takes to draw with it
hidden. Each frame is drawn between two pixel read-backs, which wait for the graphics card to finish, so it measures
the whole cost of drawing whatever the frame cap or the screen's refresh rate: before 0.12 it counted frames, and a
computer that keeps up with its screen (a 144 Hz desktop) showed every layer as free. Draws with and without each
change alternate, so a computer that speeds up or slows down during the test affects both alike. It measures
drawing, not per-frame scripts (particle updates, animations). Lighting costs more the further you zoom in (every
pixel on screen is then inside several lights), so measure at the zoom players use. When lighting or the interface costs 5 ms a frame or a fifth of the
frame, it also measures their parts (illumination, light colours, background changes and darkness; grid, drawings,
templates, regions, notes and token bars). For lighting it also hides just the lights while keeping the layers,
which splits the cost that grows with lights from each layer's fixed work, hides tokens' vision on its own, and tries
lighting at half its current resolution. Each saving comes with its margin (from how much the paired draws varied),
and one inside its margin is reported as not measurable; the table notes the zoom and whose vision was drawn. It
takes 30 seconds to a minute, only changes what this client draws while it runs, and puts everything back
afterwards. This is the tool for "low frame rate while nothing is moving".

**Light coverage** (report, Canvas section): how many times over the scene's lights cover its area, how much of it
they reach and how many overlap there on average, using the shapes Foundry draws them with (walls applied). It lists
the largest lights with their share of all light area and how many other lights cover the same ground, and the GM can
select them on the lighting layer to edit. A finding appears when lights cover more than the scene's area or overlap
two deep.

**Client profiles** (GM-assigned or self-chosen): Balanced, Low, Minimum and Theater of the Mind. Each changes this
client's own display settings, lowers the number of chat messages rendered at startup, and lowers the canvas frame
rate while idle or unfocused. Balanced and Low lower quality without removing things where modules allow it
(FXMaster thins weather with Foundry's performance mode; Token Magic FX filters are frozen, not removed; Sequencer's
above-interface effects move into the map); Minimum removes effects. See
[the guide](../../docs/performance-guide.md#the-client-profiles) for exactly what each one changes.

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

- 9 small files (~56 KB unminified) load at startup, all in one parallel wave. The report, profile manager, scene
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
- Summary sharing: one update to your own User document per session, about a minute after loading. With frame rate
  tracking on, it also carries the previous session's per-scene numbers (up to eight scenes, under 1 KB).
- Frame rate during play, while the GM has it on: one increment per rendered frame, a check every 5 seconds, a
  `moveToken` listener, a short timer per token move (after its animation), and the long frames the browser already
  reports. A summary is written to this browser's localStorage when the page is hidden or closed.
- Render scale: one `canvasConfig` listener, which runs once when the canvas is created.
- Lighting resolution, while below 100%: one `canvasReady` listener that sets two numbers when a scene is drawn. The
  lighting itself then costs less; there is no per-frame work.
- Lighting resolution on Automatic: one more small file fetched when it is chosen, one increment per rendered frame,
  a check every 3 seconds, and a `canvasReady` listener, on this computer only. At most one notification per session.
- Light coverage, each time the report opens on a drawn scene: about 12,000 point tests against the lights' shapes,
  about 30 ms in Node for 50 lights with 300-point shapes.
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
