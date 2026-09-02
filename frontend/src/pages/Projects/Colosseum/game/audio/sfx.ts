/**
 * Placeholder synthesized SFX (WebAudio, no files).
 *
 * These are original, generated-in-code sounds for the vertical slice. They
 * will be swapped for licensed royalty-free stock audio (recorded in
 * ASSET-LICENSES.md) during the final audio pass (Phase 6).
 */

let ctx: AudioContext | null = null;
let muted = false;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setMuted(value: boolean): void {
  muted = value;
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = 'square',
  gain = 0.05,
  delay = 0,
): void {
  const c = ensureCtx();
  if (!c || muted) return;
  const osc = c.createOscillator();
  const amp = c.createGain();
  const t0 = c.currentTime + delay;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp);
  amp.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}

export const playClick = (): void => tone(660, 0.06, 'square', 0.04);
export const playHit = (): void => tone(160, 0.12, 'sawtooth', 0.07);
export const playCrit = (): void => {
  tone(200, 0.1, 'sawtooth', 0.08);
  tone(320, 0.14, 'square', 0.06, 0.04);
};
export const playBlock = (): void => tone(120, 0.1, 'triangle', 0.06);
export const playBuy = (): void => {
  tone(880, 0.07, 'square', 0.04);
  tone(1174, 0.1, 'square', 0.04, 0.06);
};
export const playVictory = (): void => {
  tone(523, 0.12, 'square', 0.05);
  tone(659, 0.12, 'square', 0.05, 0.1);
  tone(784, 0.22, 'square', 0.05, 0.2);
};
export const playDefeat = (): void => {
  tone(220, 0.25, 'sawtooth', 0.06);
  tone(165, 0.35, 'sawtooth', 0.06, 0.2);
};
