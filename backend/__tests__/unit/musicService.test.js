/**
 * musicService.test.js — unit tests for the AI music generation service.
 *
 * Covers the pure parts (catalog, validation, style normalization, voice
 * parsing, the local mock WAV synth) plus the Bedrock voice-cloning seam.
 * No network and no DynamoDB — persistence helpers are exercised separately.
 */

// musicService instantiates a DynamoDB client at load; @aws-sdk ships ESM
// builds this repo's Jest config can't parse, so the SDK is mocked here to
// keep the test fast and offline (same pattern as storageTracker.test.js).
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({})) },
  PutCommand: jest.fn(),
  ScanCommand: jest.fn(),
  DeleteCommand: jest.fn(),
}));

// Same treatment for the Bedrock runtime (lazily required by the voice seam).
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeModelCommand: jest.fn().mockImplementation((input) => ({ input })),
  ConverseCommand: jest.fn(),
  ConverseStreamCommand: jest.fn(),
}));

// Amazon Polly client (lazily required by the Polly voice seam).
const mockPollySend = jest.fn();
jest.mock('@aws-sdk/client-polly', () => ({
  PollyClient: jest.fn().mockImplementation(() => ({ send: mockPollySend })),
  SynthesizeSpeechCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const {
  getCatalog,
  normalizeStyle,
  parseVoiceInput,
  validateGenerateInput,
  generateSong,
  generateBedrockVoice,
  generatePollyVoice,
  generateElevenLabsSong,
  buildElevenLabsMusicPrompt,
} = require('../../services/musicService');

// ~1500 real bytes → well above the service's 1000-byte minimum sample size.
const SAMPLE_VOICE_DATA_URL =
  'data:audio/webm;base64,' + Buffer.alloc(1500, 97).toString('base64');

describe('musicService.getCatalog', () => {
  test('returns the expected catalogs and defaults', () => {
    const catalog = getCatalog();
    expect(catalog.genres).toContain('pop');
    expect(catalog.moods).toContain('upbeat');
    expect(catalog.tempos).toContain('mid');
    expect(catalog.instruments).toContain('piano');
    expect(catalog.defaults).toMatchObject({ genre: 'pop', mood: 'upbeat', tempo: 'mid' });
    expect(typeof catalog.configured).toBe('boolean');
    expect(typeof catalog.mock).toBe('boolean');
  });
});

describe('musicService.normalizeStyle', () => {
  test('applies defaults for missing/unknown values', () => {
    expect(normalizeStyle({})).toEqual({
      genre: 'pop', mood: 'upbeat', tempo: 'mid', instruments: [], reference: '',
    });
    expect(normalizeStyle({ genre: 'metal', mood: 'zzz', tempo: 'ludicrous' })).toEqual({
      genre: 'pop', mood: 'upbeat', tempo: 'mid', instruments: [], reference: '',
    });
  });

  test('accepts known values and dedupes instruments', () => {
    const style = normalizeStyle({
      genre: 'Rock', mood: 'Melancholic', tempo: 'Fast',
      instruments: ['piano', 'Piano', 'strings', 'not-an-instrument'],
      reference: '  sunny 2000s pop  ',
    });
    expect(style).toEqual({
      genre: 'rock', mood: 'melancholic', tempo: 'fast',
      instruments: ['piano', 'strings'], reference: 'sunny 2000s pop',
    });
  });
});

describe('musicService.parseVoiceInput', () => {
  test('rejects missing voice', () => {
    expect(parseVoiceInput(undefined).error).toBeTruthy();
    expect(parseVoiceInput({}).error).toBeTruthy();
  });

  test('accepts an S3 voice sample key', () => {
    expect(parseVoiceInput({ voiceSampleKey: 'users/1/voice/x.wav' })).toEqual({
      key: 'users/1/voice/x.wav',
    });
  });

  test('accepts an inline audio data URL', () => {
    const parsed = parseVoiceInput({ dataUrl: SAMPLE_VOICE_DATA_URL });
    expect(parsed.inline.mimeType).toBe('audio/webm');
    expect(parsed.inline.bytes).toBeGreaterThan(0);
  });

  test('rejects non-audio data URLs', () => {
    expect(parseVoiceInput({ dataUrl: 'data:text/plain;base64,aGk=' }).error).toBeTruthy();
  });

  test('accepts recorder data URLs with codec parameters', () => {
    // Chrome's MediaRecorder emits `audio/webm;codecs=opus`.
    const b64 = Buffer.alloc(1500, 97).toString('base64');
    const parsed = parseVoiceInput({ dataUrl: `data:audio/webm;codecs=opus;base64,${b64}` });
    expect(parsed.error).toBeUndefined();
    expect(parsed.inline.mimeType).toBe('audio/webm');
    expect(parsed.inline.bytes).toBeGreaterThanOrEqual(1000);
  });
});

describe('musicService.validateGenerateInput', () => {
  const base = {
    title: 'Surfing at Dawn',
    lyrics: '[Verse]\nGolden light\n\n[Chorus]\nWe are singing',
    style: {},
    voice: { dataUrl: SAMPLE_VOICE_DATA_URL },
    consent: true,
  };

  test('passes a complete, consenting request', () => {
    const result = validateGenerateInput(base);
    expect(result.error).toBeUndefined();
    expect(result.title).toBe('Surfing at Dawn');
    expect(result.voice.inline.mimeType).toBe('audio/webm');
  });

  test('requires consent', () => {
    const result = validateGenerateInput({ ...base, consent: false });
    expect(result.error).toMatch(/consent/i);
  });

  test('requires lyrics and a title', () => {
    expect(validateGenerateInput({ ...base, title: '' }).error).toMatch(/title/i);
    expect(validateGenerateInput({ ...base, lyrics: '' }).error).toMatch(/lyrics/i);
  });
});

describe('musicService.generateSong (mock)', () => {
  test('returns a playable WAV master track', async () => {
    const song = await generateSong({
      title: 'Test Song',
      lyrics: 'la la la',
      style: normalizeStyle({ mood: 'upbeat' }),
      voice: { inline: { mimeType: 'audio/webm', base64: 'AA==', bytes: 10 } },
    });

    expect(song.mock).toBe(true);
    expect(song.voiceCloned).toBe(false);
    expect(song.durationMs).toBeGreaterThan(0);
    expect(song.tracks).toHaveLength(1);
    expect(song.tracks[0].mimeType).toBe('audio/wav');

    const wav = Buffer.from(song.tracks[0].base64, 'base64');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.length).toBeGreaterThan(44);
  });
});

describe('musicService.generateBedrockVoice', () => {
  const OLD_MODEL = process.env.AWS_BEDROCK_VOICE_MODEL_ID;

  beforeEach(() => {
    process.env.AWS_BEDROCK_VOICE_MODEL_ID = 'camb-ai.mars6-v1-0';
    mockSend.mockReset();
    InvokeModelCommand.mockClear();
  });

  afterEach(() => {
    if (OLD_MODEL === undefined) delete process.env.AWS_BEDROCK_VOICE_MODEL_ID;
    else process.env.AWS_BEDROCK_VOICE_MODEL_ID = OLD_MODEL;
  });

  test('sends reference audio + lyrics and parses the returned audio', async () => {
    mockSend.mockResolvedValue({
      body: Buffer.from(JSON.stringify({ audio: 'c29uZyBhdWRpbw==', mime_type: 'audio/mpeg' })),
    });

    const track = await generateBedrockVoice({
      voice: { inline: { mimeType: 'audio/webm', base64: 'REFBVQ==', bytes: 4 } },
      lyrics: 'la la la',
    });

    expect(track.kind).toBe('vocal');
    expect(track.mimeType).toBe('audio/mpeg');
    expect(track.base64).toBe('c29uZyBhdWRpbw==');

    const sent = InvokeModelCommand.mock.calls[0][0];
    expect(sent.modelId).toBe('camb-ai.mars6-v1-0');
    const body = JSON.parse(sent.body);
    expect(body.reference_audio).toBe('REFBVQ==');
    expect(body.text).toBe('la la la');
  });

  test('throws 503 when no voice model id is configured', async () => {
    delete process.env.AWS_BEDROCK_VOICE_MODEL_ID;
    await expect(generateBedrockVoice({
      voice: { inline: { mimeType: 'audio/webm', base64: 'AA==', bytes: 2 } },
      lyrics: 'la la la',
    })).rejects.toMatchObject({ status: 503 });
  });
});

describe('musicService.generateSong (bedrock voice)', () => {
  const OLD_MODEL = process.env.AWS_BEDROCK_VOICE_MODEL_ID;
  const OLD_PROVIDER = process.env.MUSIC_VOICE_PROVIDER;

  beforeEach(() => {
    process.env.AWS_BEDROCK_VOICE_MODEL_ID = 'camb-ai.mars6-v1-0';
    delete process.env.MUSIC_VOICE_PROVIDER; // auto-detect via isVoiceConfigured()
    mockSend.mockReset();
    mockSend.mockResolvedValue({
      body: Buffer.from(JSON.stringify({ audio: 'aGVsbG8=' })),
    });
  });

  afterEach(() => {
    if (OLD_MODEL === undefined) delete process.env.AWS_BEDROCK_VOICE_MODEL_ID;
    else process.env.AWS_BEDROCK_VOICE_MODEL_ID = OLD_MODEL;
    if (OLD_PROVIDER === undefined) delete process.env.MUSIC_VOICE_PROVIDER;
    else process.env.MUSIC_VOICE_PROVIDER = OLD_PROVIDER;
  });

  test('returns a cloned vocal + local instrumental backing track', async () => {
    const song = await generateSong({
      title: 'T',
      lyrics: 'la la la',
      style: normalizeStyle({}),
      voice: { inline: { mimeType: 'audio/webm', base64: 'AA==', bytes: 4 } },
    });

    expect(song.mock).toBe(false);
    expect(song.voiceCloned).toBe(true);
    expect(song.tracks.map((t) => t.kind).sort()).toEqual(['instrumental', 'vocal']);
    expect(song.provider.voice).toBe('bedrock');
  });
});

describe('musicService.generatePollyVoice', () => {
  beforeEach(() => {
    mockPollySend.mockReset();
  });

  test('synthesizes lyrics and returns an mp3 vocal track', async () => {
    const mp3 = Buffer.from('ID3 fake-mp3-bytes');
    mockPollySend.mockResolvedValue({ AudioStream: mp3, ContentType: 'audio/mpeg' });

    const track = await generatePollyVoice({ lyrics: 'la la la' });

    expect(track.kind).toBe('vocal');
    expect(track.mimeType).toBe('audio/mpeg');
    expect(track.spoken).toBe(true);
    expect(track.base64).toBe(mp3.toString('base64'));

    const sent = SynthesizeSpeechCommand.mock.calls[0][0];
    expect(sent.Text).toBe('la la la');
    expect(sent.OutputFormat).toBe('mp3');
    expect(sent.VoiceId).toBeTruthy();
  });

  test('truncates lyrics to Polly-safe length', async () => {
    mockPollySend.mockResolvedValue({ AudioStream: new Uint8Array([1, 2, 3]), ContentType: 'audio/mpeg' });
    const longLyrics = 'a'.repeat(4000);
    await generatePollyVoice({ lyrics: longLyrics });
    const sent = SynthesizeSpeechCommand.mock.calls[0][0];
    expect(sent.Text.length).toBeLessThanOrEqual(2800);
  });
});

describe('musicService.generateSong (polly voice)', () => {
  const OLD_PROVIDER = process.env.MUSIC_VOICE_PROVIDER;

  beforeEach(() => {
    process.env.MUSIC_VOICE_PROVIDER = 'polly';
    mockPollySend.mockReset();
    mockPollySend.mockResolvedValue({ AudioStream: Buffer.from('mp3'), ContentType: 'audio/mpeg' });
  });

  afterEach(() => {
    if (OLD_PROVIDER === undefined) delete process.env.MUSIC_VOICE_PROVIDER;
    else process.env.MUSIC_VOICE_PROVIDER = OLD_PROVIDER;
  });

  test('returns a spoken vocal + local instrumental', async () => {
    const song = await generateSong({
      title: 'T',
      lyrics: 'la la la',
      style: normalizeStyle({}),
      voice: { inline: { mimeType: 'audio/webm', base64: 'AA==', bytes: 4 } },
    });

    expect(song.mock).toBe(false);
    expect(song.voiceCloned).toBe(false);
    expect(song.tracks.map((t) => t.kind).sort()).toEqual(['instrumental', 'vocal']);
    expect(song.provider.voice).toBe('polly');
  });
});

describe('musicService.buildElevenLabsMusicPrompt', () => {
  test('combines style + lyrics and respects the prompt cap', () => {
    const prompt = buildElevenLabsMusicPrompt({
      lyrics: 'la la la',
      style: normalizeStyle({ genre: 'pop', mood: 'upbeat', tempo: 'fast', instruments: ['piano'] }),
    });
    expect(prompt).toContain('upbeat pop');
    expect(prompt).toContain('Lyrics: la la la');
    expect(prompt.length).toBeLessThanOrEqual(4000);
  });
});

describe('musicService.generateElevenLabsSong', () => {
  const OLD_KEY = process.env.ELEVENLABS_API_KEY;
  const originalFetch = global.fetch;

  const jsonResponse = (obj) => ({
    ok: true,
    status: 200,
    json: async () => obj,
  });
  const audioResponse = (bytes) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => {
      const buf = Buffer.from(bytes);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    headers: { get: () => 'audio/mpeg' },
  });

  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = 'sk-test';
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/v1/voices/add')) return jsonResponse({ voice_id: 'abc123' });
      if (u.includes('/v1/text-to-speech/')) return audioResponse('tts-bytes');
      if (u.includes('/v1/music')) return audioResponse('music-bytes');
      throw new Error('Unexpected fetch URL: ' + u);
    });
  });

  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = OLD_KEY;
    global.fetch = originalFetch;
  });

  test('returns a master music track + spoken cloned-vocal track', async () => {
    const { tracks, voiceId } = await generateElevenLabsSong({
      voice: { inline: { mimeType: 'audio/webm', base64: 'REFBVQ==', bytes: 4 } },
      lyrics: 'la la la',
      style: normalizeStyle({}),
    });

    expect(voiceId).toBe('abc123');
    expect(tracks.map((t) => t.kind)).toEqual(['master', 'vocal']);
    expect(tracks[0].base64).toBe(Buffer.from('music-bytes').toString('base64'));
    expect(tracks[1].base64).toBe(Buffer.from('tts-bytes').toString('base64'));
  });

  test('sends the xi-api-key header on every call', async () => {
    await generateElevenLabsSong({
      voice: { inline: { mimeType: 'audio/webm', base64: 'REFBVQ==', bytes: 4 } },
      lyrics: 'la la la',
      style: normalizeStyle({}),
    });

    for (const call of global.fetch.mock.calls) {
      expect(call[1].headers['xi-api-key']).toBe('sk-test');
    }
  });

  test('still returns music when voice cloning fails', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/v1/voices/add')) return { ok: false, status: 401, text: async () => JSON.stringify({ detail: { message: 'bad key' } }) };
      if (u.includes('/v1/music')) return audioResponse('music-bytes');
      throw new Error('Unexpected fetch URL: ' + u);
    });

    const { tracks, voiceId } = await generateElevenLabsSong({
      voice: { inline: { mimeType: 'audio/webm', base64: 'REFBVQ==', bytes: 4 } },
      lyrics: 'la la la',
      style: normalizeStyle({}),
    });

    expect(voiceId).toBeNull();
    expect(tracks.map((t) => t.kind)).toEqual(['master']);
  });

  test('throws when music generation fails', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/v1/voices/add')) return jsonResponse({ voice_id: 'abc123' });
      if (u.includes('/v1/text-to-speech/')) return audioResponse('tts-bytes');
      if (u.includes('/v1/music')) return { ok: false, status: 403, text: async () => JSON.stringify({ detail: { message: 'music requires a paid plan' } }) };
      throw new Error('Unexpected fetch URL: ' + u);
    });

    await expect(generateElevenLabsSong({
      voice: { inline: { mimeType: 'audio/webm', base64: 'REFBVQ==', bytes: 4 } },
      lyrics: 'la la la',
      style: normalizeStyle({}),
    })).rejects.toThrow(/paid plan|music generation failed/i);
  });
});
