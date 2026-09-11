/**
 * aiModel.js — the single source of truth for the AI model identity the app
 * actually uses, and for how that identity is written anywhere the UI talks
 * about a model or its provider.
 *
 * Why this exists
 * ---------------
 * Model and provider names used to be copy-pasted into components and legal
 * pages ("Claude Haiku 4.5", "AWS Bedrock", "DeepSeek", "GPT-…"). Whenever the
 * backend provider changed — e.g. the GitHub Models → AWS Bedrock migration —
 * those copies drifted and the site kept claiming a model it was no longer
 * calling. Import from here instead of writing a model/provider name inline.
 *
 * Live vs. fallback
 * -----------------
 * The *live* identity comes from the backend `/llm-providers` response;
 * `utils/llmProviderOptions.js` resolves the currently-selected model against
 * that payload. The constants below are the fallback used before that payload
 * arrives and by static copy (marketing/legal pages) that renders outside a
 * provider-data context. Those constants mirror the always-on backend default
 * in `backend/utils/llmProviders.js` (PROVIDERS) — keep them in sync.
 */

// ──────────────────────────────────────────────
// Default cloud (server-paid) chat model
// ──────────────────────────────────────────────
/** Provider key that backs cloud chat by default (see backend PROVIDERS). */
export const DEFAULT_CLOUD_PROVIDER = 'bedrock';

/** Cross-region inference profile id for the default cloud chat model. */
export const DEFAULT_CLOUD_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/** Human-readable name of the default cloud chat model. */
export const DEFAULT_CLOUD_MODEL_NAME = 'Claude Haiku 4.5';

/** Convenience object combining the default cloud model's identity. */
export const DEFAULT_CLOUD_MODEL = Object.freeze({
  id: DEFAULT_CLOUD_MODEL_ID,
  name: DEFAULT_CLOUD_MODEL_NAME,
  provider: DEFAULT_CLOUD_PROVIDER,
});

// ──────────────────────────────────────────────
// Default local (addon / HuggingFace) chat model
// ──────────────────────────────────────────────
/** Mirrors the first entry in `simple-addon/server/llm-service.js` (LOCAL_MODELS). */
export const DEFAULT_LOCAL_PROVIDER = 'local';
export const DEFAULT_LOCAL_MODEL_ID = 'Qwen/Qwen2.5-0.5B-Instruct';

// ──────────────────────────────────────────────
// DeepSeek (used by OCR text structuring / InfoData)
// ──────────────────────────────────────────────
export const DEEPSEEK_PROVIDER = 'deepseek';
export const DEEPSEEK_CHAT_MODEL_ID = 'deepseek-chat';
export const DEEPSEEK_REASONER_MODEL_ID = 'deepseek-reasoner';

/** Every DeepSeek model the UI can offer, with display names. */
export const DEEPSEEK_MODELS = Object.freeze([
  Object.freeze({ id: DEEPSEEK_CHAT_MODEL_ID, name: 'DeepSeek-V3 (Chat)' }),
  Object.freeze({ id: DEEPSEEK_REASONER_MODEL_ID, name: 'DeepSeek-R1 (Reasoner)' }),
]);

export const DEFAULT_DEEPSEEK_MODEL_ID = DEEPSEEK_CHAT_MODEL_ID;

// ──────────────────────────────────────────────
// Display-name maps
// ──────────────────────────────────────────────
/**
 * Known model id → human-readable display name. Mirrors the `name` fields in
 * backend/utils/llmProviders.js. Used to render a friendly label from a raw
 * model id (e.g. the one stored on a chat message) without needing the live
 * provider payload.
 */
export const MODEL_LABELS = Object.freeze({
  [DEFAULT_CLOUD_MODEL_ID]: DEFAULT_CLOUD_MODEL_NAME,
  [DEEPSEEK_CHAT_MODEL_ID]: 'DeepSeek-V3 (Chat)',
  [DEEPSEEK_REASONER_MODEL_ID]: 'DeepSeek-R1 (Reasoner)',
  [DEFAULT_LOCAL_MODEL_ID]: 'Qwen 2.5 0.5B',
});

/** Provider key → service/vendor label shown to users. */
export const PROVIDER_LABELS = Object.freeze({
  bedrock: 'AWS Bedrock',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  github: 'GitHub Models',
  local: 'Local (HuggingFace)',
});

/** Provider key → the company behind the model (used in disclosure copy). */
export const PROVIDER_VENDORS = Object.freeze({
  bedrock: 'Anthropic',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  github: 'GitHub',
});

/**
 * Resolve a provider key to its user-facing service label.
 * Unknown keys fall through to the key itself so nothing renders blank.
 */
export function providerLabel(providerKey) {
  if (!providerKey) return '';
  return PROVIDER_LABELS[providerKey] || String(providerKey);
}

/** Resolve a provider key to the company/vendor behind its models. */
export function providerVendor(providerKey) {
  if (!providerKey) return '';
  return PROVIDER_VENDORS[providerKey] || providerLabel(providerKey);
}

/**
 * Friendly display name for a model id. Uses the shared label map first, then
 * falls back to the id's tail (so a provider-scoped id like
 * `google/gemini-2.5-flash` renders as `gemini-2.5-flash` rather than the raw
 * `us.anthropic.…` string).
 */
export function modelDisplayName(modelId) {
  if (!modelId) return '';
  const id = String(modelId);
  if (MODEL_LABELS[id]) return MODEL_LABELS[id];
  const tail = id.split('/').pop();
  return tail || id;
}

// ──────────────────────────────────────────────
// Disclosure copy (privacy / terms)
// ──────────────────────────────────────────────
/**
 * Providers the Service may send AI content to, in the order they should be
 * disclosed. Single source for the privacy/terms sub-processor lists.
 */
export const AI_CONTENT_PROCESSORS = Object.freeze(['deepseek', 'bedrock']);

/**
 * Human-readable list of the AI providers above, e.g.
 * "DeepSeek and AWS Bedrock".
 */
export function aiContentProcessorList() {
  const labels = AI_CONTENT_PROCESSORS.map(providerLabel);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
