# Dal Segno

A music deck for Foundry VTT. Play a track's windup once, loop its middle for as long as the fight lasts, and hit its
ending when you press the button. Mark the sections on a waveform, skip the parts you don't want, seek, change speed,
shift pitch, add bass, treble, muffle or reverb, and every player hears the same moment of the same track. It also
shrinks an hour-long video's soundtrack to a small Opus file, in your browser.

The name is the musical instruction *dal segno al coda*: go back to the sign, play round again, then jump to the
ending. That is what the deck does with an intro, a loop and an ending.

**Status: 0.1.0, not yet run in a Foundry world.** Everything below was exercised in headless Chromium against the real
module code with a small stand-in for Foundry (see [Trying it out](#trying-it-out) for what to check in a world). The
numbers quoted were measured there.

## Quick start

1. Open the Playlists tab and press **Deck** (or *Configure Settings > Dal Segno > Open the deck*).
2. Pick a playlist in the deck. Click a track to load it for everyone without starting it (every client fetches it,
   so the start is instant), or press its ▶ to play it now.
3. Press ✂ on a track to mark its sections. *Intro, loop, ending* drops three sections at rough positions; drag
   their markers on the waveform to the real intro and ending, use *Hear the loop seam* to check the join, and save.
4. While it plays, the deck shows the sections as buttons. **Next** moves on, **Ending** (🏁) goes to the last
   section, and by default both wait for the current pass to finish, so a loop completes its phrase before the
   ending starts. Shift-click (or the *Now* timing) jumps straight away with a short crossfade. A waiting jump shows
   a countdown and can be called off.

The disc on each sound in the Playlists sidebar does the same as clicking it in the deck (Shift: play now).

## What it does

**Sections.** A track can have up to 16 sections, played top to bottom. A looping section repeats until you move on;
anything between sections is skipped, so "cut out the boring minute" is two sections with a gap. The sections are
saved on the playlist sound (one flag), so the same file can be arranged differently in two playlists. A track with
no sections plays straight through, or loops whole if the sound is set to repeat.

**Two ways to play a track**, chosen per track and per computer:

| | Precise (decoded) | Streamed |
| --- | --- | --- |
| Used for | Arranged tracks up to 10 minutes, on computers with *Sample-accurate loops* on | Everything else |
| Loops and jumps | On the exact sample; a 0 s seam is a true gapless loop | Crossfaded (at least 0.15 s) |
| Start | After the whole file downloads and decodes | As soon as the first seconds arrive |
| Memory | About 23 MB per stereo minute, two tracks kept | A few seconds of audio |
| Speed with pitch kept | Through the pitch shifter (grainier) | The browser's own time-stretch (cleaner) |

The 10-minute line is the same one Foundry uses before it streams a sound. On a weak computer, turning *Sample-accurate
loops* off streams everything; that player's loop seams are crossfaded but stay in step with everyone else.

**Everyone at the same point.** The deck is one world setting holding where playback was at a moment of the server's
clock, plus the speed and any scheduled jump. Clients never send positions to each other: each works out where the
track is from the server clock, including players who join mid-song or reload. Every control change takes effect
0.6 s in the future (1.2 s for a new track), so all clients receive it before it happens and switch together. Each
client also allows for its own sound card's output latency (Bluetooth headphones included) and checks every 5
seconds that its audio clock hasn't slipped. An overloaded computer can skip audio and fall behind, and when that
happens it catches up with a short crossfade. Measured in headless Chromium:

| | Median | 90% of the time | Worst |
| --- | --- | --- | --- |
| Precise voice against the shared clock | 3.8 ms | 5.5 ms | 6.4 ms |
| Streamed voice against the shared clock | 7 ms | 14 ms | 83 ms |
| Two clients, one precise and one streamed that joined 3 s late | 6.2 ms apart | 24 ms | 54 ms |

Loop seams on the precise voice measured within 0.2 ms of sample-accurate across intro, three loop passes and a
jump to the ending, with WAV, MP3, Vorbis and Opus files.

**Pause and resume without reloading.** Pausing keeps the track loaded on every client, so play resumes at once. A
track loaded without playing (a click in the deck) is fetched by every client in advance. When a track ends, the
GM's client loads the next one in its playlist 1.5 s early and starts it exactly as the old one finishes, crossfaded
by the deck's *Crossfade between tracks*.

**Speed, pitch and effects**, heard by everyone: speed 0.5× to 2× (keeping pitch or not), pitch ±12 semitones, bass and
treble ±12 dB, muffle (a low-pass sweep, for music behind a door or underwater) and reverb. An effect at zero is
disconnected, not just turned down. Effects that can't run on a computer (the pitch shifter needs AudioWorklet) are
skipped there, and players can leave out reverb and pitch with *Skip heavy effects*.

**Shrink a file.** The shrink tool (in the deck, or *Configure Settings*) takes a video or audio file from your
computer, or one already in Foundry's data, keeps the part you want, mixes it to stereo or mono, encodes Opus at 48 to
128 kbps, uploads the result to a folder in your world and can add it to a playlist. It reads MP4, M4A, MOV (including
fragmented files saved from streaming sites), WebM, MKV, Ogg (Opus and Vorbis), MP3 and WAV itself, reading only the
audio out of a video, a slice at a time, so a 2 GB video never has to fit in memory. FLAC and anything else the browser
can decode are read whole, up to 300 MB. Measured: a one-hour 720p video with 160 kbps AAC audio (74 MB) became a
41.6 MB, 96 kbps stereo Opus file of exactly 3600 s, in 114 s (32× real time), peaking at 131 MB of JavaScript memory.
At 48 kbps mono an hour is about 21 MB. Every container above was checked with a click track: no click lost, every click
within a millisecond of where it was (encoder priming in AAC and MP3 is removed using the file's own gapless info).

## Settings

| Setting | Who | Stored | What it does |
| --- | --- | --- | --- |
| Stop Foundry's playlists when the deck plays | GM | World | When the deck starts, stop core playlists on the same channel. On by default. |
| Sample-accurate loops | Everyone | This computer | Decode arranged tracks up to 10 minutes. On by default; turn off on computers short of memory. |
| Skip heavy effects on this computer | Everyone | This computer | Leave out reverb and pitch shifting here. Off by default. |
| Music deck | GM | – | Opens the deck. |
| Shrink an audio or video file | GM | – | Opens the shrink tool. |

Deck options (volume, crossfade between tracks, play the next track, repeat the playlist) live in the deck itself.
Under *Configure Controls* you can bind keys for play/pause, next section, ending and opening the deck; none are bound
by default, so they never clash with another module.

Who can press the deck's controls: anyone allowed to change world settings, which is GMs and, by default, assistant
GMs. Players hear the deck and see what it is playing in the Playlists tab.

## For macros and other modules

`game.modules.get("dal-segno").api`:

```js
const deck = game.modules.get("dal-segno").api;
await deck.load(soundOrUuid);              // play a PlaylistSound (or {path, name}); {play: false} to only load it
await deck.ending();                        // last section, after the current pass; {now: true} to jump at once
await deck.next();                          // the next section
await deck.goto("Loop");                    // a section by name or index
await deck.pause(); await deck.play(); await deck.stop();
await deck.seek(42.5);                      // file seconds
await deck.setRate(1.1);
await deck.setFx({ muffle: 0.5, reverb: 0.3 });
deck.deck;                                  // what is loaded and where, as every client plays it
```

`Hooks.on("dalSegno.deckChanged", deck => ...)` fires on every client whenever the deck changes.

A combat example, for a world script or a module: play the boss track when combat starts and go to its ending when
combat ends. Hooks fire on every client, so only the active GM acts.

```js
const deck = () => game.users.activeGM?.isSelf ? game.modules.get("dal-segno").api : null;
Hooks.on("combatStart", () => deck()?.load("Playlist.xxxx.PlaylistSound.yyyy"));
Hooks.on("deleteCombat", () => deck()?.ending());
```

## Alongside other modules

Some of this exists in other packages, and you may want one of them instead:

- [The Sound of Silence](https://foundryvtt.com/packages/the-sound-of-silence) has loop sections with crossfades and
  intro-to-loop-to-outro flows inside Foundry's own playlists, plus soundscapes. Use it if you want sections on core
  playback and don't need speed, pitch, effects or the shrink tool. It needs libWrapper and is free for personal use.
- [Enhanced Audio Player](https://foundryvtt.com/packages/enhanced-audio-player) gives each playlist sound a start/end
  range with an optional loop and a seekable timeline, again on core playback.
- [Playlist Plus](https://foundryvtt.com/packages/playlist-plus) and [Minstrel](https://foundryvtt.com/packages/minstrel)
  (v14) reorganise the whole audio sidebar with queues, crossfades, ducking, moods and soundboards.
- [Foundry Tube](https://foundryvtt.com/packages/foundry-tube), [Bardic Inspiration](https://foundryvtt.com/packages/bardic-inspiration)
  and [Imp Theater](https://foundryvtt.com/packages/imp-theater) play YouTube in sync.

Dal Segno doesn't replace Foundry's playback or wrap any of its methods: it plays through its own engine, into
Foundry's audio context and each player's volume slider for the channel, and leaves core playlists, ambient sounds
and interface sounds alone. So it can run next to any of the above, but if one of them is also playing the same music
you will hear both. It doesn't take over the Playlists tab (it adds a button and a disc per sound), so there is no
FlexUI Revived area to untick.

## What it can't do

- **No YouTube.** Downloading audio from YouTube breaks YouTube's terms of service, and a browser can't do it anyway:
  YouTube's media servers don't let other sites read their streams. Embedding YouTube's player is allowed, but its
  sound never passes through the page's audio engine, so no sections, speed, pitch, effects or sample-level sync could
  apply to it, and its player costs every client about a megabyte of script. The YouTube modules listed above do that
  well. For your own downloads (a video you have the right to use), the shrink tool turns them into small files.
- **No free-music search yet.** A search of openly licensed music (Openverse indexes Jamendo, Freesound and Wikimedia
  Commons) is the next step, but it couldn't be tested from the environment this was built in, so it isn't shipped.
- **Streamed loop seams aren't sample-accurate.** The browser can't start an `<audio>` element on an exact sample, and
  in Chromium the delay between an element's reported position and its sound varies by up to about 60 ms. Tracks over
  10 minutes are always streamed. For a tight loop in a long file, shrink-cut just the part you loop (the shrink tool's
  *Keep from … to*) and arrange that.
- **Pitch shifting is simple.** It is a cheap delay-line shifter: clean within a few semitones, grainy beyond, and it
  adds 50 ms of delay (which the deck allows for). The same shifter keeps pitch when a precise track changes speed; a
  streamed track uses the browser's own, cleaner time-stretch.
- **Measured in Chromium only.** Firefox and Safari should work, but their audio latency and media elements haven't
  been measured; the streamed voice's 45 ms correction is only applied in Chromium-based browsers. The shrink tool
  needs WebCodecs audio (Chrome, Edge, the Foundry desktop app, recent Firefox).
- **One deck.** One track at a time, crossfading between tracks; no second deck for ambience yet.
- **The shrink tool has only been checked with Foundry's own file storage** ("data"). Uploads to S3 or a host's own
  storage go through Foundry's file picker but haven't been tried.
- Fragmented MP4s without an edit list don't say how much encoder priming they carry, so their first 23 ms of silence
  stays in the shrunk file.
- 5.1 and other multichannel sources are reduced to their first two channels (or all averaged, for mono).
- Players can't control the deck, and there is no per-track volume for one player; each player's *Music* volume slider
  applies.
- Not checked on Foundry v14 (the APIs it uses exist there).

## Trying it out

Install from the manifest and check, as the GM with a second browser logged in as a player:

1. Load a track from the deck, then press play: both clients start together. Reload the player mid-song: it rejoins at
   the same point.
2. Mark intro, loop and ending on a 2 to 5 minute track (*Intro, loop, ending*, drag the markers, *Match loop end*,
   *Hear the loop seam*), save, play, let it loop, press Ending: it finishes the pass and plays the ending.
3. Seek on the timeline, change speed with and without *Keep the pitch*, try pitch, muffle and reverb.
4. A track over 10 minutes shows *Streamed* and starts at once.
5. Pause and resume; let a track end with *Play the next track* on.
6. Shrink a long video from your computer into a playlist, then play it.
7. The Playlists tab: the Deck button, the disc on each sound, and the now-playing line for the player.

## Cost of this module

Written to the budgets in [CLAUDE.md](../../CLAUDE.md):

- At startup: 2 files, 20.6 KB unminified, in two waves. Nothing is fetched or run beyond registering settings, four
  keybindings and three hooks.
- On demand: the deck's logic (3 files, 24 KB) when the deck has a track; the engine (6 files, 40 KB) the first time
  anything plays on this client; the sidebar additions (11 KB) when the Playlists tab first renders for a GM, or for a
  player while the deck has a track; the deck (19 KB), section editor (30 KB) and shrink tool (67 KB) when opened. A
  client that never hears the deck downloads none of it.
- Idle: no timers and no listeners that run. Measured: no script time over 30 s with the module loaded.
- While playing, on each client: one timer per loop pass or jump, one 5-second clock check, and for a streamed track a
  2-second drift check plus a few 0.1-second checks around each seam. Measured main-thread time over 30 s with a 4 s loop
  (the worst case, a seam every 4 s): 31 ms for a precise track, 73 ms for a streamed one (0.1% and 0.24%).
- Audio-thread cost of effects (rendering 60 s offline): EQ and muffle 0.27% of a core, pitch 0.37%, reverb 2.5%.
  Nothing is connected at zero.
- Memory: a precise track holds its decoded audio, about 23 MB per stereo minute (up to 230 MB for a 10-minute track,
  the same as Foundry's own playback of that file); the last two decoded tracks are kept for quick switching. Streamed
  tracks hold a few seconds. The section editor holds an 11 kHz mono copy of the file while open (2.6 MB per minute,
  twice that for a moment while a stereo file decodes).
- The deck window, while open and playing: one 1-second timer for its clock and playhead.
- The active GM's client, while a track that will end plays: one timer for its end.
- Document writes: none on load. Each control press is one world-setting write (sliders write when released, not
  while dragged). The active GM writes once when a track ends to start the next. Saving sections writes one flag on
  the sound. The shrink tool uploads one file and can create one playlist sound.
