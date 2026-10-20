# Making a heavy dnd5e table faster

This guide is for a GM running dnd5e with a large automation stack (midi-qol, DAE, premade-content modules, animation
modules and friends) where loading takes minutes and weaker computers struggle. It explains where the time actually
goes, how to find out which part is hurting your table, and what can and cannot be fixed from inside Foundry.

## Where the time goes

Every client, the GM's and each player's, pays four separate bills. They have different causes and different fixes,
which is why "disable modules until it's fast" is such a slow way to work.

**1. Downloading.** Each active package adds JavaScript, CSS, templates and language files, and the world itself is
sent as one large payload: every chat message, every world actor and item, and the compendium indexes of every active
package. A thousand-plus files over a home connection with HTTP/1.1 is often the single largest part of load time.
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
5. **Only now, decide about modules.** With numbers in hand, you can see whether a module's cost is worth its feature.
   Often it's one or two modules and a few settings, not "too many modules".

Re-run the report after each change; it's quick, and it keeps you from guessing.

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
