# Making a heavy dnd5e table faster

This guide is for a GM running dnd5e with a large automation stack (midi-qol, DAE, premade-content modules, animation
modules and friends) where loading takes minutes and weaker computers struggle. It explains where the time actually
goes, how to find out which part is hurting your table, and what can and cannot be fixed from inside Foundry.

## Where the time goes

Every client, the GM's and each player's, pays four separate bills. They have different causes and different fixes,
which is why "disable modules until it's fast" is such a slow way to work.

**1. Downloading.** Each active package adds JavaScript, CSS, templates and language files, and the world itself is
sent as one large payload: every scene with all its tokens, walls and lights, every chat message, every world actor
and item, every world setting, and the compendium indexes of every active package. A thousand-plus files over a home connection with HTTP/1.1 is often the single largest part of load time.
See [hosting.md](hosting.md).

**2. Startup work.** Each module's code is parsed and run, then every module's `init`, `setup` and `ready` handlers run
in sequence. dnd5e then prepares every world actor, which includes applying their active effects. A weak CPU feels
this far more than a strong one; the same world can take 10 seconds on one machine and 90 on another.

**3. Drawing the map.** The canvas re-renders every frame: lighting, vision, animated lights, video tiles, token
effects, weather particles, spell animations. This is mostly GPU work, and integrated laptop graphics share memory
with everything else. Screen pixel density multiplies it: a 2x laptop display draws four times the pixels.

**4. Reacting to events.** Every token move, roll, chat message and actor update fires hooks, and every module that
listens runs its code, often on every connected client. An automation stack can do a lot of work per attack roll.
This is what makes combat stutter.

A module cannot rewrite other modules' code, and it cannot shrink what the server sends except by helping you clean
up the world. It can measure all four bills per client and per module, and it can turn down bill 3 on the computers
that need it. That's what Performance Triage does.

## A process that works

1. **Measure before changing anything.** Install Performance Triage, load the world, and open
   *Configure Settings > Performance Triage > Open report*. Ask your slowest player to do the same and send you the
   result with **Copy as Markdown**. The findings at the top are ranked; the sections below hold the evidence.
2. **Take the free wins.** These cost nothing in features:
   - Any *debug logging* finding. Verbose logging left on (a module's debug setting, or `CONFIG.debug.*`) runs on hot
     paths for everyone who has it.
   - A large chat log. Export it with the export button in the chat sidebar, then clear it between arcs.
   - Hundreds of world actors or items. Keep what you're not using in compendiums.
   - Oversized images. Maps above about 4096 px on the long side cost GPU memory for no visible gain at normal zoom.
     WebP at quality 80 to 85 is typically much smaller than PNG.
   - Hosting findings, if you control the server.
3. **Find the expensive modules.** In the report, turn on the *hook profiler* (it needs a reload and adds a small
   overhead, so do it for one session, not forever). Play normally, then refresh the report. The tables show which
   modules spend the most time in hook handlers and which ones caused the long frames players felt as stutters. If
   you can add one header to your proxy, the *CPU profile* shows the complete picture including libWrapper wrappers.
4. **Give weak computers a lighter client.** Under *Client profiles*, assign Balanced, Low or Minimum to the players
   who need it. Players who share their summary show measured frame rates and load times there, with a suggestion.
   If a weak computer is still slow on a quiet scene, have that player run *Measure layer costs* in the report's
   Canvas section. It shows how many milliseconds per frame tokens, token filters, tiles, lighting, fog and screen
   filters each cost on their machine, so you know what to change on the scene.
5. **Only now, decide about modules.** With numbers in hand, you can see whether a module's cost is worth its feature.
   Often it's one or two modules and a few settings, not "too many modules".

Re-run the report after each change; it's quick, and it keeps you from guessing.

## Shrinking the world data

Before a player's computer does anything, it waits for the server to send the whole world. The report's timeline
marks when that data arrived; on the 140 MB world these notes were written against, every client waited 10 to 22
seconds for it, a 16-thread desktop as long as an 8-thread work PC. Then the computer builds every document from it,
which does depend on the CPU: about 10 seconds on the desktop and 23 on the work PC for the same world. A smaller
world shortens both, for everyone, and it's the part a GM can work on between sessions.

Turn on the hook profiler for one load to get the *World data sent to every client* section. In that world, scenes
were three quarters of it, and most of that was unlinked tokens' own copies of their items: 946 of 964 unlinked
tokens carried 16,471 item copies, 89 MB. An unlinked token normally stores only what differs from its sidebar actor,
so a full set of copies means each token carries its own version of every item. The report counts those copies,
groups them by sidebar actor, and splits them into items that differ from the sidebar actor's version, items the
sidebar actor doesn't have, and identical copies. In that world 16,329 of the 16,471 were items the sidebar actors
don't have: those tokens are the only place the items exist.

What helps, roughly in order of effort:

- **Archive areas nobody is near.** The scene planner's *Archive plan* (GM only) groups scenes by folder and ranks the folders
  by how much archiving them saves. It marks scenes that need prep first: journal entries on the map (keep them
  reachable from the Journal tab), and ways in from other areas, such as a teleport region in a scene that stays (if
  players head through one, bring the area back first). Then create a Scene compendium for the area, right-click the
  folder, *Export to Compendium* with the option to keep IDs ticked, and delete those scenes from the world, except
  any in use. A compendium is not sent at startup beyond its index. To bring the area back, use that compendium's
  *Import All* with its keep-ID option ticked; with the same IDs, journal links, teleport regions, tile triggers and
  map notes work again. Dragging a single scene out of a compendium can give it a new ID, so one compendium per area
  is easier than one big archive. Archiving deletes players' explored fog of war on those maps, and it doesn't come
  back with them: the planner marks maps players have explored, so archive areas the party hasn't been to first, or
  accept that they'll be unexplored again. Once areas are archived, the planner's *In compendiums* section lists them and the teleport regions or tile
  triggers in the world that lead into them, so you know which exits need the area brought back first.
- **Check large world settings.** The report lists the largest ones, with how many entries a list setting holds and
  how many repeat another entry's label (a menu imported twice looks like that). A module storing a big menu or
  cache in a world setting costs every client on every load; its own options or its author can tell you whether it
  can be trimmed. Export a backup from the module's own menu before removing anything.
- **Remove settings of modules you've dropped.** Foundry keeps a module's world settings after the module is
  disabled or uninstalled, and still sends them to every client. The report lists them as settings of packages
  that aren't active. If you won't turn the module back on, a GM can delete one with a script macro:
  `await game.settings.storage.get("world").getSetting("<key>")?.delete()`, with the key from the *Largest world
  settings* table. A module can store settings under a name other than its id, so check the module list first.
- **Look at items repeated on many tokens.** The report lists items with the same name and size on at least five
  tokens that the sidebar actor doesn't have, with the module flags they carry. In the world above they were generic
  actions (Dash, Shove, Hide, Stabilize...) that a module adds to every token when it's placed, which is why one
  token can weigh as much as a whole actor. If the module can add them to the sidebar actor instead, or skip NPCs,
  each actor holds one copy instead of every token holding its own. Copies already on tokens stay until removed.
- **Don't replace tokens to save space unless you've checked.** A token placed fresh from the sidebar actor carries
  no copies, but when the report says most copies are items the sidebar actor doesn't have, a fresh token would be
  missing them. Archiving the scene is the safe way to take those tokens out of the load.
- **Find leftover and repeated tokens.** The planner's *Actors and tokens* tab counts every token by the sidebar
  actor it was placed from and lists the scenes each actor's tokens are on, with a button per token that takes you
  to it. It shows an adventure that placed dozens of one creature, player characters left on old maps (linked
  copies cost little at load but turn up when the party returns), and unlinked copies of a character, which store
  the character's items and don't share its sheet. Sort by token data to see which actor's tokens weigh the most.
- **Move actors no scene uses to a compendium.** Every world actor is sent to every client and prepared on it at
  load (2.7 s for 377 actors on the GM's desktop in the world below, more on a weaker machine). Once the tokens are
  gone, most sidebar NPCs are only there to be dragged out later. *Actors and tokens* with *On no scene* ticked lists
  them, heaviest first, with the journal entries and macros that link to each. Put the ones you won't need soon in a
  folder, right-click it, *Export to Compendium* with the option to keep IDs, and delete them from the world. Bring
  them back with the compendium's *Import All*, keeping IDs, so tokens on archived scenes and journal links find
  them again; dragging a single actor out can give it a new ID, and a token whose actor has a different ID has no
  sheet. Tokens on archived scenes aren't checked, so bring an area's actors back before the area.

### What archiving one area did

Archiving 39 of 128 scenes in that world, measured on the GM's desktop before and after:

| | Before | After |
| --- | --- | --- |
| World data | 141.8 MB | 98.6 MB |
| Scenes / unlinked tokens | 128 / 964 | 89 / 649 |
| Waiting for the server | 10 to 15 s | 7.8 s |
| Building the world (init to setup) | 9.9 to 11.0 s | 9.2 s |
| Sequencer's GM-only ready handler | 16.0 to 16.6 s | 10.1 s |
| Time until usable (GM) | 46 to 48 s | 36 s |

Two things it showed. The server wait and Sequencer's check shrink with the world; the world build barely does,
because a token's actor is only built when something first reads it (drawing its scene, or Sequencer's check), so
most of the build is world actors and the other documents. And Sequencer's freeze is the GM's alone: its migration
check reads every token's actor on every scene, on the GM only.

Later, removing the adventure's original copies of maps the GM had rebuilt (89 to 61 scenes, 751 to 304 tokens)
took the world data from 98.6 to 69.9 MB and Sequencer's ready handler from 9.3 to 3.0 s. Clearing the remaining
tokens off the maps (61 to 43 scenes, 304 to 12 tokens) took it to 42 MB, all ready handlers to 1.0 s and the time
until usable to 20 s, from 46 to 48 s before any of this. Actors were then over half of what was left.

The report's *Load history on this computer* table keeps the last 20 loads, so each player can see the same
before-and-after for their own machine without anyone writing it down.

## Frame rate during play

A heavy table has two different frame rate problems, and they have different fixes.

- **A low frame rate that stays low** on some scenes. That is drawing cost: lights and their soft edges, weather
  particles, Token Magic FX filters, video tiles and effects, multiplied by the number of pixels on the screen. It
  is usually the graphics card, and it is different on every player's computer.
- **Stutters** when something happens: a token moves, an attack rolls, an aura turns on. That is CPU work in a
  burst, mostly automation modules reacting to the change, plus Foundry recomputing vision and lighting.

Turn on *Measure frame rate during play* in this module's settings (GM), play a session, and every computer keeps
its frame rate per scene and the work after each token move, by module. Each player's report shows it, and players
who share a summary send their previous session's numbers at their next load, so *Client profiles* shows each
player's slowest scene without anyone exporting anything.

**For a scene that stays slow on a computer:** open it there and run *Measure layer costs* (report, Canvas section)
to see which part of the drawing costs the most. When lighting or the interface costs 5 ms a frame or more, it
measures their parts too: illumination, light colours, background changes and darkness; grid, drawings, templates,
regions, notes and token bars. On the measured world's work PC (Intel HD 4600, Low profile, 30 fps cap), an
interior with 48 lights, 623 walls and rain drew at 11.6 fps; hiding lighting took it to 28 fps, 50.5 ms of an
86 ms frame. The rain, at a quarter of its particles on Low, cost 2.9 ms. Then, cheapest to see first:

- **Render scale** (this module's settings, per computer): draws the map at 85%, 75%, 60% or 50% of the screen's
  pixels and stretches it. Nothing is removed, everything is just less sharp, and 75% draws a little over half the
  pixels. It needs a reload, and it is new: try it on one computer before relying on it.
- **Lighting resolution** (this module's settings, per computer, experimental): draws lights at 75% or 50% of the
  canvas resolution, map and tokens untouched. See *Lighting* below.
- **Less light overlap on heavy scenes.** Each light is drawn every frame over the area it reaches, on every
  computer. See *Lighting* below.
- **Foundry's performance mode** (the Balanced and Low profiles set it): besides Foundry's own quality, FXMaster
  reads it to thin out weather particles, to half on Medium and a quarter on Low, and Dice So Nice lowers its quality
  on Low for players who haven't customized it. FXMaster's filter effects (fog, colour) don't scale.
- **The Low profile** freezes animated Token Magic FX filters (they are still drawn), turns off light and vision
  animation, and draws Sequencer's above-interface effects in the map instead of a second full-window canvas over
  the interface, which Sequencer's own settings describe as a significant performance hit.
- **Minimum** removes things instead: Sequencer effects are hidden (they still load and play, just aren't drawn),
  FXMaster weather is off, and Aura Effects' radius drawings are off on that computer.

### Lighting

Two reports from that work PC on the same interior, one at full render scale and one at 75%, show what lighting
costs and why. At full scale lighting cost 44.8 ms of a 74 ms frame: 22.5 ms for light colours, 16.7 for
illumination, 4.1 for lights changing the map under them and 2.1 for darkness. At 75% it cost 25.1 ms, 56% as much
for 56% of the pixels. The cost follows pixels almost exactly, so it is the graphics card shading every pixel each
light covers, once per lighting layer, on every frame. That is why Low performance mode doesn't help a plain orange
torch: Low stops lights animating, but a still light is drawn again on every frame just the same.

So what counts is the area lights cover on screen and how many overlap there, not how many lights there are. Twenty
sconces in separate rooms, each clipped by its walls, draw each room once; three lights whose radii all reach across
one hall draw that hall three times. In practice:

- **Overlap, not count.** Let each sconce in a corridor reach about as far as the next one instead of across the
  whole corridor; dim radius past the next light is drawn even where that light already lights the floor. One light
  for a cluster of candles.
- **Walls.** A light that ignores walls (natural light, scenery) is drawn through every room in its radius. Keep
  walls on unless it really has to shine through.
- **Big ambient lights first.** The report's light table lists the scene's largest lights with how much of all the
  light area each one is, and how many other lights cover the same ground. A room-sized ambient light under a dozen
  torches is often the cheapest win.
- **Fewer pixels.** Render scale lowers everything; Lighting resolution lowers only the lights, which are smooth
  gradients and lose less from it. *Measure layer costs* tries half-resolution lighting on that computer and shows
  what it saves, and also hides just the lights while keeping the layers, so you can see how much of lighting grows
  with the lights at all (the rest is each layer's fixed work over the screen, which no amount of light pruning
  removes).

What this can't tell you: whether a light's tint or animation type costs more than another's. The measurements hide
whole layers or all lights at once; per-light shader cost isn't something the browser exposes.

**For stutters when tokens move:** the report counts how long frames took beyond the scene's normal frame time after
each move, and names the modules whose scripts ran in them (drawing the canvas itself is left out). On a computer
that draws a scene at 12 fps every frame is over the browser's 50 ms long-frame mark, so only time beyond that
scene's normal pace counts as a stall, and only frames over 2.5 times it count as stutters. What the common ones do, read from their source (versions in brackets):

- **Chris's Premades** (1.5.51) does all its movement work on one GM's computer: the last GM to load, unless
  midi-qol names a preferred GM. Players never pay for it, so a GM laptop that stutters on every move is the
  machine to look at. On each leg of a move it measures the distance, with walls, from the moving token to every
  token on the scene before checking for movement macros. *Movement Event Accuracy* (CPR settings, General) sets
  how much: Medium does that only for the last leg; Low also drops the wall test from those checks, so a "moves near"
  effect could trigger through a wall. Auras are checked when a move ends, with walls, at every level, so lowering it
  keeps them working. Its option to disable the lag warning only hides the warning.
- **ActiveAuras** (0.12.7) checks auras on the GM's computer on every position update, and rechecks every aura on
  the scene whenever a wall changes, which includes opening a door. Its combat-only option doesn't stop the movement
  checks in 0.12.4 to 0.12.7. With *walls block auras* on, a token and aura pair can take up to 50 wall tests per move.
- **Aura Effects** (1.5.2) checks on the computer of whoever moved the token, often a player's, and redraws aura
  radii on every computer while tokens move. With Foundry's vision animation off (Low profile) it only redraws auras
  that appear or disappear; its own *Disable visuals* (per computer) stops the drawing. Auras marked combat-only skip
  their range checks outside combat.
- **midi-qol**'s distance checks are the ones CPR uses; its *walls block range* rule decides their cost, and the
  Levels and cover variants test more than the default. That rule changes how attacks work, not just speed.
- **Levels**: *exact token visibility* runs 11 sight tests per token instead of 5, and *token elevation scale*
  refreshes every token on each elevation or selection change.

With more than one aura module active, the report counts the auras each one has in your world. A module with none
still does its work on every move.

What this can't do: it can't make a module's automation itself cheaper. It shows where the time goes and which of
that module's own settings change it; past that, the choice is between the feature and the frame rate.

## The client profiles

Profiles change display settings on one player's computer only. Nothing about the world changes, the player's own
settings are backed up and restored if the profile is removed, and players can override the GM's choice in their own
module settings.

| Profile | For | Changes |
| --- | --- | --- |
| Balanced | Mid-range machines that are mostly fine | Medium performance mode (FXMaster weather at half its particles), 50 chat messages rendered at startup, 20 fps while idle or unfocused |
| Low | Integrated graphics, older laptops | Low performance mode (weather at a quarter), 30 fps cap, no high-DPI rendering, no light or vision animation, no animated Token Magic FX filters, Sequencer's above-interface effects drawn in the map, 25 chat messages at startup, 10 fps after 15 s idle |
| Minimum | Machines that struggle to show the map at all | Low, plus 20 fps cap, no mipmaps, no token drag preview, no chat bubbles or scrolling status text, no Sequencer effects, no FXMaster weather, no Aura Effects radius drawings, 15 chat messages at startup, 10 fps after 5 s idle |
| Theater of the Mind | Machines that cannot draw the map | Turns the game canvas off; sheets, chat and rolls still work |

Third-party settings only apply when that module is active. The **idle throttle** lowers the canvas frame rate when
nothing is happening (no input, no token movement, no animation running) and restores it instantly on any input or
scene change. Foundry otherwise keeps redrawing an unchanging map at full frame rate, which is wasted heat and battery
on a laptop.

Dice So Nice already lowers its own rendering quality when Foundry's performance mode is Low, unless the player has
customized it, so the Low profile covers it.

## Related modules worth knowing about

- **Prime Performance** (`fvtt-perf-optim`): batches the drawing of token bars and status effects. It targets big
  battles with many tokens, a different cost from anything here, so the two are complementary.
- **Performance Optimizer** (`performance-optimizer`): GM-managed client presets with a live FPS chart. It covers much
  the same ground as the client profiles here but requires Foundry v14; if you're on v14 and only need profiles,
  compare the two.
- **Find the Culprit** (`find-the-culprit`): bisects your module list to find which one causes a specific problem.
  Use it when something is broken, not just slow.

## Sharing a report

The report's **Copy as Markdown** produces a text summary that's easy to paste into an issue or a chat with whoever is
helping you. **Download JSON** saves everything, including tables the Markdown summary trims. Neither includes chat
content or document data; beyond counts and timings, they contain the names of users, modules and the heaviest
actors, the current scene's name and image paths, and each client's GPU name.
