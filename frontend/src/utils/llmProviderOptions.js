/**
 * llmProviderOptions.js — shared helpers for turning the backend's
 * `/llm-providers` response (see backend/utils/llmProviders.js) into a flat,
 * UI-ready model list.
 *
 * Centralized here so every surface that lets a user pick a cloud model (the
 * Net sidebar quick-picker, the Advanced Settings modal, and the /settings
 * page) reads the same live data instead of each hardcoding its own list —
 * which is exactly how they drifted out of sync with reality across the
 * GitHub Models → OpenAI/XAI → AWS Bedrock migrations.
 */

// Shown only until the real `/llm-providers` response arrives (or if the
// fetch fails) — kept in sync with the always-on backend default in
// backend/utils/llmProviders.js (PROVIDERS.bedrock).
export const FALLBACK_CLOUD_MODEL = {
  id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  name: 'Claude Haiku 4.5',
  provider: 'bedrock',
  rate: null,
  requiredTier: null,
};

export const DEFAULT_CLOUD_MODEL_ID = FALLBACK_CLOUD_MODEL.id;

/**
 * Flatten `{ providerKey: { name, models: { modelId: { name, rate, requiredTier } } } }`
 * (or the legacy array-of-models shape some callers still send) into
 * `[{ id, name, provider, rate, requiredTier }]`.
 */
export function buildCloudModelList(portfolioLLMProviders) {
  if (!portfolioLLMProviders || typeof portfolioLLMProviders !== 'object') return [];
  const result = [];
  Object.entries(portfolioLLMProviders).forEach(([provider, config]) => {
    if (!config?.models) return;
    if (Array.isArray(config.models)) {
      config.models.forEach(m => {
        result.push({
          id: typeof m === 'string' ? m : m.id,
          name: typeof m === 'string' ? m : (m.name || m.id),
          provider,
          rate: (typeof m === 'object' && m.rate) ? m.rate : null,
          requiredTier: (typeof m === 'object' && m.requiredTier) ? m.requiredTier : null,
        });
      });
    } else {
      Object.entries(config.models).forEach(([modelId, modelInfo]) => {
        result.push({
          id: modelId,
          name: modelInfo?.name || modelId,
          provider,
          rate: modelInfo?.rate || null,
          requiredTier: modelInfo?.requiredTier || null,
        });
      });
    }
  });
  return result;
}
