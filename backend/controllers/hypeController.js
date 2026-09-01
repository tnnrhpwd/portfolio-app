/**
 * hypeController.js — Public "Hype" quote generator.
 *
 *   POST /api/data/hype/quote  → { success, quote, provider }
 *
 * Generates a fresh motivational hype quote via an LLM (Bedrock first, then
 * DeepSeek) and falls back to a curated local list if every provider fails —
 * so the /hype page never shows an empty card, even during provider outages.
 *
 * The endpoint is intentionally public (the /hype page is a marketing page
 * with no account required). Rate limiting is applied at the route level via
 * `llmLimiter`, which falls back to IP-keyed limiting when there is no user.
 */

const asyncHandler = require('express-async-handler');
const { logger } = require('../utils/logger');
const { createBedrockCompletion } = require('../services/bedrockService');
const { createCompletion, PROVIDERS } = require('../utils/llmProviders');

// Curated fallback quotes — served when every LLM provider is down. Kept
// punchy and original so a failed provider never looks like a broken page.
const FALLBACK_QUOTES = [
  'You did not wake up today to be average. Go be the reason someone believes in better.',
  'The version of you that wins is the one that shows up one more time than yesterday.',
  'Momentum is a liar until you move. Move, and momentum shows up to help.',
  'Discipline is just love for your future self, paid in advance.',
  'You are not behind. You are loading. Keep going.',
  'Hard days build the person who wins the easy days.',
  'Start messy, finish legendary.',
  'Your only real competition is the version of you that almost quit.',
  'Small steps, every day, in one direction — that is how impossible things get built.',
  'Courage is the noise you make when fear tells you to be quiet.',
];

// Rotating style + subject hints keep every generated quote genuinely fresh
// even when users mash the button back-to-back.
const STYLES = [
  'bold and punchy',
  'poetic and vivid',
  'stoic and calm',
  'wild and unhinged (but positive)',
  'short like a one-two punch',
  'storytelling and cinematic',
  'playful and witty',
  'urgent like a coach at halftime',
];

const SUBJECTS = [
  'overcoming self-doubt',
  'starting before you feel ready',
  'discipline and consistency',
  'turning failure into fuel',
  'believing in yourself',
  'building unstoppable momentum',
  'doing hard things',
  'winning the day',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Ask an LLM for a single, original hype quote. Returns the trimmed text.
 * Tries Bedrock first, then DeepSeek (if configured).
 */
async function generateWithLLM(mood) {
  const style = pick(STYLES);
  const subject = pick(SUBJECTS);
  const moodHint = mood ? ` The reader's current mood is "${mood}".` : '';

  const messages = [
    {
      role: 'system',
      content:
        'You are a world-class motivational hype coach. Write ONE original, unforgettable motivational quote. ' +
        'Rules: 1-3 sentences max, no hashtags, no emojis, no attribution, no quotation marks around the whole thing, ' +
        'no clichés, and never repeat a quote you have written before.',
    },
    {
      role: 'user',
      content:
        `Write a ${style} motivational quote about ${subject}.${moodHint} ` +
        `Make it feel brand new — this is for someone pressing a "hype me up" button repeatedly.`,
    },
  ];

  // 1) Bedrock (Claude Haiku 4.5) — server-paid, already used across the app.
  try {
    const response = await createBedrockCompletion(messages, {
      maxTokens: 140,
      temperature: 1.1,
    });
    const raw = response?.choices?.[0]?.message?.content || '';
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text) return { quote: text, provider: 'bedrock' };
  } catch (err) {
    logger.warn('[hype] Bedrock quote generation failed, trying DeepSeek:', err.message);
  }

  // 2) DeepSeek — OpenAI-compatible, used when configured.
  if (PROVIDERS.deepseek.apiKey) {
    try {
      const response = await createCompletion('deepseek', 'deepseek-chat', messages, {
        maxTokens: 140,
        temperature: 1.1,
      });
      const raw = response?.choices?.[0]?.message?.content || '';
      const text = raw.replace(/\s+/g, ' ').trim();
      if (text) return { quote: text, provider: 'deepseek' };
    } catch (err) {
      logger.warn('[hype] DeepSeek quote generation failed:', err.message);
    }
  }

  throw new Error('All LLM providers failed');
}

// @desc    Generate a motivational hype quote via LLM
// @route   POST /api/data/hype/quote
// @access  Public (rate-limited)
const generateHypeQuote = asyncHandler(async (req, res) => {
  const mood = typeof req.body?.mood === 'string' ? req.body.mood.slice(0, 120) : '';

  try {
    const { quote, provider } = await generateWithLLM(mood);
    res.status(200).json({ success: true, quote, provider });
  } catch (err) {
    logger.warn('[hype] Serving fallback quote after LLM failure:', err.message);
    res.status(200).json({
      success: true,
      quote: pick(FALLBACK_QUOTES),
      provider: 'fallback',
    });
  }
});

module.exports = { generateHypeQuote };
