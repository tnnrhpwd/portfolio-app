/**
 * sfx — tiny synthesized sound effects via WebAudio (no audio assets needed).
 * Sounds are generated with oscillators + noise so the game has Flash-era
 * "juice" without shipping any audio files.
 */

let ctx = null;
let muted = localStorage.getItem('colosseumMuted') === '1';

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = !!value;
  localStorage.setItem('colosseumMuted', muted ? '1' : '0');
}

function tone(freq, duration, type = 'square', gain = 0.06, slideTo = null) {
  const ac = ensureCtx();
  if (!ac || muted) return;
  const t0 = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + duration);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noise(duration, gain = 0.08) {
  const ac = ensureCtx();
  if (!ac || muted) return;
  const t0 = ac.currentTime;
  const buffer = ac.createBuffer(1, ac.sampleRate * duration, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(g).connect(ac.destination);
  src.start(t0);
}

export const sfx = {
  click() {
    tone(520, 0.06, 'square', 0.03, 380);
  },
  select() {
    tone(660, 0.08, 'triangle', 0.05, 540);
  },
  hit() {
    noise(0.09, 0.12);
    tone(160, 0.1, 'sawtooth', 0.05, 80);
  },
  heavyHit() {
    noise(0.14, 0.16);
    tone(110, 0.16, 'sawtooth', 0.07, 55);
  },
  crit() {
    noise(0.12, 0.14);
    tone(220, 0.12, 'square', 0.06, 60);
    tone(440, 0.1, 'square', 0.04, 220);
  },
  skill() {
    tone(320, 0.14, 'triangle', 0.06, 640);
    tone(480, 0.14, 'triangle', 0.05, 960);
  },
  defend() {
    tone(300, 0.1, 'sine', 0.05, 420);
  },
  heal() {
    tone(500, 0.1, 'sine', 0.05, 760);
    tone(760, 0.14, 'sine', 0.04, 1000);
  },
  victory() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'square', 0.05), i * 110));
  },
  defeat() {
    [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'sawtooth', 0.05), i * 140));
  },
};
