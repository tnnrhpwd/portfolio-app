/**
 * Rocket — music and generated one-shot cues.
 *
 * The tracks are real audio files rendered by `scripts/rocket/generate-audio.js`
 * into `frontend/public/rocket/audio/`, listed in a `manifest.json`. This module
 * is what turns that manifest into sound.
 *
 * Two things worth knowing:
 *
 *  1. It uses raw WebAudio, not Phaser's sound manager — `config.ts` sets
 *     `audio: { noAudio: true }` because every effect is synthesized, so there is
 *     no Phaser sound manager to play a file with. Riding the same context also
 *     gives sample-accurate looping (`source.loop = true` on an exact-length
 *     buffer), which is what makes the loops seamless.
 *
 *  2. The assets are OPTIONAL. If the manifest is missing (a fresh clone with no
 *     rendered audio) every call here degrades to silence, and gameplay is
 *     unaffected. That is why nothing in this file throws and why `BootScene`
 *     does not wait for it.
 */

import { loadSettings } from '../settings';
import { audioContext, initAudio, masterBus } from './sfx';

const AUDIO_BASE = '/rocket/audio/';
const MANIFEST_URL = `${AUDIO_BASE}manifest.json`;

/** Music under the effects, on top of the shared master gain. */
const MUSIC_VOLUME = 0.55;
const CUE_VOLUME = 0.85;
const DEFAULT_FADE_MS = 700;

/**
 * The tracks the game asks for. Each is a slug in the audio manifest.
 *
 * Also a runtime list, so `audio.test.ts` can assert the rendered manifest
 * actually covers what the scenes request — the failure mode otherwise is
 * silence, which is indistinguishable from "no audio" at play time.
 */
export const MUSIC_KEYS = ['menu-drift', 'arena-pulse', 'boss-alarm', 'shop-spend', 'run-over'] as const;

export type MusicKey = (typeof MUSIC_KEYS)[number];

interface TrackInfo {
  slug: string;
  file: string;
  ms: number;
  loop: boolean;
}

let tracks: Map<string, TrackInfo> | null = null;
let manifestPromise: Promise<void> | null = null;
const buffers = new Map<string, AudioBuffer>();

/** What the game most recently asked to hear, so unmuting can resume it. */
let requested: MusicKey | null = null;
let active: { slug: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;

/** Load and index the manifest once. A missing file means "no music", not an error. */
async function ensureManifest(): Promise<void> {
  if (tracks) return;
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const map = new Map<string, TrackInfo>();
      try {
        const res = await fetch(MANIFEST_URL);
        if (res.ok) {
          const json = (await res.json()) as { tracks?: TrackInfo[] };
          for (const track of json.tracks ?? []) {
            if (track?.slug && track?.file) map.set(track.slug, track);
          }
        }
      } catch {
        /* offline or not rendered yet — the game simply has no music */
      }
      tracks = map;
    })();
  }
  await manifestPromise;
}

/** Decode a track once and cache it. Returns null when the asset is unavailable. */
async function ensureBuffer(slug: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(slug);
  if (cached) return cached;

  await ensureManifest();
  const info = tracks?.get(slug);
  if (!info) return null;

  initAudio();
  const ctx = audioContext();
  if (!ctx) return null;

  try {
    const res = await fetch(`${AUDIO_BASE}${info.file}`);
    if (!res.ok) return null;
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    buffers.set(slug, buffer);
    return buffer;
  } catch {
    return null;
  }
}

/** Fade a gain to zero and stop its source once the fade has finished. */
function fadeOut(entry: { source: AudioBufferSourceNode; gain: GainNode }, fadeMs: number): void {
  const ctx = audioContext();
  if (!ctx) {
    try {
      entry.source.stop();
    } catch {
      /* already stopped */
    }
    return;
  }
  const now = ctx.currentTime;
  entry.gain.gain.cancelScheduledValues(now);
  entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
  entry.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.01, fadeMs / 1000));
  try {
    entry.source.stop(now + Math.max(0.01, fadeMs / 1000) + 0.05);
  } catch {
    /* already stopped */
  }
}

/**
 * Play a music track, cross-fading from whatever is playing.
 *
 * Safe to call on every scene create: asking for the track that is already
 * playing is a no-op, which is what keeps the music continuous when the player
 * pauses, opens an overlay, or the game is rebuilt after a rotation.
 */
export function playMusic(slug: MusicKey, opts: { fadeMs?: number; volume?: number } = {}): void {
  requested = slug;
  if (!loadSettings().music) return;
  if (active?.slug === slug) return;

  const fadeMs = opts.fadeMs ?? DEFAULT_FADE_MS;
  const volume = opts.volume ?? MUSIC_VOLUME;
  const previous = active;
  active = null;
  if (previous) fadeOut(previous, fadeMs);

  void (async () => {
    const buffer = await ensureBuffer(slug);
    const ctx = audioContext();
    const bus = masterBus();
    // A slow decode must not clobber a newer request (scene changes race this).
    if (!buffer || !ctx || !bus || requested !== slug || !loadSettings().music) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = tracks?.get(slug)?.loop ?? true;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + fadeMs / 1000);
    source.connect(gain);
    gain.connect(bus);
    source.start();
    active = { slug, source, gain };
  })();
}

export function stopMusic(fadeMs = DEFAULT_FADE_MS): void {
  requested = null;
  if (!active) return;
  fadeOut(active, fadeMs);
  active = null;
}

/** Toggle the music layer without touching the effects. */
export function setMusicEnabled(enabled: boolean): void {
  if (!enabled) {
    stopMusic(300);
    return;
  }
  if (requested) {
    // Resume whatever the current screen wanted; the slug is still remembered.
    const slug = requested;
    requested = null;
    playMusic(slug, { fadeMs: 400 });
  }
}

/** The slug currently playing, or null. Handy for tests and debugging. */
export function currentTrack(): string | null {
  return active?.slug ?? null;
}

/**
 * Play a generated one-shot sound effect (the `sfx` items in the spec).
 * `onMissing` lets the caller keep its synthesized fallback, so the game always
 * makes a sound whether or not the assets were rendered.
 */
export function playCue(slug: string, onMissing?: () => void): void {
  if (loadSettings().muted) {
    onMissing?.();
    return;
  }
  void (async () => {
    const buffer = await ensureBuffer(slug);
    const ctx = audioContext();
    const bus = masterBus();
    if (!buffer || !ctx || !bus) {
      onMissing?.();
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = CUE_VOLUME;
    source.connect(gain);
    gain.connect(bus);
    source.start();
  })();
}

/** Forget every decoded buffer (the game is being torn down). */
export function disposeMusic(): void {
  if (active) {
    try {
      active.source.stop();
    } catch {
      /* already stopped */
    }
  }
  active = null;
  requested = null;
  buffers.clear();
  tracks = null;
  manifestPromise = null;
}
