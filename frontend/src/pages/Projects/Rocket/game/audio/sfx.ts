/**
 * Rocket — synthesized sound effects.
 *
 * Every sound is generated with WebAudio oscillators and noise, so the game
 * ships with zero audio assets (and none of the licensing questions that come
 * with them). The context is created lazily on the first user gesture, because
 * browsers refuse to start audio before one — and it is torn down with the game
 * so navigating away doesn't leave a context running.
 */

import { loadSettings } from '../settings';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

/** Output level for everything the game plays — music rides this same bus. */
const MASTER_GAIN = 0.32;

type Ctor = typeof AudioContext;

function audioContextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Create/resume the context. Safe to call from any pointer or key handler; it
 * is a no-op when audio is unsupported or muted.
 */
export function initAudio(): void {
  muted = loadSettings().muted;
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    if (!ctx) {
      ctx = new Ctor();
      master = ctx.createGain();
      // Muting is a master-gain zero, not a teardown: the context still exists so
      // the music can decode and play silently, and unmuting is instant.
      master.gain.value = muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
    master = null;
  }
}

/** The shared output bus. Music connects here so one switch silences everything. */
export function masterBus(): GainNode | null {
  return master;
}

/** The shared context, or null when WebAudio is unavailable / never unlocked. */
export function audioContext(): AudioContext | null {
  return ctx;
}

export function setMuted(value: boolean): void {
  muted = value;
  if (master && ctx) master.gain.value = value ? 0 : MASTER_GAIN;
  if (!value) initAudio();
}

export function isMuted(): boolean {
  return muted;
}

export function disposeAudio(): void {
  try {
    ctx?.close();
  } catch {
    /* already closed */
  }
  ctx = null;
  master = null;
}

interface ToneOpts {
  freq: number;
  /** Sweep target frequency over the tone's life. */
  to?: number;
  ms?: number;
  type?: OscillatorType;
  gain?: number;
  delayMs?: number;
}

/** A short pitched blip. */
function tone({ freq, to, ms = 120, type = 'square', gain = 0.5, delayMs = 0 }: ToneOpts): void {
  if (!ctx || !master || muted) return;
  const start = ctx.currentTime + delayMs / 1000;
  const end = start + ms / 1000;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), end);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** A filtered noise burst — impacts, explosions, thruster wash. */
function noise(ms = 220, gain = 0.4, lowpass = 1200, delayMs = 0): void {
  if (!ctx || !master || muted) return;
  const start = ctx.currentTime + delayMs / 1000;
  const frames = Math.max(1, Math.floor((ms / 1000) * ctx.sampleRate));

  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaying white noise: loud attack, fast tail.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(lowpass, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, lowpass * 0.15), start + ms / 1000);

  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, start);
  env.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);

  src.connect(filter);
  filter.connect(env);
  env.connect(master);
  src.start(start);
  src.stop(start + ms / 1000 + 0.02);
}

export const sfx = {
  /** Player shot: short, quiet, and frequent — it must not wear the ear out. */
  shoot(): void {
    tone({ freq: 880, to: 520, ms: 70, type: 'square', gain: 0.16 });
  },
  enemyShoot(): void {
    tone({ freq: 320, to: 180, ms: 110, type: 'sawtooth', gain: 0.14 });
  },
  /** Bullet hitting an enemy: a tick, so rapid fire reads as continuous. */
  hit(): void {
    tone({ freq: 1500, to: 900, ms: 40, type: 'triangle', gain: 0.1 });
  },
  explode(): void {
    noise(320, 0.5, 900);
    tone({ freq: 140, to: 50, ms: 300, type: 'sawtooth', gain: 0.25 });
  },
  explodeSmall(): void {
    noise(170, 0.32, 1600);
  },
  shieldHit(): void {
    tone({ freq: 700, to: 1500, ms: 180, type: 'sine', gain: 0.28 });
    noise(120, 0.18, 2600);
  },
  playerHit(): void {
    noise(420, 0.55, 700);
    tone({ freq: 200, to: 60, ms: 420, type: 'square', gain: 0.3 });
  },
  pickup(): void {
    tone({ freq: 900, to: 1400, ms: 90, type: 'sine', gain: 0.24 });
  },
  gem(): void {
    tone({ freq: 1100, to: 1700, ms: 110, type: 'sine', gain: 0.26 });
    tone({ freq: 1500, to: 2100, ms: 110, type: 'sine', gain: 0.16, delayMs: 70 });
  },
  waveClear(): void {
    [523, 659, 784, 1046].forEach((freq, i) =>
      tone({ freq, ms: 200, type: 'triangle', gain: 0.3, delayMs: i * 110 }),
    );
  },
  bossWarning(): void {
    [220, 165].forEach((freq, i) =>
      tone({ freq, ms: 420, type: 'sawtooth', gain: 0.3, delayMs: i * 420 }),
    );
  },
  death(): void {
    noise(900, 0.6, 600);
    [400, 300, 200, 120].forEach((freq, i) =>
      tone({ freq, to: freq * 0.6, ms: 320, type: 'square', gain: 0.28, delayMs: i * 160 }),
    );
  },
  buy(): void {
    tone({ freq: 700, to: 1200, ms: 130, type: 'triangle', gain: 0.28 });
  },
  deny(): void {
    tone({ freq: 220, to: 160, ms: 180, type: 'square', gain: 0.22 });
  },
  uiClick(): void {
    tone({ freq: 620, to: 780, ms: 60, type: 'triangle', gain: 0.2 });
  },
};
