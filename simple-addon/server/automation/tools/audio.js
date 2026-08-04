/**
 * audio.js — agent tools for microphone capture and transcription.
 *
 * Exposes two tools to the ReAct agent loop:
 *
 *   audio_transcribe  — transcribe the last N seconds of microphone audio.
 *                       Useful for: "what is the user saying?", voice notes.
 *
 *   audio_speak       — speak text aloud via TTS (pyttsx3).
 *                       Useful for: voice assistant responses.
 *
 * Both tools require the audio pipeline to be running (opt-in, managed by
 * AudioStreamManager). They fail gracefully with a clear error if the
 * microphone permission is not granted or the pipeline isn't started.
 */

const { getAudioStreamManager } = require('../../audio-stream-manager');

const audioTranscribe = {
    name: 'audio_transcribe',
    category: 'safe-read',
    description:
        'Transcribe microphone audio. Records until silence is detected (or max_seconds). ' +
        'Returns the spoken text and confidence. Requires microphone permission. ' +
        'Use when the goal involves understanding spoken input or confirming user instructions verbally.',
    parameters: {
        type: 'object',
        properties: {
            max_seconds: {
                type: 'number',
                description: 'Maximum recording duration in seconds (default 10, max 60).',
            },
            silence_ms: {
                type: 'number',
                description: 'Milliseconds of silence before auto-stopping (default 800).',
            },
        },
    },
    async run(args, ctx) {
        const mgr = getAudioStreamManager();
        const maxSeconds = Math.min(Number(args?.max_seconds) || 10, 60);
        const silenceMs = Math.min(Number(args?.silence_ms) || 800, 5000);
        ctx?.log?.('[audio] starting transcription, max=' + maxSeconds + 's');
        try {
            const result = await mgr.listen({ maxSeconds, silenceMs });
            ctx?.log?.('[audio] transcript:', result?.text?.slice(0, 80));
            return {
                text: result?.text || '',
                confidence: result?.confidence ?? 0,
                language: result?.language || 'en',
                duration_s: result?.duration_s ?? 0,
                wakeword_detected: result?.wakeword_detected ?? false,
            };
        } catch (e) {
            throw new Error('audio_transcribe failed: ' + e.message);
        }
    },
    async dryRun(_args) {
        return { text: '[dry-run: microphone not accessed]', confidence: 0, duration_s: 0 };
    },
};

const audioSpeak = {
    name: 'audio_speak',
    category: 'system',
    description:
        'Speak text aloud using the system TTS engine (pyttsx3). ' +
        'Use for voice assistant responses, alerts, or confirmations. ' +
        'Keep text under 200 words for natural-sounding output.',
    parameters: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                description: 'Text to speak (max 500 chars).',
            },
            rate: {
                type: 'number',
                description: 'Speech rate in words per minute (default 175, range 80-300).',
            },
            volume: {
                type: 'number',
                description: 'Volume 0.0–1.0 (default 1.0).',
            },
        },
        required: ['text'],
    },
    async run(args, ctx) {
        const text = String(args?.text || '').slice(0, 500).trim();
        if (!text) throw new Error('audio_speak requires non-empty text');
        const rate = Math.min(Math.max(Number(args?.rate) || 175, 80), 300);
        const volume = Math.min(Math.max(Number(args?.volume) || 1.0, 0), 1.0);
        const mgr = getAudioStreamManager();
        ctx?.log?.('[audio] speaking:', text.slice(0, 60));
        await mgr.speak(text, { rate, volume });
        return { ok: true, text, rate, volume };
    },
    async dryRun(args) {
        return { ok: true, text: args?.text?.slice(0, 60) || '', dry: true };
    },
};

module.exports = { audioTranscribe, audioSpeak };
