/**
 * musicService.js — AI music generation ("Sing as You").
 *
 * Generates a tailored song from three inputs: a human voice sample (audio),
 * lyrics, and a style (genre/mood/tempo/instruments). Architecturally this is
 * the audio counterpart to `bedrockImageService.js`.
 *
 * Provider strategy (see docs/implementation/ai-music-generator.md):
 *   - "mock"  — a local, dependency-free WAV synthesizer. Used for local dev
 *               and when no external key is configured, so the /music page
 *               works end-to-end without spending money or holding keys.
 *   - "elevenlabs" / "suno" / "bedrock" — real providers (voice cloning +
 *               instrumental). These are seams for the next slice; the mock
 *               path is the only one fully wired today.
 *
 * Songs are persisted as lightweight metadata records in the shared "Simple"
 * DynamoDB table (id = `music_<userId>_<songId>`), mirroring the
 * `net_image_<userId>_...` pattern in netTools.js.
 */

const { randomUUID } = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { logger } = require('../utils/logger');

// ─── DynamoDB (shared "Simple" table) ──────────────────────────────────────

const _dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
}));
const TABLE_NAME = 'Simple';
const MUSIC_PREFIX = 'music_';

// ─── Static catalogs ────────────────────────────────────────────────────────

const GENRES = Object.freeze([
  'pop', 'rock', 'hip-hop', 'country', 'r&b', 'electronic',
  'lofi', 'ballad', 'jazz', 'folk',
]);

const MOODS = Object.freeze([
  'upbeat', 'melancholic', 'epic', 'chill',
  'romantic', 'dark', 'dreamy', 'energetic',
]);

const TEMPOS = Object.freeze(['slow', 'mid', 'fast']);

const INSTRUMENTS = Object.freeze([
  'piano', 'guitar', 'strings', 'synth', '808s',
  'drums', 'bass', 'choir', 'brass', 'flute',
]);

const DEFAULT_STYLE = Object.freeze({
  genre: 'pop',
  mood: 'upbeat',
  tempo: 'mid',
  instruments: [],
  reference: '',
});

const LIMITS = Object.freeze({
  title: 120,
  lyrics: 4000,
  reference: 400,
  voiceBytes: 10 * 1024 * 1024, // 10 MB inline voice sample
  songsPerUser: 50,
});

// ─── Provider resolution ────────────────────────────────────────────────────

/** True when generation runs on the free local synth (dev / no keys). */
function isMockMode() {
  return process.env.MUSIC_MOCK_MODE === 'true' || !process.env.ELEVENLABS_API_KEY;
}

/** True when the server can attempt generation (mock always "works"). */
function isMusicGenerationConfigured() {
  return isMockMode() || Boolean(process.env.ELEVENLABS_API_KEY);
}

function resolveProviders() {
  return {
    vocal: process.env.MUSIC_VOCAL_PROVIDER || (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'mock'),
    instrumental: process.env.MUSIC_INSTRUMENTAL_PROVIDER || 'mock',
  };
}

// ─── Input normalization / validation ───────────────────────────────────────

function normalizeStyle(style = {}) {
  const s = style && typeof style === 'object' ? style : {};
  const genre = typeof s.genre === 'string' && GENRES.includes(s.genre.toLowerCase())
    ? s.genre.toLowerCase() : DEFAULT_STYLE.genre;
  const mood = typeof s.mood === 'string' && MOODS.includes(s.mood.toLowerCase())
    ? s.mood.toLowerCase() : DEFAULT_STYLE.mood;
  const tempo = typeof s.tempo === 'string' && TEMPOS.includes(s.tempo.toLowerCase())
    ? s.tempo.toLowerCase() : DEFAULT_STYLE.tempo;

  let instruments = [];
  if (Array.isArray(s.instruments)) {
    instruments = [...new Set(s.instruments.map(String).map((i) => i.toLowerCase()))]
      .filter((i) => INSTRUMENTS.includes(i))
      .slice(0, 8);
  }

  const reference = typeof s.reference === 'string'
    ? s.reference.trim().slice(0, LIMITS.reference) : '';

  return { genre, mood, tempo, instruments, reference };
}

/** Parse + validate the voice input. Returns { key } | { inline } | { error }. */
function parseVoiceInput(voice) {
  if (!voice || typeof voice !== 'object') {
    return { error: 'A voice sample is required (record or upload your voice first).' };
  }

  // 1) Reference an already-uploaded S3 sample.
  if (voice.voiceSampleKey) {
    const key = String(voice.voiceSampleKey).trim();
    if (!key) return { error: 'Voice sample key is invalid.' };
    return { key };
  }

  // 2) Inline data URL (used by the /music recorder in this first slice).
  if (voice.dataUrl) {
    const match = /^data:(audio\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(voice.dataUrl));
    if (!match) {
      return { error: 'Voice sample must be an audio file (data URL).' };
    }
    const mimeType = match[1];
    const base64 = match[2];
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes > LIMITS.voiceBytes) {
      return { error: `Voice sample is too large (max ${LIMITS.voiceBytes / 1024 / 1024} MB).` };
    }
    if (bytes < 1000) {
      return { error: 'Voice sample is too short. Please record or upload at least a few seconds of audio.' };
    }
    return { inline: { mimeType, base64, bytes } };
  }

  return { error: 'A voice sample is required (record or upload your voice first).' };
}

/**
 * Validate the top-level generation inputs. Returns { error } or { title,
 * lyrics, style, voice }.
 */
function validateGenerateInput(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return { error: 'A song title is required.' };
  if (title.length > LIMITS.title) return { error: `Title is too long (max ${LIMITS.title} characters).` };

  const lyrics = typeof body.lyrics === 'string' ? body.lyrics.trim() : '';
  if (!lyrics) return { error: 'Lyrics are required (write them or auto-generate a draft).' };
  if (lyrics.length > LIMITS.lyrics) return { error: `Lyrics are too long (max ${LIMITS.lyrics} characters).` };

  if (body.consent !== true) {
    return { error: 'You must confirm you own this voice and consent to a voice clone being created.' };
  }

  const voice = parseVoiceInput(body.voice);
  if (voice.error) return { error: voice.error };

  return { title, lyrics, style: normalizeStyle(body.style), voice };
}

// ─── Local WAV synthesizer (mock provider) ─────────────────────────────────

const SAMPLE_RATE = 22050;

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Chord progressions as [triad MIDI notes] + bass root, voiced around octave 4.
// Major feel: I–V–vi–IV. Minor feel (melancholic/dark): i–VI–III–VII.
const MAJOR_CHORDS = [
  { notes: [60, 64, 67], bass: 48 }, // C
  { notes: [55, 59, 62], bass: 43 }, // G
  { notes: [57, 60, 64], bass: 45 }, // Am
  { notes: [53, 57, 60], bass: 41 }, // F
];
const MINOR_CHORDS = [
  { notes: [57, 60, 64], bass: 45 }, // Am
  { notes: [53, 57, 60], bass: 41 }, // F
  { notes: [60, 64, 67], bass: 48 }, // C
  { notes: [55, 59, 62], bass: 43 }, // G
];

function buildEvents(style) {
  const minor = style.mood === 'melancholic' || style.mood === 'dark';
  const baseChords = minor ? MINOR_CHORDS : MAJOR_CHORDS;
  // Loop the progression twice for a fuller ~6–8s demo track.
  const chords = [...baseChords, ...baseChords];
  const chordDur = style.tempo === 'slow' ? 1.0 : style.tempo === 'fast' ? 0.5 : 0.7;

  const events = [];
  chords.forEach((chord, ci) => {
    const base = ci * chordDur;
    // Sustained bass.
    events.push({ freq: midiToFreq(chord.bass), start: base, dur: chordDur, amp: 0.5 });
    // Soft sustained chord pad.
    chord.notes.forEach((note, ni) => {
      events.push({ freq: midiToFreq(note), start: base + ni * 0.02, dur: chordDur, amp: 0.16 });
    });
    // Arpeggiated melody line (root, 3rd, 5th, octave).
    const melody = [chord.notes[0], chord.notes[1], chord.notes[2], chord.notes[0] + 12];
    melody.forEach((note, mi) => {
      events.push({
        freq: midiToFreq(note),
        start: base + mi * (chordDur / 4),
        dur: chordDur / 4,
        amp: 0.4,
      });
    });
  });

  return { events, durationSec: chords.length * chordDur };
}

/** Render events into a 16-bit mono PCM buffer. */
function synthPcm(events, durationSec) {
  const numSamples = Math.floor(SAMPLE_RATE * durationSec);
  const pcm = Buffer.alloc(numSamples * 2);
  for (const ev of events) {
    const start = Math.max(0, Math.floor(ev.start * SAMPLE_RATE));
    const len = Math.min(Math.floor(ev.dur * SAMPLE_RATE), numSamples - start);
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      // Simple attack/release envelope avoids clicks at note boundaries.
      const attack = 0.02;
      const release = 0.15;
      let env = 1;
      if (t < attack) env = t / attack;
      else if (t > ev.dur - release) env = Math.max(0, (ev.dur - t) / release);
      // Fundamental + two harmonics for a warmer tone.
      const s = Math.sin(2 * Math.PI * ev.freq * t)
        + 0.5 * Math.sin(2 * Math.PI * ev.freq * 2 * t)
        + 0.25 * Math.sin(2 * Math.PI * ev.freq * 3 * t);
      const clamped = Math.max(-1, Math.min(1, s * 0.35 * ev.amp * env));
      const idx = start + i;
      const existing = pcm.readInt16LE(idx * 2);
      const next = Math.max(-32768, Math.min(32767, existing + Math.round(clamped * 32767)));
      pcm.writeInt16LE(next, idx * 2);
    }
  }
  return pcm;
}

/** Wrap 16-bit mono PCM samples in a standard RIFF/WAVE header. */
function wavBuffer(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // PCM chunk size
  header.writeUInt16LE(1, 20);           // audio format: PCM
  header.writeUInt16LE(1, 22);           // channels: mono
  header.writeUInt32LE(SAMPLE_RATE, 24); // sample rate
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ─── Generation ─────────────────────────────────────────────────────────────

/**
 * Generate a song. Returns:
 *   { songId, title, style, provider:{vocal,instrumental}, mock, voiceCloned,
 *     durationMs, tracks:[{kind,mimeType,base64}], note? }
 * Throws an Error with `.status` set for HTTP mapping.
 */
async function generateSong({ title, lyrics, style, voice } = {}) {
  if (!isMusicGenerationConfigured()) {
    const err = new Error('Music generation is not configured on the server.');
    err.status = 503;
    throw err;
  }

  const providers = resolveProviders();

  // Mock: synthesize a real, playable WAV locally — no external keys needed.
  if (providers.vocal === 'mock' && providers.instrumental === 'mock') {
    const { events, durationSec } = buildEvents(style);
    const wav = wavBuffer(synthPcm(events, durationSec));
    return {
      songId: randomUUID(),
      title,
      style,
      provider: providers,
      mock: true,
      voiceCloned: false,
      durationMs: Math.round(durationSec * 1000),
      tracks: [{ kind: 'master', mimeType: 'audio/wav', base64: wav.toString('base64') }],
      note: 'Demo mode: synthesized an instrumental sketch. Voice cloning ships with the external provider integration.',
    };
  }

  // Real providers are the next slice — fail loudly rather than silently
  // returning something the user didn't ask for.
  const err = new Error(
    `Music provider "${providers.vocal}/${providers.instrumental}" is not wired yet. Set MUSIC_MOCK_MODE=true to use the local demo synth.`
  );
  err.status = 501;
  throw err;
}

// ─── Persistence (library) ──────────────────────────────────────────────────

/**
 * Persist song metadata (audio is returned inline today; S3 persistence of the
 * generated track is a follow-up). Records storage usage later via files[].
 */
async function saveSong(userId, song) {
  const now = new Date().toISOString();
  await _dynamodb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id: `${MUSIC_PREFIX}${userId}_${song.songId}`,
      text: `Creator:${userId}|Music|${JSON.stringify({
        songId: song.songId,
        title: song.title,
        style: song.style,
        provider: song.provider,
        mock: song.mock,
        voiceCloned: song.voiceCloned,
        durationMs: song.durationMs,
        createdAt: now,
      })}`,
      files: [],
      createdAt: now,
      updatedAt: now,
    },
  }));
  return song.songId;
}

/** List a user's songs (newest first via updatedAt sort in the caller). */
async function listSongs(userId) {
  const result = await _dynamodb.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(id, :prefix)',
    ExpressionAttributeValues: { ':prefix': `${MUSIC_PREFIX}${userId}_` },
  }));

  const songs = (result.Items || [])
    .map((item) => {
      try {
        const parsed = JSON.parse((item.text || '').split('|Music|')[1] || '{}');
        return { id: item.id, ...parsed };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return songs;
}

/** Delete a single song by its full DynamoDB id. */
async function deleteSong(userId, songId) {
  await _dynamodb.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { id: `${MUSIC_PREFIX}${userId}_${songId}` },
  }));
}

function getCatalog() {
  return {
    genres: GENRES,
    moods: MOODS,
    tempos: TEMPOS,
    instruments: INSTRUMENTS,
    defaults: DEFAULT_STYLE,
    configured: isMusicGenerationConfigured(),
    mock: isMockMode(),
  };
}

module.exports = {
  GENRES,
  MOODS,
  TEMPOS,
  INSTRUMENTS,
  DEFAULT_STYLE,
  LIMITS,
  getCatalog,
  isMockMode,
  isMusicGenerationConfigured,
  normalizeStyle,
  parseVoiceInput,
  validateGenerateInput,
  generateSong,
  saveSong,
  listSongs,
  deleteSong,
};
