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
- **Check large world settings.** The report lists the largest ones. A module storing a big menu or cache in a world
  setting costs every client on every load; its own options or its author can tell you whether it can be trimmed.
- **Look at items repeated on many tokens.** The report lists items with the same name and size on at least five
  tokens that the sidebar actor doesn't have, with the module flags they carry. In the world above they were generic
  actions (Dash, Shove, Hide, Stabilize...) that a module adds to every token when it's placed, which is why one
  token can weigh as much as a whole actor. If the module can add them to the sidebar actor instead, or skip NPCs,
  each actor holds one copy instead of every token holding its own. Copies already on tokens stay until removed.
- **Don't replace tokens to save space unless you've checked.** A token placed fresh from the sidebar actor carries
  no copies, but when the report says most copies are items the sidebar actor doesn't have, a fresh token would be
  missing them. Archiving the scene is the safe way to take those tokens out of the load.
- **Find leftover and repeated tokens.** The planner's *Tokens by actor* tab counts every token by the sidebar
  actor it was placed from and lists the scenes each actor's tokens are on, with a button per token that takes you
  to it. It shows an adventure that placed dozens of one creature, player characters left on old maps (linked
  copies cost little at load but turn up when the party returns), and unlinked copies of a character, which store
  the character's items and don't share its sheet. Sort by size to see which actor's tokens weigh the most.
- **Be careful moving NPCs out of the sidebar.** Every world actor is sent to and prepared by every client, but an
  unlinked token needs its sidebar actor to exist, including tokens on archived scenes that you may bring back. Only
  move actors no scene uses, and keep IDs if you do.

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
took the world data from 98.6 to 69.9 MB and Sequencer's ready handler from 9.3 to 3.0 s.

The report's *Load history on this computer* table keeps the last 20 loads, so each player can see the same
before-and-after for their own machine without anyone writing it down.

## The client profiles

Profiles change display settings on one player's computer only. Nothing about the world changes, the player's own
settings are backed up and restored if the profile is removed, and players can override the GM's choice in their own
module settings.

| Profile | For | Changes |
| --- | --- | --- |
| Balanced | Mid-range machines that are mostly fine | Medium performance mode, 50 chat messages rendered at startup, 20 fps while idle or unfocused |
| Low | Integrated graphics, older laptops | Low performance mode, 30 fps cap, no high-DPI rendering, no light or vision animation, no animated Token Magic FX filters, 25 chat messages at startup, 10 fps after 15 s idle |
| Minimum | Machines that struggle to show the map at all | Low, plus 20 fps cap, no mipmaps, no token drag preview, no chat bubbles or scrolling status text, no Sequencer effects, no FXMaster weather, 15 chat messages at startup, 10 fps after 5 s idle |
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
