/**
 * llmProviderOptions.js — shared helpers for turning the backend's
 * `/llm-providers` response (see backend/utils/llmProviders.js) into a flat,
 * UI-ready model list.
 *
 * Centralized here so every surface that lets a user pick a cloud model (the
 * Net sidebar quick-picker, the Advanced Settings modal, and the /settings
 * page) reads the same live data instead of each hardcoding its own list —
 * which is exactly how they drifted out of sync with reality across the
 * GitHub Models → AWS Bedrock migration.
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

// The Simple Addon's "Cloud" mode is wired server-side to AWS Bedrock by
// default, with DeepSeek now selectable as an additional cloud provider (see
// backend/services/llmService.js, which routes non-Bedrock providers through
// the OpenAI-compatible createCompletion/streamCompletion). The backend's
// /llm-providers endpoint reports *every* provider that has server
// credentials configured. Filtering to this allowlist keeps every
// cloud-model surface (Simple Addon sidebar, Advanced Settings, /settings
// page) from showing a non-cloud model as a "cloud" option a user could
// select.
const CLOUD_PROVIDERS = ['bedrock', 'deepseek'];

/**
 * Flatten `{ providerKey: { name, models: { modelId: { name, rate, requiredTier } } } }`
 * (or the legacy array-of-models shape some callers still send) into
 * `[{ id, name, provider, rate, requiredTier }]`, restricted to the provider
 * that actually backs Cloud mode (AWS Bedrock).
 */
export function buildCloudModelList(portfolioLLMProviders) {
  if (!portfolioLLMProviders || typeof portfolioLLMProviders !== 'object') return [];
  const result = [];
  Object.entries(portfolioLLMProviders).forEach(([provider, config]) => {
    if (!CLOUD_PROVIDERS.includes(provider)) return;
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

/**
 * Resolve the model id that should actually be used/displayed for Cloud mode.
 *
 * Stored settings (local or synced from an older client) can carry a retired
 * model id — e.g. 'gpt-4o-mini' from before the AWS Bedrock migration. Trusting that id just because it's set previously caused GPT
 * model names to reappear in the model badge on every chat message and in
 * the sidebar's "current model" readout, even though the request was always
 * served by Bedrock. This always validates the stored id against the live
 * cloud model list (falling back to the fixed default when it doesn't
 * match), so a stale id can never resurface a decommissioned provider.
 */
export function getEffectiveCloudModelId(storedModelId, portfolioLLMProviders) {
  const cloudModels = buildCloudModelList(portfolioLLMProviders);
  if (cloudModels.some(m => m.id === storedModelId)) return storedModelId;
  return FALLBACK_CLOUD_MODEL.id;
}

/**
 * Resolve which provider backs a given cloud model id (e.g. 'deepseek-chat'
 * → 'deepseek', the Bedrock model id → 'bedrock'). Defaults to Bedrock so a
 * stale/unknown id never routes to a decommissioned provider.
 */
export function resolveCloudModelProvider(modelId, portfolioLLMProviders) {
  const match = buildCloudModelList(portfolioLLMProviders).find(m => m.id === modelId);
  return match?.provider || FALLBACK_CLOUD_MODEL.provider;
}
