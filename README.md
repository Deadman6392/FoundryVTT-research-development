# FoundryVTT research & development

Foundry VTT modules focused on making a heavy dnd5e table run well on every player's computer.

| Module | What it does | Status |
| --- | --- | --- |
| [Performance Triage](modules/performance-triage) | Measures what slows each client down (load, files per module, stutters, hook costs, GPU memory, world bloat) and lets the GM give weak computers a lighter client profile. | 0.1.0, Foundry v13 |

## Guides

- [Making a heavy dnd5e table faster](docs/performance-guide.md): where load and frame time go, and a process for
  fixing it with measurements instead of guesswork.
- [Hosting](docs/hosting.md): HTTP/2, compression, and the optional CPU-profiling header.

## Installing a module

Copy `modules/<module-id>` into your Foundry user data folder as `Data/modules/<module-id>`, restart Foundry, and enable
it in your world.

## Development

Requires Node 22 or newer; there are no dependencies to install.

```sh
npm test        # unit and lifecycle tests
npm run check   # manifest, syntax, localization and load-budget checks
```

[CLAUDE.md](CLAUDE.md) holds the conventions and the performance rules every module here follows.
