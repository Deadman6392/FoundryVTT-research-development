# FoundryVTT research & development

Foundry VTT modules for a heavy dnd5e table: making it run well on every player's computer, and keeping it looking
the way the table likes.

| Module | What it does | Status |
| --- | --- | --- |
| [Performance Triage](modules/performance-triage) | Measures what slows each client down (load, files per module, stutters, hook costs, GPU memory, world bloat) and lets the GM give weak computers a lighter client profile. | 0.13.0, Foundry v13 |
| [FlexUI Revived](modules/flexui-revived) | Ten interface themes for v13 (the four FlexUI originals plus horror, neon, infernal, frost and faerie presets) with bundled free icons, textures and fonts, optional low-cost ambient motion, a GM table default, and styles that yield to other modules. | 0.2.0, Foundry v13 |

## Guides

- [Making a heavy dnd5e table faster](docs/performance-guide.md): where load and frame time go, and a process for
  fixing it with measurements instead of guesswork.
- [Hosting](docs/hosting.md): HTTP/2, compression, and the optional CPU-profiling header.

## Installing a module

In Foundry's setup screen, open *Add-on Modules > Install Module* and paste the module's manifest URL:

| Module | Manifest URL |
| --- | --- |
| Performance Triage | `https://raw.githubusercontent.com/Deadman6392/FoundryVTT-research-development/main/modules/performance-triage/module.json` |
| FlexUI Revived | `https://raw.githubusercontent.com/Deadman6392/FoundryVTT-research-development/main/modules/flexui-revived/module.json` |

Each version is published as a GitHub release (`<module-id>-v<version>`) containing the zip Foundry downloads.
To run unreleased code, copy `modules/<module-id>` into your Foundry user data folder as `Data/modules/<module-id>`.

## Development

Requires Node 22 or newer; there are no dependencies to install.

```sh
npm test        # unit and lifecycle tests
npm run check   # manifest, syntax, localization and load-budget checks
```

[CLAUDE.md](CLAUDE.md) holds the conventions and the performance rules every module here follows.
