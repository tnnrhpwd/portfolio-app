/**
 * musicService.js — AI music generation ("Sing as You").
 *
 * Generates a tailored song from three inputs: a human voice sample (audio),
 * lyrics, and a style (genre/mood/tempo/instruments). Architecturally this is
 * the audio counterpart to `bedrockImageService.js`.
 *
 * Provider strategy — AWS-only (see docs/implementation/ai-music-generator.md):
 *   - voice "mock" / "bedrock" (CAMB AI MARS6 on Bedrock) / "polly" (Amazon Polly).
 *   - instrumental "local" (free, dependency-free WAV synth) / "sagemaker"
 *     (open-weights music model hosted on SageMaker — future slice).
 *
 * There is no first-party Bedrock music-generation model today, so the only
 * fully-shipped path is the local synthesizer. Voice providers are seams for
 * the next slice; the mock path is the only one wired end-to-end.
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

// ─── Provider resolution (AWS-only) ─────────────────────────────────────────

function resolveProviders() {
  const explicit = (process.env.MUSIC_VOICE_PROVIDER || '').toLowerCase();
  let voice = 'mock';
  if (explicit === 'bedrock') {
    voice = 'bedrock'; // CAMB AI MARS6 (voice cloning) via Bedrock InvokeModel
  } else if (explicit === 'polly') {
    voice = 'polly';   // Amazon Polly neural TTS (first-party, no cloning)
  } else if (explicit === 'elevenlabs') {
    voice = 'elevenlabs'; // ElevenLabs voice clone + music generation
  } else if (isElevenLabsConfigured()) {
    voice = 'elevenlabs'; // auto-detect: ElevenLabs key present
  } else if (isVoiceConfigured()) {
    voice = 'bedrock';
  }

  const instrumental = (process.env.MUSIC_INSTRUMENTAL_PROVIDER || '').toLowerCase() === 'sagemaker'
    ? 'sagemaker'
    : 'local';

  return { voice, instrumental };
}

/** True when generation runs on the free local synth (dev / no voice provider). */
function isMockMode() {
  return process.env.MUSIC_MOCK_MODE === 'true' || resolveProviders().voice === 'mock';
}

/** True when the server can attempt generation (mock always "works"). */
function isMusicGenerationConfigured() {
  return isMockMode() || ['bedrock', 'polly', 'elevenlabs'].includes(resolveProviders().voice);
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
  //    Recorders often produce MIME types with parameters (e.g. Chrome's
  //    `audio/webm;codecs=opus`), so parse the data URL defensively instead of
  //    matching the whole thing with a strict regex.
  if (voice.dataUrl) {
    const str = String(voice.dataUrl);
    const b64Idx = str.indexOf(';base64,');
    const meta = b64Idx > -1 ? str.slice(5, b64Idx) : ''; // e.g. "audio/webm;codecs=opus"
    const mimeType = meta.split(';')[0] || '';
    if (b64Idx === -1 || !mimeType.startsWith('audio/')) {
      return { error: 'Voice sample must be an audio file (data URL).' };
    }
    const base64 = str.slice(b64Idx + ';base64,'.length);
    if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
      return { error: 'Voice sample must be an audio file (data URL).' };
    }
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

// ─── Bedrock voice (CAMB MARS6 / any Bedrock voice model) ───────────────────

const VOICE_DEFAULT_REGION = 'us-east-1';

function getVoiceModelId() {
  return (process.env.AWS_BEDROCK_VOICE_MODEL_ID || '').trim();
}

function getVoiceRegion() {
  return process.env.AWS_BEDROCK_VOICE_REGION || process.env.AWS_BEDROCK_REGION || VOICE_DEFAULT_REGION;
}

/** True when a Bedrock voice model id is configured (voice cloning path). */
function isVoiceConfigured() {
  return Boolean(getVoiceModelId());
}

/** Resolve the user's voice sample to raw base64 audio (inline or S3 key). */
async function getVoiceAudioBase64(voice) {
  if (voice.inline) return voice.inline.base64;
  if (voice.key) {
    const { getFileBuffer } = require('./s3Service');
    return await getFileBuffer(voice.key);
  }
  return null;
}

/**
 * Clone/synthesize the vocal via a Bedrock voice model (CAMB MARS6) using
 * InvokeModel — the same low-level path the image adapter uses.
 *
 * Request body follows CAMB MARS6's text-to-audio contract:
 *   { reference_audio: <base64>, text: <lyrics>, ... }
 * Response is expected to carry the audio in `audio` / `audio_base64` /
 * `output.audio`. ⚠️ These exact keys are provider-defined and NOT exposed by
 * the Bedrock control plane — confirm them against the model card once the
 * model is subscribed, then adjust below if needed.
 */
async function generateBedrockVoice({ voice, lyrics }) {
  const modelId = getVoiceModelId();
  if (!modelId) {
    const err = new Error('No Bedrock voice model configured (set AWS_BEDROCK_VOICE_MODEL_ID).');
    err.status = 503;
    throw err;
  }

  const audioBase64 = await getVoiceAudioBase64(voice);
  if (!audioBase64) {
    const err = new Error('A voice sample is required to clone your voice.');
    err.status = 400;
    throw err;
  }

  const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
  const { resolveBedrockCredentials, classifyBedrockError } = require('./bedrockService');

  const { accessKeyId, secretAccessKey } = resolveBedrockCredentials();
  const client = new BedrockRuntimeClient({
    region: getVoiceRegion(),
    credentials: { accessKeyId, secretAccessKey },
  });

  const body = {
    reference_audio: audioBase64,
    text: lyrics,
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  let response;
  try {
    response = await client.send(command);
  } catch (error) {
    throw classifyBedrockError(error);
  }

  const payload = JSON.parse(Buffer.from(response.body).toString('utf-8'));
  const audio = payload.audio || payload.audio_base64 || payload.output?.audio || payload.audio_b64;
  if (!audio) {
    throw new Error('Bedrock voice model returned no audio.');
  }
  const mimeType = payload.mime_type || payload.content_type || 'audio/mpeg';
  return { kind: 'vocal', mimeType, base64: audio };
}

// ─── Amazon Polly voice (first-party TTS — no cloning) ──────────────────────

const POLLY_DEFAULT_REGION = 'us-east-1';
const POLLY_MAX_TEXT_CHARS = 2800; // keep under Polly's ~3000-char text limit

function getPollyRegion() {
  return process.env.AWS_POLLY_REGION || process.env.AWS_REGION || POLLY_DEFAULT_REGION;
}

/**
 * Synthesize a spoken vocal of the lyrics via Amazon Polly. Fully first-party
 * AWS (no Marketplace subscription, no cloning of the user's voice). Returns a
 * single "vocal" track. Marked `spoken: true` so callers can surface that it
 * is narration, not singing.
 */
async function generatePollyVoice({ lyrics }) {
  const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

  const client = new PollyClient({
    region: getPollyRegion(),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const text = (lyrics || '').slice(0, POLLY_MAX_TEXT_CHARS);
  const command = new SynthesizeSpeechCommand({
    Engine: process.env.AWS_POLLY_ENGINE || 'neural',
    LanguageCode: process.env.AWS_POLLY_LANGUAGE_CODE || 'en-US',
    OutputFormat: 'mp3',
    Text: text,
    TextType: 'text',
    VoiceId: process.env.AWS_POLLY_VOICE_ID || 'Joanna',
  });

  const response = await client.send(command);
  const stream = response.AudioStream;
  if (!stream) throw new Error('Amazon Polly returned no audio stream.');

  let buffer;
  if (Buffer.isBuffer(stream)) {
    buffer = stream;
  } else if (stream instanceof Uint8Array) {
    buffer = Buffer.from(stream);
  } else if (typeof stream.transformToByteArray === 'function') {
    buffer = Buffer.from(await stream.transformToByteArray());
  } else {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    buffer = Buffer.concat(chunks);
  }

  return {
    kind: 'vocal',
    mimeType: response.ContentType || 'audio/mpeg',
    base64: buffer.toString('base64'),
    spoken: true,
  };
}

// ─── ElevenLabs (voice clone + music generation) ────────────────────────────

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_MUSIC_MAX_PROMPT = 4000; // stay under the ~4100-char prompt cap

function getElevenLabsKey() {
  return (process.env.ELEVENLABS_API_KEY || '').trim();
}

/** True when an ElevenLabs API key is configured. */
function isElevenLabsConfigured() {
  return Boolean(getElevenLabsKey());
}

const ELEVENLABS_MIME_EXT = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
};

/** Best-effort parse of ElevenLabs JSON error bodies into a readable string. */
async function elevenLabsError(res, fallback) {
  try {
    const text = await res.text();
    const parsed = JSON.parse(text);
    const detail = parsed.detail || parsed.message || parsed.error;
    if (typeof detail === 'string') return detail;
    if (detail && detail.message) return detail.message;
    return `${fallback} (${res.status}): ${text.slice(0, 160)}`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

/**
 * Instant Voice Cloning — POST /v1/voices/add with the user's audio sample.
 * Returns the new voice_id.
 */
async function cloneElevenLabsVoice({ voice }) {
  const apiKey = getElevenLabsKey();
  if (!apiKey) {
    const err = new Error('No ElevenLabs API key configured (set ELEVENLABS_API_KEY).');
    err.status = 503;
    throw err;
  }

  const audioBase64 = await getVoiceAudioBase64(voice);
  if (!audioBase64) {
    const err = new Error('A voice sample is required to clone your voice.');
    err.status = 400;
    throw err;
  }

  const mimeType = voice.inline?.mimeType || 'audio/webm';
  const ext = ELEVENLABS_MIME_EXT[mimeType] || 'webm';
  const form = new FormData();
  form.append('name', 'Music user voice');
  form.append('files', new Blob([Buffer.from(audioBase64, 'base64')], { type: mimeType }), `voice.${ext}`);

  const res = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  if (!res.ok) {
    const err = new Error(await elevenLabsError(res, 'ElevenLabs voice cloning failed'));
    err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!json.voice_id) throw new Error('ElevenLabs voice cloning returned no voice_id.');
  return json.voice_id;
}

/**
 * Text-to-speech with a cloned voice — POST /v1/text-to-speech/{voice_id}.
 * Returns a spoken vocal track (this is the "your voice" artifact).
 */
async function elevenLabsTts({ voiceId, text }) {
  const apiKey = getElevenLabsKey();
  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_TTS_MODEL_ID || 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
    }),
  });
  if (!res.ok) {
    const err = new Error(await elevenLabsError(res, 'ElevenLabs text-to-speech failed'));
    err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    kind: 'vocal',
    mimeType: res.headers.get('content-type') || 'audio/mpeg',
    base64: buffer.toString('base64'),
    spoken: true,
  };
}

/** Build an Eleven Music text prompt from lyrics + style (≤ prompt cap). */
function buildElevenLabsMusicPrompt({ lyrics, style }) {
  const styleBits = [
    `a ${style.mood} ${style.genre} song`,
    `at a ${style.tempo} tempo`,
    style.instruments.length ? `featuring ${style.instruments.join(', ')}` : '',
    style.reference ? `in the style of ${style.reference}` : '',
  ].filter(Boolean);
  const prompt = `${styleBits.join(', ')}. Lyrics: ${lyrics}`;
  return prompt.slice(0, ELEVENLABS_MUSIC_MAX_PROMPT);
}

/**
 * Eleven Music — POST /v1/music. Generates a full, produced song from the
 * prompt (lyrics + style). The vocals are Eleven's own AI voice; your cloned
 * voice is surfaced separately via text-to-speech (see elevenLabsTts).
 */
async function generateElevenLabsMusic({ lyrics, style }) {
  const apiKey = getElevenLabsKey();
  const body = {
    prompt: buildElevenLabsMusicPrompt({ lyrics, style }),
    musicLengthMs: parseInt(process.env.ELEVENLABS_MUSIC_LENGTH_MS || '30000', 10),
    modelId: process.env.ELEVENLABS_MUSIC_MODEL_ID || 'music_v2',
    output_format: 'auto',
  };

  const res = await fetch(`${ELEVENLABS_BASE}/music`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(await elevenLabsError(res, 'ElevenLabs music generation failed'));
    err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    kind: 'master',
    mimeType: res.headers.get('content-type') || 'audio/mpeg',
    base64: buffer.toString('base64'),
  };
}

/**
 * ElevenLabs flow: clone the voice, speak the lyrics with it (best effort),
 * and generate a produced song via Eleven Music. Returns { tracks, voiceId }.
 */
async function generateElevenLabsSong({ voice, lyrics, style }) {
  if (!isElevenLabsConfigured()) {
    const err = new Error('ElevenLabs is not configured on the server (set ELEVENLABS_API_KEY).');
    err.status = 503;
    throw err;
  }

  const tracks = [];
  let voiceId = null;

  // 1) Voice clone + spoken vocal — the "in your voice" artifact (best effort).
  try {
    voiceId = await cloneElevenLabsVoice({ voice });
    tracks.push(await elevenLabsTts({ voiceId, text: lyrics }));
  } catch (err) {
    logger.warn('[music] ElevenLabs voice clone/TTS failed (continuing with music only):', err.message);
  }

  // 2) Music generation — required; this is the primary deliverable.
  const music = await generateElevenLabsMusic({ lyrics, style });
  tracks.unshift(music);

  return { tracks, voiceId };
}

// ─── Generation ─────────────────────────────────────────────────────────────

/**
 * Generate a song. Returns:
 *   { songId, title, style, provider:{voice,instrumental}, mock, voiceCloned,
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

  // Local instrumental backing track (used by both the mock and bedrock paths).
  const makeInstrumental = () => {
    const { events, durationSec } = buildEvents(style);
    const wav = wavBuffer(synthPcm(events, durationSec));
    return {
      durationSec,
      track: { kind: 'instrumental', mimeType: 'audio/wav', base64: wav.toString('base64') },
    };
  };

  // Mock: synthesize a real, playable WAV locally — no external calls needed.
  if (providers.voice === 'mock') {
    const inst = makeInstrumental();
    return {
      songId: randomUUID(),
      title,
      style,
      provider: providers,
      mock: true,
      voiceCloned: false,
      durationMs: Math.round(inst.durationSec * 1000),
      tracks: [inst.track],
      note: 'Demo mode: synthesized an instrumental sketch. Voice cloning on AWS (Bedrock/CAMB) ships next.',
    };
  }

  // Bedrock voice (CAMB MARS6) → cloned vocal stem + local backing track.
  if (providers.voice === 'bedrock') {
    const vocal = await generateBedrockVoice({ voice, lyrics });
    const inst = makeInstrumental();
    return {
      songId: randomUUID(),
      title,
      style,
      provider: providers,
      mock: false,
      voiceCloned: true,
      durationMs: Math.round(inst.durationSec * 1000),
      tracks: [vocal, inst.track],
      note: 'Voice cloned via Bedrock with a local backing track. Full mixdown is a follow-up.',
    };
  }

  // Amazon Polly → spoken vocal (first-party TTS) + local backing track.
  if (providers.voice === 'polly') {
    const vocal = await generatePollyVoice({ lyrics });
    const inst = makeInstrumental();
    return {
      songId: randomUUID(),
      title,
      style,
      provider: providers,
      mock: false,
      voiceCloned: false,
      durationMs: Math.round(inst.durationSec * 1000),
      tracks: [vocal, inst.track],
      note: 'Vocal is Amazon Polly neural speech (not a clone of your voice) over a local backing track.',
    };
  }

  // ElevenLabs → clone your voice + generate a produced song.
  if (providers.voice === 'elevenlabs') {
    const { tracks, voiceId } = await generateElevenLabsSong({ voice, lyrics, style });
    return {
      songId: randomUUID(),
      title,
      style,
      provider: providers,
      mock: false,
      voiceCloned: Boolean(voiceId),
      voiceId: voiceId || undefined,
      tracks,
      note: voiceId
        ? 'Song generated by Eleven Music (AI vocals) plus your cloned voice speaking the lyrics. Eleven Music does not sing in a cloned voice yet.'
        : 'Song generated by Eleven Music (AI vocals). Voice cloning was skipped — see server logs.',
    };
  }

  // SageMaker instrumental is the next slice — fail loudly rather than
  // silently returning something the user didn't ask for.
  const err = new Error(
    `Music provider "${providers.voice}/${providers.instrumental}" is not wired yet. Set MUSIC_MOCK_MODE=true to use the local demo synth.`
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
  // Paginated: a FilterExpression only matches within the scanned page, so this
  // list would silently omit a user's older tracks once the table passed 1 MB.
  const items = await paginatedScan({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(id, :prefix)',
    ExpressionAttributeValues: { ':prefix': `${MUSIC_PREFIX}${userId}_` },
  }, { client: _dynamodb });

  const songs = items
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

/**
 * Delete a single song by its raw song id.
 *
 * Accepts EITHER the raw `songId` or the full row id that `listSongs()` returns
 * (`music_<userId>_<songId>`). Without the normalization the row id was
 * prefixed a second time, so DeleteItem matched no key — which succeeds
 * silently, making the UI delete look like it worked until the next reload.
 */
async function deleteSong(userId, songId) {
  const ownerPrefix = `${MUSIC_PREFIX}${userId}_`;
  const rawId = String(songId || '').startsWith(ownerPrefix)
    ? String(songId).slice(ownerPrefix.length)
    : songId;

  await _dynamodb.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { id: `${ownerPrefix}${rawId}` },
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
  // Bedrock voice (CAMB MARS6) seam
  isVoiceConfigured,
  getVoiceModelId,
  getVoiceRegion,
  generateBedrockVoice,
  // Amazon Polly voice seam
  getPollyRegion,
  generatePollyVoice,
  // ElevenLabs seam (voice clone + music)
  getElevenLabsKey,
  isElevenLabsConfigured,
  cloneElevenLabsVoice,
  elevenLabsTts,
  buildElevenLabsMusicPrompt,
  generateElevenLabsMusic,
  generateElevenLabsSong,
};
