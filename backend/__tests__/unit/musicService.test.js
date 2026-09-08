/**
 * musicService.test.js — unit tests for the AI music generation service.
 *
 * Covers only the pure parts: catalog shape, input validation, style
 * normalization, voice parsing, and the local mock WAV synthesizer. No
 * network and no DynamoDB — persistence helpers are exercised separately.
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

const {
  getCatalog,
  normalizeStyle,
  parseVoiceInput,
  validateGenerateInput,
  generateSong,
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
