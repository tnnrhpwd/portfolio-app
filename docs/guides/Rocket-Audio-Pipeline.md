# Rocket audio pipeline

Renders the game's **music and sound effects** from a spec into real audio files in
`frontend/public/rocket/audio/`, plus a `manifest.json` the game reads at runtime.

Everything is synthesized offline by `scripts/rocket/generate-audio.js` — a small
chiptune engine (oscillators, ADSR envelopes, a filter, echo, drum synthesis, a step
sequencer) with **no dependencies, no accounts, no network, and no per-second bill**.
This is the audio counterpart to `Rocket-Asset-Pipeline.md`, and the same shape: the
spec is the source of truth, the script is the mechanics, the game reads only the
generated manifest.

- **Read this** before changing the soundtrack, adding a track, or wiring audio into
  a scene.
- Scene-side behaviour lives in `frontend/src/pages/Projects/Rocket/game/audio/music.ts`.
- The game's *effects* are a separate, older layer of runtime WebAudio synthesis
  (`game/audio/sfx.ts`); this pipeline is about rendered assets.

---

## 1. Status

| Asset | Kind | Length | Used by |
|---|---|---|---|
| `menu-drift.wav` | music loop | 20.0s | `MenuScene` |
| `arena-pulse.wav` | music loop | 13.7s | `PlayScene` |
| `boss-alarm.wav` | music loop | 12.8s | `PlayScene` while a boss is alive |
| `shop-spend.wav` | music loop | 17.1s | `ShopScene` |
| `run-over.wav` | one-shot | 11.4s | `GameOverScene` (the defeat sting) |
| `wave-clear.wav` | sfx | 1.5s | wave-clear sting, replacing the synth blip |
| `boss-explosion.wav` | sfx | 1.7s | **reserved** — not wired yet |
| `coin-chime.wav` | sfx | 0.4s | **reserved** — not wired yet |

**3.3 MB total** at 22050 Hz mono 16-bit, loaded **per scene on demand** (the menu
pulls 861 KB, the arena 591 KB), so the initial page load is unaffected.

The assets are **optional by design**: if `manifest.json` is missing (a fresh clone
that never ran the generator) every music call degrades to silence, gameplay is
unaffected, and `BootScene` does not wait for audio. That is why the contract test
in §6 exists — a missing track otherwise fails as *silence*, which is
indistinguishable from "my speakers are off".

---

## 2. Why not AI generation (read this before trying)

The first attempt was ElevenLabs (the app already had `ELEVENLABS_API_KEY` in AWS
Secrets Manager and `services/musicService.js` uses it for the "Sing as You"
feature). Two hard blockers, both worth knowing before anyone retries:

1. **The key is scoped.** `GET /v1/models` works, but generation returns
   `401 missing the permission sound_generation`, and `GET /v1/user/subscription`
   returns `401 missing the permission user_read`. So you cannot even read the
   credit balance with it.
2. **The owner has no ElevenLabs subscription.** Adding scopes to the key does not
   fix that; it needs a paid plan.

Rejected request = no charge, so probing permissions is free — but do not spend
effort on an AI provider without confirming a plan first. There is also no
first-party music model on Bedrock (see the note at the top of
`backend/services/musicService.js`), and Polly is speech-only.

**If an AI provider is ever wired up**, the pipeline is deliberately
provider-agnostic: every spec item carries a `prompt` describing the musical intent
in words, and a provider only has to write `<slug>.wav` (or `.mp3`) plus a manifest
with the same fields (`slug`, `kind`, `file`, `bytes`, `ms`, `loop`, `usedBy`).
Nothing else in the game changes.

There is also a real argument the synth is the better answer here: the art is flat
retro cartoon, a chiptune score fits it, and rendered loops join **sample-exactly**
(§4.4), which AI music does not guarantee.

---

## 3. The spec (`scripts/rocket/audio.json`)

Three things live in one file: the output settings, the instrument bank, and the
music/SFX items.

```jsonc
"output": { "dir": "frontend/public/rocket/audio", "sampleRate": 22050, "channels": 1, "peak": 0.89 },
"defaults": { "tempo": 120, "bars": 8, "beatsPerBar": 4, "stepsPerBeat": 4 },
"instruments": {
  "bass": { "wave": "square", "gain": 0.32, "attackMs": 3, "decayMs": 130,
            "sustain": 0.55, "releaseMs": 80, "filterHz": 760 },
  "lead": { "wave": "square", "gain": 0.2, "echo": { "timeMs": 214, "feedback": 0.3, "mix": 0.26 }, ... },
  "kick": { "drum": "kick", "gain": 0.85 }
},
"music": [
  { "slug": "arena-pulse", "usedBy": "PlayScene", "loop": true, "tempo": 140, "bars": 8,
    "prompt": "Driving 8-bit space shooter battle loop …",
    "tracks": [ { "instrument": "bass", "phrase": ["A2 . A2 . A2 . A2 . A2 . A2 . A3 . A2 .", …] } ] }
],
"sfx": [
  { "slug": "wave-clear", "render": "arpeggio", "notes": ["C5","E5","G5","C6"],
    "noteMs": 105, "wave": "square", "releaseMs": 620, "durationMs": 1500 }
]
```

### Pattern notation

One string per bar, whitespace separated:

| Token | Meaning |
|---|---|
| `C4`, `D#3`, `Eb2`, `F#5` | a note (letters, optional `#`/`b`, octave) |
| `.` | rest |
| `-` | extend the note before it by one step |
| `x` | drum hit |

Drums may be written compactly (`"x...x...x...x..."`); any token made only of
`.`, `-`, `x` is expanded into individual steps. A track's `phrase` **cycles** until
`bars` are filled, so a two-bar idea is written once:

```jsonc
{ "instrument": "hat",   "phrase": ["..x...x...x...x.", "..x...x...x.x.x."] },  // 8 bars from 2
```

`prompt` is unused by the renderer — it is the intent, for a human or a future AI
provider.

---

## 4. How the renderer works

### 4.1 Grid maths

`ms per step = (60 / tempo) / stepsPerBeat`; `samplesPerStep = (60 / tempo) * sampleRate / stepsPerBeat`.
A step's start sample is `round(step * samplesPerStep)`, and the buffer is exactly
`round(totalSteps * samplesPerStep)` samples — integers, so a loop length is exact.

### 4.2 Voices

`renderNote` sums one or two detuned copies of an oscillator (two = a wide pad)
through a one-pole low-pass, scaled by an ADSR envelope (`attackMs`, `decayMs`,
`sustain`, `releaseMs`) whose release always occupies the tail of the note.
Drums are synthesized: `kick` = sine with a 140→45 Hz pitch drop plus a click,
`snare` = noise plus a 190 Hz body, `hat` = high-passed noise (noise minus its own
low-pass). A seeded `mulberry32` PRNG provides all noise, which is what makes
renders reproducible.

### 4.3 Mixing

Each instrument track renders into its **own** buffer, so an instrument's echo
belongs to that instrument only, then the layers sum into the master, which is
normalized so the loudest sample sits at `output.peak` (0.89). Single-pass
attenuation is deliberate: no compressor means the mix sounds predictable. The
renderer prints `peak` and `rms` per item, and reports **`SILENT!`** if a pattern
parsed to nothing.

### 4.4 Seamless loops (the important bit)

A note that rings past the end of the buffer **wraps around to the beginning**
instead of being chopped. Without that, a held note at the end of the last bar
truncates at full amplitude and every lap clicks.

The renderer prints a **seam delta** — `|sample[0] - sample[last]|` — for looped
items. Current values are 0.000–0.022, i.e. inaudible. Treat anything above ~0.1 as
a bug: either a pattern ends mid-note without wrapping support, or something else
changed the buffer length after rendering.

Sample-exact length + `source.loop = true` in the browser = a genuinely seamless
loop, which is the main payoff of rendering assets instead of synthesizing at
runtime.

---

## 5. Running it

```powershell
# from the repo root; `node` is often missing from PATH in this workspace
& 'C:\Program Files\nodejs\node.exe' scripts/rocket/generate-audio.js --list    # spec + sizes, writes nothing
& 'C:\Program Files\nodejs\node.exe' scripts/rocket/generate-audio.js --audit   # + per-bar step counts
& 'C:\Program Files\nodejs\node.exe' scripts/rocket/generate-audio.js           # render what is missing
& 'C:\Program Files\nodejs\node.exe' scripts/rocket/generate-audio.js --only arena-pulse --force
```

| Flag | Effect |
|---|---|
| `--list` | Show the spec: slug, kind, length, loop/once, used-by, total MB |
| `--audit` | As `--list`, plus per-bar step counts (flags any bar ≠ 16 steps) |
| `--kind music\|sfx` | Only one kind |
| `--only a,b` | Only these slugs |
| `--force` | Re-render even if the file exists |
| `--sample-rate 44100` | Override the spec's rate (doubles file size, crisper hats) |
| `--dry-run` | Render in memory, write nothing |

Existing files are **skipped** unless `--force`, so re-runs are cheap and stable.

---

## 6. `--audit` and the contract test

`--audit` is the authoring tool. Every bar must be exactly `beatsPerBar ×
stepsPerBeat` (16) steps — a short bar shifts everything after it in that track, so
the two instruments drift apart and it sounds broken in a way that is hard to see by
eye. The audit prints the counts and marks offenders with `!`:

```
    arena-pulse      PlayScene
      bass   8 bars from [16,16,16,16]
    ! hat    8 bars from [15,16]        <- fix these
```

`game/audio/audio.test.ts` is the **contract test** (6 tests) and the tripwire for
the failure that silence hides:

- every slug appears exactly once and each track is fetchable (`file`, `bytes`, `ms`)
- **every slug the game asks for (`MUSIC_KEYS`) is in the manifest** — verified by
  temporarily adding a bogus key and watching it fail and name it
- `run-over` is `loop: false` (a sting must not drone under the stats) and the
  themes are `loop: true`
- the `wave-clear` cue exists

Add a track to `MUSIC_KEYS` in `game/audio/music.ts` and this fails until you render
it. That is the point.

---

## 7. Recipe: change or add music

1. Edit `scripts/rocket/audio.json`.
2. `--audit` until no bar is flagged.
3. `--only <slug> --force` to re-render just that track, and read the printed
   `peak`/`rms`/`seam`.
4. Listen to `frontend/public/rocket/audio/<slug>.wav` — it is a plain WAV, so any
   player works.
5. Commit the spec **and** the regenerated asset (plus `manifest.json`, which the
   renderer rewrites for you).

To use a **new** track in the game:

1. Add the slug to the spec and render it.
2. Add the slug to `MUSIC_KEYS` in `game/audio/music.ts` (this widens the `MusicKey`
   type, so the compiler now points at every call site that needs updating).
3. Call `playMusic('<slug>')` from the scene's `create()`.
4. Run the Rocket tests — the contract test fails if step 2 or the render was missed.

---

## 8. Scene-side wiring (`game/audio/music.ts`)

```ts
playMusic(slug, { fadeMs = 700, volume = 0.55 })  // cross-fades; no-op if already playing
stopMusic(fadeMs?)                                // fade out and stop
setMusicEnabled(enabled)                          // the player's music switch
playCue(slug, onMissing?)                         // one-shot SFX, with a synth fallback
currentTrack()                                    // debug/tests
disposeMusic()                                    // called from main.ts on teardown
```

Four details that matter:

- **Raw WebAudio, not Phaser's sound manager.** `config.ts` sets
  `audio: { noAudio: true }` (every effect is synthesized), so `this.sound` does not
  exist and there is nothing to play a file with. Riding the same context also gives
  `source.loop = true` on an exact-length buffer.
- **One mute for everything.** Music connects to the same master gain as the effects
  (`masterBus()` in `sfx.ts`), so mute is a gain of zero — instant, and the music
  keeps running silently rather than being torn down. `initAudio()` deliberately no
  longer bails when muted, so a player who starts muted still gets music the moment
  they unmute.
- **Asking twice is free.** `playMusic` early-returns when the requested slug is
  already playing, which is why scenes can call it unconditionally on every
  `create()` — pausing, opening an overlay, or the game being rebuilt after a device
  rotation all leave the music continuous. An async decode also re-checks that the
  request was not superseded, so a slow fetch cannot clobber a newer scene's track.
- **Music has its own switch.** `settings.music` (`rocket.settings.v1`, default true)
  is separate from `settings.muted`, because plenty of players want effects without a
  soundtrack. The menu footer has the 🎵 toggle next to 🔊.

---

## 9. Gotchas (each of these cost real debugging time)

1. **Compact drum notation must be expanded before parsing.** `"x...x...x...x..."`
   is *one* token, not sixteen, and it used to parse as an unreadable note — drums
   silently rendered nothing. Hence `expandBar()`; hence `--audit`.
2. **A short bar desynchronizes the whole track.** Always 16 steps, always check
   `--audit` after editing.
3. **Held notes at the loop point click** unless their tails wrap (§4.4). The seam
   number is the check.
4. **Do not trim one-shots.** Trimming trailing silence made the coin chime 0.19s
   instead of the 0.42s the spec asks for; one-shots now honour `durationMs` exactly.
5. **WAV is uncompressed.** 22050 Hz mono 16-bit ≈ 44 KB per second. Four loops plus
   a sting is 3.3 MB; at 44100 Hz it would be 6.6 MB. Music is loaded per scene, so
   the cost lands on scene entry, not page load.
6. **Nothing is audible until a user gesture.** Browsers keep an AudioContext
   suspended until one; the LAUNCH gate click is that gesture. A context created too
   early logs a Chrome warning and stays suspended — harmless, and it resumes on the
   first real input.
7. **A hidden tab freezes the game, not just the music.** Chromium stops
   `requestAnimationFrame` for background tabs, so Phaser's loop halts and `BootScene`
   never finishes preloading — it looks exactly like a hang. When verifying in a
   browser, make sure the game's tab is the visible one (`document.visibilityState`).
8. **`--force` is the only way to re-render.** That is deliberate: it is what stops a
   re-run from silently regenerating (and re-committing) a large binary diff.
9. **The game never throws over audio.** Missing manifest, unreadable file, no
   WebAudio — all degrade to silence. If the soundtrack is missing, check the
   network tab for `/rocket/audio/manifest.json` before suspecting the code.

---

## 10. Related docs

- `docs/guides/Rocket-Game-Guide.md` — the game itself: architecture, the two-layout
  portrait/landscape system, testing and the browser-verification technique.
- `docs/guides/Rocket-Asset-Pipeline.md` — the sprite pipeline (the image equivalent).
- `game/audio/sfx.ts` — the synthesized runtime effects (no assets).
