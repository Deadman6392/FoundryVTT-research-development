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

**Actor preparation timing** (button in the report): re-prepares every world actor and lists the slowest. dnd5e
preparation runs on every client at load and after every change to that actor.

**Client profiles** (GM-assigned or self-chosen): Balanced, Low, Minimum and Theater of the Mind. Each changes this
client's own display settings, lowers the number of chat messages rendered at startup, and lowers the canvas frame
rate while idle or unfocused. See [the guide](../../docs/performance-guide.md#the-client-profiles) for exactly what
each one changes.

## Install

The repository is private, so Foundry cannot install it from a manifest URL yet. Copy the
`modules/performance-triage` folder into your Foundry user data folder as `Data/modules/performance-triage`, restart
Foundry, and enable the module in your world. Every player's client runs it once it's enabled in the world.

## Use

1. *Configure Settings > Performance Triage > Open report.* Read the findings at the top.
2. To find expensive modules, expand **Hook listener profiler** and click **Enable profiler (reload)**. Play normally
   for a while, then reopen the report. Disable it again when you are done.
3. *Configure Settings > Performance Triage > Manage profiles* (GM only) to assign profiles. Players who have
   **Share a performance summary with the GM** on (the default) show their measured frame rate, load time and hardware
   there, with a suggested profile.

Players can always choose their own profile, or go back to *Unmanaged*, under *My performance profile*. Their original
settings are backed up the first time a profile changes them and restored exactly when it no longer does.

Macro access: `game.modules.get("performance-triage").api` exposes `openReport()`, `openProfiles()`,
`collectReport()` (returns the report object) and `recordCpuProfile(seconds)`.

## Cost of this module

It was written to the budgets in [CLAUDE.md](../../CLAUDE.md):

- 9 small files (~43 KB unminified) load at startup, all in one parallel wave. The report, profile manager and CPU
  sampler are loaded only when opened. No templates or stylesheets are fetched at startup.
- Always on: two `PerformanceObserver`s that only run when the browser already produced an entry (a file finished
  loading, or a frame took over 50 ms), folded into small aggregates immediately.
- With a profile: one passive input listener that stores a timestamp, a dozen trivial hook listeners, and a
  once-per-second check.
- Hook profiler, when enabled: two `performance.now()` calls per hook listener invocation. Its own listeners show up
  in its own tables.
- Summary sharing: one update to your own User document per session, about a minute after loading.

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
