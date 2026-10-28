# Changelog

## 0.1.0

First release. Not yet run in a Foundry world; exercised in headless Chromium against the module's own code with a
stand-in for Foundry.

- **Music deck** (GM): a library of the world's playlists, play, pause, stop, seek on a timeline, section buttons,
  Next and Ending that wait for the current pass (or jump now with a crossfade), and a countdown for a waiting jump.
- **Sections** per playlist sound: up to 16, played in order, looping ones repeat until you move on, gaps are
  skipped. A section editor with a waveform, draggable markers, a close-up view, nudges, *Match loop end*, an intro,
  loop and ending preset, and previews only the GM hears.
- **Shared timing**: one world setting holds the deck against the server's clock, so every client, including late
  joiners, plays the same moment; changes take effect slightly in the future so clients switch together; each
  client allows for its output latency and corrects a slipping audio clock.
- **Two voices**: arranged tracks up to 10 minutes are decoded for sample-accurate loops (per-computer setting);
  everything else streams, with crossfaded seams and gentle drift correction.
- **Speed** 0.5× to 2× with or without keeping pitch, **pitch** ±12 semitones, **bass**, **treble**, **muffle** and
  **reverb**, all disconnected at zero; players can skip reverb and pitch on their computer.
- **Playlists**: the next track in the playlist starts as one ends, crossfaded; Foundry's own playlists on the same
  channel stop when the deck starts (GM setting).
- **Shrink tool** (GM): reads MP4, M4A, MOV (including fragmented), WebM, MKV, Ogg, MP3 and WAV (FLAC and others
  whole, up to 300 MB), keeps a chosen part, encodes Opus in Ogg at 48 to 128 kbps, uploads it and can add it to a
  playlist. A one-hour video's sound took 114 s.
- Sidebar: a Deck button, a disc on each sound to load it, a mark on sounds with sections, and a now-playing line.
- API for macros and modules, a `dalSegno.deckChanged` hook, and unbound keybindings for play/pause, next, ending and
  opening the deck.
