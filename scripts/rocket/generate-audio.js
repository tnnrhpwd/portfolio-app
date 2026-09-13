#!/usr/bin/env node
/**
 * generate-audio.js — render the game's music and sound effects to WAV assets.
 *
 * The audio counterpart to `extract-sprites.js`: it turns the spec in
 * `scripts/rocket/audio.json` (patterns, instruments, mixing) into real audio
 * files plus a `manifest.json`, which the game reads at runtime.
 *
 * It is a small offline synthesizer — oscillators, ADSR envelopes, a one-pole
 * filter, echo, drum synthesis, and a step sequencer. No dependencies, no
 * network, no accounts, no per-second bill. That is deliberate: AI music
 * providers need a paid subscription, and a flat-shaded cartoon shooter is
 * better served by a chiptune score that loops sample-exactly anyway.
 *
 * DETERMINISM: the noise source is a seeded PRNG, so re-rendering an unchanged
 * spec produces byte-identical files. A spec edit is a reviewable diff.
 *
 * Usage (run from anywhere; paths resolve relative to this file):
 *
 *   node scripts/rocket/generate-audio.js --list          # what is in the spec
 *   node scripts/rocket/generate-audio.js --audit         # validate bar lengths
 *   node scripts/rocket/generate-audio.js                 # render what is missing
 *   node scripts/rocket/generate-audio.js --only arena-pulse --force
 *
 * Output: frontend/public/rocket/audio/<slug>.wav + manifest.json
 */

const fs = require('fs');
const path = require('path');

const SPEC_PATH = path.join(__dirname, 'audio.json');
const ROOT = path.join(__dirname, '..', '..');

// ─── CLI ────────────────────────────────────────────────────────────────────

function usage() {
  console.log(`
Rocket audio renderer — offline chiptune + SFX synthesis, written as game assets.

  node scripts/rocket/generate-audio.js [options]

  --list                 Show the spec without rendering
  --audit                Also print per-bar step counts for music
  --kind <music|sfx>     Only one kind
  --only <slug[,slug]>   Only these slugs
  --force                Re-render even if the file exists
  --sample-rate <hz>     Override the spec's sample rate
  --dry-run              Render in memory, write nothing
  --help                 This text

Existing files are skipped unless --force, so a re-run is cheap and stable.
`);
}

function parseArgs(argv) {
  const args = { kind: 'all', only: null, force: false, list: false, audit: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--audit') args.audit = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--kind') args.kind = (argv[++i] || '').toLowerCase();
    else if (a === '--only') args.only = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--sample-rate') args.sampleRate = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`Unknown argument: ${a}\n`);
      args.help = true;
    }
  }
  return args;
}

// ─── Musical helpers ────────────────────────────────────────────────────────

const SEMITONE = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** "A#2" / "Eb3" / "C4" -> frequency in Hz (A4 = 440). Null when unparseable. */
function noteFreq(token) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(token);
  if (!m) return null;
  const semis = SEMITONE[m[1].toUpperCase() + m[2]];
  if (semis === undefined) return null;
  const midi = (parseInt(m[3], 10) + 1) * 12 + semis;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** mulberry32 — seeded so every render is reproducible. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashString = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

// ─── Oscillators, envelopes, filters ────────────────────────────────────────

function oscillator(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine':
      return Math.sin(p * 2 * Math.PI);
    case 'triangle':
      return 4 * Math.abs(p - 0.5) - 1;
    case 'saw':
      return 2 * p - 1;
    case 'square':
    default:
      return p < 0.5 ? 1 : -1;
  }
}

/** One-pole low-pass coefficient for a corner frequency in Hz. */
function lowpassCoeff(hz, sampleRate) {
  const rc = 1 / (2 * Math.PI * Math.max(20, hz));
  const dt = 1 / sampleRate;
  return dt / (rc + dt);
}

/** ADSR amplitude at sample `i` of a note lasting `total` samples. */
function envAt(i, total, inst, sampleRate) {
  const { attackMs = 2, decayMs = 120, sustain = 0.6, releaseMs = 100 } = inst;
  const a = Math.max(1, (attackMs / 1000) * sampleRate);
  const d = Math.max(1, (decayMs / 1000) * sampleRate);
  const r = Math.max(1, (releaseMs / 1000) * sampleRate);
  const releaseStart = Math.max(a + d, total - r);

  if (i < a) return i / a;
  if (i < a + d) return 1 - (1 - sustain) * ((i - a) / d);
  if (i < releaseStart) return sustain;
  const t = (i - releaseStart) / r;
  return t >= 1 ? 0 : sustain * (1 - t);
}

// ─── Voices ─────────────────────────────────────────────────────────────────

/**
 * Render one pitched note into `out` at `start`, for `length` samples.
 *
 * `wrap` is what makes a loop seamless: a note that rings past the end of the
 * buffer continues from the beginning instead of being chopped off, so the last
 * sample flows into the first one. Truncating instead produces an audible click
 * on every lap.
 */
function renderNote(out, start, length, freq, inst, sampleRate, rng, wrap = false) {
  if (!freq || length <= 0) return;
  const coeff = lowpassCoeff(inst.filterHz || 6000, sampleRate);
  const wave = inst.wave || 'square';
  // A little detune between two copies is what makes a pad sound wide.
  const voices = inst.detune ? [freq, freq * 2 ** (inst.detune / 1200)] : [freq];
  const gain = inst.gain ?? 0.3;
  const noisy = wave === 'saw';

  let lp = 0;
  for (let i = 0; i < length; i++) {
    const target = start + i;
    if (target >= out.length && !wrap) break;
    let raw = 0;
    for (const f of voices) raw += oscillator(wave, (i * f) / sampleRate);
    raw /= voices.length;
    if (noisy) raw += (rng() - 0.5) * 0.015; // keeps saw pads from sounding sterile
    lp += (raw - lp) * coeff;
    out[wrap ? target % out.length : target] += lp * envAt(i, length, inst, sampleRate) * gain;
  }
}

function renderKick(out, start, inst, sampleRate, rng, wrap = false) {
  const dur = Math.floor(0.24 * sampleRate);
  const gain = inst.gain ?? 0.8;
  const coeff = lowpassCoeff(2400, sampleRate);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < dur; i++) {
    const target = start + i;
    if (target >= out.length && !wrap) break;
    const t = i / sampleRate;
    const f = 45 + 95 * Math.exp(-t * 34); // pitch drop = the thump
    phase += f / sampleRate;
    const body = Math.sin(phase * 2 * Math.PI) * Math.exp(-t * 9);
    const click = (rng() - 0.5) * Math.exp(-t * 260) * 0.5;
    lp += (body + click - lp) * coeff;
    out[wrap ? target % out.length : target] += lp * gain;
  }
}

function renderSnare(out, start, inst, sampleRate, rng, wrap = false) {
  const dur = Math.floor(0.2 * sampleRate);
  const gain = inst.gain ?? 0.45;
  const coeff = lowpassCoeff(5200, sampleRate);
  let lp = 0;
  for (let i = 0; i < dur; i++) {
    const target = start + i;
    if (target >= out.length && !wrap) break;
    const t = i / sampleRate;
    const noise = (rng() - 0.5) * 2 * Math.exp(-t * 26);
    const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 40) * 0.5;
    lp += (noise + body - lp) * coeff;
    out[wrap ? target % out.length : target] += lp * gain;
  }
}

function renderHat(out, start, inst, sampleRate, rng, wrap = false) {
  const dur = Math.floor(0.06 * sampleRate);
  const gain = inst.gain ?? 0.2;
  const coeff = lowpassCoeff(9000, sampleRate);
  let lp = 0;
  for (let i = 0; i < dur; i++) {
    const target = start + i;
    if (target >= out.length && !wrap) break;
    const t = i / sampleRate;
    const noise = (rng() - 0.5) * 2 * Math.exp(-t * 90);
    lp += (noise - lp) * coeff;
    out[wrap ? target % out.length : target] += (noise - lp) * gain; // high-pass = noise minus its low-pass
  }
}

// ─── Step sequencing ────────────────────────────────────────────────────────

/**
 * Notes are written space separated, but drum patterns are far more readable
 * compactly (`x...x...x...x...`). Expand any all-step token into single steps.
 */
function expandBar(bar) {
  const steps = [];
  for (const token of bar.trim().split(/\s+/)) {
    if (token.length > 1 && /^[.\-x]+$/.test(token)) steps.push(...token);
    else steps.push(token);
  }
  return steps;
}

/**
 * Turn a phrase (one string per bar) into events.
 *   `.` rest   `-` extend the note before it   `x` drum hit   else a note
 */
function parsePhrase(phrase, warnings, label) {
  const steps = [];
  for (const bar of phrase) steps.push(...expandBar(bar));

  const events = [];
  let i = 0;
  while (i < steps.length) {
    const token = steps[i];
    if (token === '.' || token === '-') {
      i += 1;
      continue;
    }
    if (token === 'x') {
      events.push({ step: i, steps: 1, drum: true });
      i += 1;
      continue;
    }
    let length = 1;
    let j = i + 1;
    while (j < steps.length && steps[j] === '-') {
      length += 1;
      j += 1;
    }
    const freq = noteFreq(token);
    if (!freq) warnings.push(`${label}: unreadable note "${token}" at step ${i + 1}`);
    else events.push({ step: i, steps: length, freq });
    i = j;
  }
  return events;
}

/**
 * Render one instrument track into `out`, cycling its phrase until `bars` are
 * full. Phrase cycling is why a two-bar idea is written once.
 */
function renderTrack(out, track, grid, spec, sampleRate, rng, warnings, label, wrap = false) {
  const inst = spec.instruments[track.instrument];
  if (!inst) {
    warnings.push(`${label}: unknown instrument "${track.instrument}"`);
    return;
  }
  for (const [barIndex, bar] of track.phrase.entries()) {
    const count = expandBar(bar).length;
    if (count !== grid.stepsPerBar) {
      warnings.push(`${label}/${track.instrument}: bar ${barIndex + 1} has ${count} steps (expected ${grid.stepsPerBar})`);
    }
  }

  const events = parsePhrase(track.phrase, warnings, `${label}/${track.instrument}`);
  const phraseSteps = track.phrase.reduce((sum, bar) => sum + expandBar(bar).length, 0);
  const repeats = Math.max(1, Math.ceil(grid.totalSteps / phraseSteps));

  for (let rep = 0; rep < repeats; rep++) {
    for (const ev of events) {
      const step = ev.step + rep * phraseSteps;
      if (step >= grid.totalSteps) continue;
      const start = Math.round(step * grid.samplesPerStep);
      if (ev.drum) {
        if (inst.drum === 'kick') renderKick(out, start, inst, sampleRate, rng, wrap);
        else if (inst.drum === 'snare') renderSnare(out, start, inst, sampleRate, rng, wrap);
        else renderHat(out, start, inst, sampleRate, rng, wrap);
        continue;
      }
      const length = Math.max(1, Math.round(ev.steps * grid.samplesPerStep));
      renderNote(out, start, length, ev.freq, inst, sampleRate, rng, wrap);
    }
  }
}

/** Delay line with feedback — cheap "space" without a reverb impulse. */
function applyEcho(buffer, echo, sampleRate) {
  if (!echo) return;
  const delay = Math.max(1, Math.round((echo.timeMs / 1000) * sampleRate));
  const fb = (echo.feedback ?? 0.3) * (echo.mix ?? 0.3);
  if (fb <= 0 || delay >= buffer.length) return;
  const wet = Float32Array.from(buffer);
  for (let i = delay; i < wet.length; i++) wet[i] += wet[i - delay] * fb;
  for (let i = 0; i < buffer.length; i++) buffer[i] = wet[i];
}

// ─── Sound effects ──────────────────────────────────────────────────────────

function renderSfx(item, sampleRate) {
  const total = Math.round((item.durationMs / 1000) * sampleRate);
  const buffer = new Float32Array(total);
  const rng = makeRng(0x51f70000 ^ hashString(item.slug));

  if (item.render === 'arpeggio') {
    const wave = item.wave || 'square';
    const noteSamples = Math.round((item.noteMs / 1000) * sampleRate);
    const release = item.releaseMs ?? 400;
    let cursor = 0;
    for (const [index, token] of item.notes.entries()) {
      const freq = noteFreq(token);
      if (!freq) continue;
      const isLast = index === item.notes.length - 1;
      renderNote(
        buffer,
        cursor,
        noteSamples + (isLast ? release : Math.round(release * 0.3)),
        freq,
        {
          wave: isLast ? 'sine' : wave,
          gain: item.gain ?? 0.32,
          attackMs: 3,
          decayMs: isLast ? 700 : 140,
          sustain: isLast ? 0.25 : 0.5,
          releaseMs: isLast ? release : 120,
          filterHz: 7000,
        },
        sampleRate,
        rng,
      );
      cursor += noteSamples;
    }
  } else if (item.render === 'noiseBurst') {
    const [from, to] = item.sweepHz || [900, 60];
    const decay = item.decay ?? 2;
    const gain = item.gain ?? 0.7;
    const rumble = item.rumbleHz || 45;
    let lp = 0;
    for (let i = 0; i < total; i++) {
      const t = i / sampleRate;
      const progress = i / total;
      const cutoff = from * (to / from) ** progress; // exponential sweep down
      lp += ((rng() - 0.5) * 2 * Math.exp(-t * decay) - lp) * lowpassCoeff(cutoff, sampleRate);
      const boom = Math.sin(2 * Math.PI * rumble * t) * Math.exp(-t * 3.2) * 0.55;
      const crack = (rng() - 0.5) * Math.exp(-t * 60) * 0.8;
      buffer[i] += (lp * 1.6 + boom + crack) * gain;
    }
  } else {
    throw new Error(`unknown sfx render "${item.render}"`);
  }

  applyEcho(buffer, item.echo, sampleRate);
  return buffer;
}

// ─── Mixing, WAV ────────────────────────────────────────────────────────────

/** Scale so the loudest sample sits at `peak` (the mix is authored conservatively). */
function normalize(buffer, peak) {
  let max = 0;
  for (const s of buffer) max = Math.max(max, Math.abs(s));
  if (max < 1e-6) return;
  const scale = peak / max;
  for (let i = 0; i < buffer.length; i++) buffer[i] *= scale;
}

/** Drop trailing near-silence but keep a little tail so releases are not cut. */
function trimTail(buffer, sampleRate, keepMs = 40, floor = 0.004) {
  let last = buffer.length - 1;
  while (last > 0 && Math.abs(buffer[last]) < floor) last -= 1;
  return buffer.slice(0, Math.min(buffer.length, last + Math.round((keepMs / 1000) * sampleRate)));
}

function encodeWav(samples, sampleRate, channels = 1) {
  const dataBytes = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM header size
  header.writeUInt16LE(1, 20); // 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);

  const pcm = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return Buffer.concat([header, pcm]);
}

// ─── Spec → plan → render ───────────────────────────────────────────────────

function readSpec() {
  if (!fs.existsSync(SPEC_PATH)) throw new Error(`Missing spec: ${SPEC_PATH}`);
  return JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
}

/** Grid maths for one music item: everything the sequencer needs, in one place. */
function makeGrid(item, defaults, sampleRate) {
  const beatsPerBar = item.beatsPerBar ?? defaults.beatsPerBar ?? 4;
  const stepsPerBeat = item.stepsPerBeat ?? defaults.stepsPerBeat ?? 4;
  const tempo = item.tempo ?? defaults.tempo ?? 120;
  const bars = item.bars ?? defaults.bars ?? 8;
  return {
    tempo,
    bars,
    stepsPerBeat,
    stepsPerBar: beatsPerBar * stepsPerBeat,
    totalSteps: bars * beatsPerBar * stepsPerBeat,
    samplesPerStep: ((60 / tempo) * sampleRate) / stepsPerBeat,
  };
}

function planItems(spec, args, sampleRate) {
  const defaults = spec.defaults || {};
  const items = [];

  for (const m of spec.music || []) {
    const grid = makeGrid(m, defaults, sampleRate);
    items.push({
      kind: 'music',
      slug: m.slug,
      title: m.title || m.slug,
      usedBy: m.usedBy || '',
      loop: m.loop !== false,
      prompt: m.prompt || '',
      ms: Math.round((grid.totalSteps * 60000) / grid.tempo / grid.stepsPerBeat),
      spec: m,
      grid,
    });
  }
  for (const s of spec.sfx || []) {
    items.push({
      kind: 'sfx',
      slug: s.slug,
      title: s.title || s.slug,
      usedBy: s.usedBy || '',
      loop: false,
      prompt: s.prompt || '',
      ms: s.durationMs ?? 1000,
      spec: s,
    });
  }

  let kept = items;
  if (args.kind === 'music' || args.kind === 'sfx') kept = kept.filter((i) => i.kind === args.kind);
  else if (args.kind !== 'all') throw new Error(`--kind must be music, sfx or all (got "${args.kind}")`);
  if (args.only) {
    const wanted = new Set(args.only);
    const unknown = args.only.filter((slug) => !items.some((i) => i.slug === slug));
    if (unknown.length) throw new Error(`Unknown slug(s): ${unknown.join(', ')}`);
    kept = kept.filter((i) => wanted.has(i.slug));
  }
  return kept;
}

function renderItem(item, spec, sampleRate, warnings) {
  if (item.kind === 'sfx') {
    // One-shots honour the duration the spec declares — no trimming, so the
    // release tail is exactly as authored.
    const buffer = renderSfx(item.spec, sampleRate);
    normalize(buffer, spec.output?.peak ?? 0.89);
    return buffer;
  }

  const { totalSteps, samplesPerStep } = item.grid;
  const total = Math.round(totalSteps * samplesPerStep);
  const master = new Float32Array(total);

  // Each track gets its own buffer so its echo belongs to that instrument only.
  (item.spec.tracks || []).forEach((track, index) => {
    const inst = spec.instruments[track.instrument];
    const layer = new Float32Array(total);
    const rng = makeRng(hashString(item.slug) + index * 7919);
    renderTrack(layer, track, item.grid, spec, sampleRate, rng, warnings, item.slug, item.loop);
    applyEcho(layer, inst?.echo, sampleRate);
    for (let i = 0; i < total; i++) master[i] += layer[i];
  });

  normalize(master, spec.output?.peak ?? 0.89);
  // A loop keeps its exact length so the browser's sample-accurate loop is seamless.
  return item.loop ? master : trimTail(master, sampleRate, 150);
}

function readManifest(dir) {
  const p = path.join(dir, 'manifest.json');
  if (!fs.existsSync(p)) return { tracks: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed.tracks)) parsed.tracks = [];
    return parsed;
  } catch {
    return { tracks: [] };
  }
}

/**
 * Rewrite the manifest from what is actually on disk. Rebuilt rather than
 * appended so a deleted asset cannot linger — the game treats "listed" as
 * "safe to fetch".
 */
function writeManifest(dir, items, spec, sampleRate) {
  const previous = readManifest(dir);
  const priorBySlug = new Map(previous.tracks.map((t) => [t.slug, t]));
  const tracks = [];

  for (const item of items) {
    const file = `${item.slug}.wav`;
    if (!fs.existsSync(path.join(dir, file))) continue;
    const prior = priorBySlug.get(item.slug);
    tracks.push({
      slug: item.slug,
      kind: item.kind,
      title: item.title,
      file,
      bytes: fs.statSync(path.join(dir, file)).size,
      ms: item.ms,
      loop: item.loop,
      usedBy: item.usedBy,
      prompt: item.prompt,
      renderedAt: prior?.renderedAt || new Date().toISOString(),
    });
  }
  for (const prior of previous.tracks) {
    if (!tracks.some((t) => t.slug === prior.slug) && fs.existsSync(path.join(dir, prior.file))) tracks.push(prior);
  }

  const manifest = {
    renderedAt: new Date().toISOString(),
    note: 'Rendered by scripts/rocket/generate-audio.js from scripts/rocket/audio.json — do not edit by hand.',
    generator: 'offline-synth',
    format: 'wav',
    sampleRate,
    channels: spec.output?.channels ?? 1,
    counts: {
      total: tracks.length,
      music: tracks.filter((t) => t.kind === 'music').length,
      sfx: tracks.filter((t) => t.kind === 'sfx').length,
    },
    tracks,
  };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

// ─── Main ───────────────────────────────────────────────────────────────────

(function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const spec = readSpec();
  const sampleRate = args.sampleRate || spec.output?.sampleRate || 22050;
  const outDir = path.join(ROOT, spec.output?.dir || 'frontend/public/rocket/audio');
  const items = planItems(spec, args, sampleRate);

  if (args.list || args.audit) {
    const totalMs = items.reduce((sum, i) => sum + i.ms, 0);
    console.log(`\nSpec: ${items.length} item(s), ${(totalMs / 1000).toFixed(1)}s, ${sampleRate} Hz mono\n`);
    for (const item of items) {
      const have = fs.existsSync(path.join(outDir, `${item.slug}.wav`)) ? 'have' : 'new';
      console.log(
        `  ${have.padEnd(4)} | ${item.kind.padEnd(5)} | ${(item.ms / 1000).toFixed(1).padStart(5)}s | ${item.loop ? 'loop' : 'once'} | ${item.slug.padEnd(16)} | ${item.usedBy}`,
      );
      if (args.audit && item.kind === 'music') {
        for (const track of item.spec.tracks || []) {
          const counts = track.phrase.map((bar) => expandBar(bar).length);
          const bad = counts.some((count) => count !== item.grid.stepsPerBar);
          console.log(`         ${bad ? '!' : ' '} ${track.instrument.padEnd(6)} ${item.grid.bars} bars from [${counts.join(',')}]`);
        }
      }
    }
    console.log(`\nWhole set at ${sampleRate} Hz mono 16-bit: ~${(((totalMs / 1000) * sampleRate * 2) / 1024 / 1024).toFixed(2)} MB.`);
    return;
  }

  const warnings = [];
  const rendered = [];
  const skipped = [];

  for (const item of items) {
    const target = path.join(outDir, `${item.slug}.wav`);
    if (fs.existsSync(target) && !args.force) {
      skipped.push(item.slug);
      continue;
    }
    const samples = renderItem(item, spec, sampleRate, warnings);
    const wav = encodeWav(samples, sampleRate, spec.output?.channels ?? 1);
    if (!args.dryRun) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(target, wav);
    }
    rendered.push(item.slug);
    // A pattern that parses to nothing renders a silent file, which sounds like
    // "the game has no music" rather than "the spec is wrong". Make it visible.
    let peak = 0;
    let sumSq = 0;
    for (const s of samples) {
      peak = Math.max(peak, Math.abs(s));
      sumSq += s * s;
    }
    const rms = samples.length ? Math.sqrt(sumSq / samples.length) : 0;
    // For a loop, the join between the last and first sample is the quality bar:
    // a big step there is an audible click on every lap.
    const seam = item.loop && samples.length > 1 ? Math.abs(samples[0] - samples[samples.length - 1]) : null;
    const level =
      peak < 0.01
        ? 'SILENT!'
        : `peak ${peak.toFixed(2)} rms ${rms.toFixed(3)}${seam === null ? '' : ` seam ${seam.toFixed(3)}`}`;
    console.log(
      `rendered ${item.slug.padEnd(16)} ${item.kind.padEnd(5)} ${(samples.length / sampleRate).toFixed(2)}s -> ${(wav.length / 1024).toFixed(0)} KB  [${level}]`,
    );
  }

  const manifest = args.dryRun ? null : writeManifest(outDir, items, spec, sampleRate);

  console.log('\n─── summary ───');
  if (rendered.length) console.log(`rendered : ${rendered.join(', ')}`);
  if (skipped.length) console.log(`skipped  : ${skipped.join(', ')} (already on disk; --force to re-render)`);
  if (manifest) console.log(`manifest : ${path.relative(process.cwd(), path.join(outDir, 'manifest.json'))} (${manifest.counts.total} item(s))`);

  if (warnings.length) {
    console.log(`\npattern warnings (${warnings.length}) — a bar that is not a full bar shifts everything after it:`);
    for (const warning of warnings.slice(0, 24)) console.log(`  ${warning}`);
    if (warnings.length > 24) console.log(`  … and ${warnings.length - 24} more`);
  }
})();
