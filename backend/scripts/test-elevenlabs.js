/**
 * test-elevenlabs.js — diagnostic for the ElevenLabs music provider.
 *
 * Hydrates secrets (ELEVENLABS_API_KEY from Secrets Manager), then calls
 * generateElevenLabsSong directly with a placeholder voice sample so we can see
 * exactly which ElevenLabs call fails and why (clone / TTS / music).
 *
 * Run: node backend/scripts/test-elevenlabs.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadAllSecrets } = require('../utils/awsSecrets');
const musicService = require('../services/musicService');

(async () => {
  await loadAllSecrets();
  console.log('ELEVENLABS_API_KEY present:', Boolean(process.env.ELEVENLABS_API_KEY));

  // Placeholder audio (valid base64, not real audio) — the clone may reject it,
  // but that is fine: the diagnostic's job is to reveal each step's error.
  const b64 = Buffer.alloc(5000, 97).toString('base64');

  try {
    const { tracks, voiceId } = await musicService.generateElevenLabsSong({
      voice: { inline: { mimeType: 'audio/webm', base64: b64, bytes: 5000 } },
      lyrics: 'Hello, this is a diagnostic test song.',
      style: musicService.normalizeStyle({ genre: 'pop', mood: 'upbeat', tempo: 'mid' }),
    });
    console.log('SUCCESS');
    console.log('  voiceId:', voiceId);
    console.log('  tracks:', tracks.map((t) => ({
      kind: t.kind,
      mimeType: t.mimeType,
      approxBytes: Math.round((t.base64.length * 3) / 4),
    })));
  } catch (err) {
    console.error('FAILED');
    console.error('  message:', err.message);
    console.error('  status:', err.status || '(none)');
    if (err.cause) console.error('  cause:', err.cause);
  }
})();
