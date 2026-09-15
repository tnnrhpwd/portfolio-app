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

import {
  DEFAULT_CLOUD_MODEL,
  DEEPSEEK_PROVIDER,
  LEGACY_DEFAULT_CLOUD_MODEL_IDS,
  modelDisplayName,
  providerLabel,
} from '../constants/aiModel.js';

// Shown only until the real `/llm-providers` response arrives (or if the fetch
// fails). The identity itself lives in constants/aiModel.js, which is kept in
// sync with the always-on provider catalogue in backend/utils/llmProviders.js
// (PROVIDERS.bedrock) — it is the BASELINE, not the model a user starts on: that
// is `defaultCloudModel()` below, which needs the live payload to know what the
// server is configured to serve.
export const FALLBACK_CLOUD_MODEL = {
  ...DEFAULT_CLOUD_MODEL,
  rate: null,
  requiredTier: null,
};

export const DEFAULT_CLOUD_MODEL_ID = DEFAULT_CLOUD_MODEL.id;

// The Simple Addon's "Cloud" mode is wired server-side to AWS Bedrock by
// default, with DeepSeek selectable as an additional cloud provider (see
// backend/services/llmService.js, which routes non-Bedrock providers through
// the OpenAI-compatible createCompletion/streamCompletion). The backend's
// /llm-providers endpoint reports *every* provider that has server
// credentials configured. Filtering to this allowlist keeps every
// cloud-model surface (Simple Addon sidebar, Advanced Settings, /settings
// page) from showing a non-cloud model as a "cloud" option a user could
// select.
//
// Exported because it is the one list that has to stay in step with the
// backend: every provider in `backend/utils/llmProviders.js` PROVIDERS backs
// Cloud chat today, so adding a provider there without adding it here would
// silently hide it from every picker. `backend/__tests__/unit/llmModelSync.test.js`
// fails when the two disagree, which is the guard that makes that impossible
// to miss rather than merely documented.
export const CLOUD_PROVIDERS = [DEFAULT_CLOUD_MODEL.provider, DEEPSEEK_PROVIDER];

/**
 * Flatten `{ providerKey: { name, models: { modelId: { name, rate, … } } } }`
 * (or the legacy array-of-models shape some callers still send) into
 * `[{ id, name, provider, rate, inputRate, outputRate, requiredTier, isDefault }]`,
 * restricted to the providers that actually back Cloud mode (see
 * CLOUD_PROVIDERS above).
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
          inputRate: (typeof m === 'object' && typeof m.inputRate === 'number') ? m.inputRate : null,
          outputRate: (typeof m === 'object' && typeof m.outputRate === 'number') ? m.outputRate : null,
          requiredTier: (typeof m === 'object' && m.requiredTier) ? m.requiredTier : null,
          isDefault: (typeof m === 'object' && m.isDefault === true),
        });
      });
    } else {
      Object.entries(config.models).forEach(([modelId, modelInfo]) => {
        result.push({
          id: modelId,
          name: modelInfo?.name || modelId,
          provider,
          rate: modelInfo?.rate || null,
          inputRate: typeof modelInfo?.inputRate === 'number' ? modelInfo.inputRate : null,
          outputRate: typeof modelInfo?.outputRate === 'number' ? modelInfo.outputRate : null,
          requiredTier: modelInfo?.requiredTier || null,
          isDefault: modelInfo?.isDefault === true,
        });
      });
    }
  });
  return result;
}

/**
 * The models a cloud-model picker should offer.
 *
 * The live `/llm-providers` payload is authoritative — it is the only thing
 * that knows which providers the *server* actually has credentials for. But it
 * is empty until the fetch lands, and permanently empty if that fetch fails, and
 * a picker with no options is a control the user cannot use. Falling back to the
 * always-on default is the honest floor: it is the model the backend serves when
 * nothing else is asked for.
 *
 * Every cloud-model surface must render this list (or, better, the
 * `CloudModelSelect` component that wraps it) — a surface that builds its own
 * list is how "/net offers Claude only" happened while DeepSeek was configured
 * server-side.
 */
export function cloudModelOptions(portfolioLLMProviders) {
  const live = buildCloudModelList(portfolioLLMProviders);
  return live.length > 0 ? live : [FALLBACK_CLOUD_MODEL];
}

/** "Claude Haiku 4.5 (AWS Bedrock)" for one entry of `cloudModelOptions()`. */
export function cloudModelOptionLabel(model) {
  if (!model?.id) return '';
  const name = model.name || modelDisplayName(model.id);
  return `${name} (${providerLabel(model.provider)})`;
}

/**
 * The providers backing Cloud chat right now, as one human string —
 * "AWS Bedrock + DeepSeek". Derived from the same live payload, so the label
 * follows reality instead of naming a single vendor: `providerLabel(DEFAULT_CLOUD_PROVIDER)`
 * said "Cloud (AWS Bedrock)" even while a DeepSeek model was selected and
 * answering.
 */
export function cloudProviderSummary(portfolioLLMProviders) {
  const seen = [];
  buildCloudModelList(portfolioLLMProviders).forEach((m) => {
    if (m.provider && !seen.includes(m.provider)) seen.push(m.provider);
  });
  if (seen.length === 0) return providerLabel(FALLBACK_CLOUD_MODEL.provider);
  // The always-on provider leads, so the label reads the same whatever order the
  // server serialized its providers in; anything else follows in payload order.
  const ordered = [
    ...seen.filter((key) => key === FALLBACK_CLOUD_MODEL.provider),
    ...seen.filter((key) => key !== FALLBACK_CLOUD_MODEL.provider),
  ];
  return ordered.map(providerLabel).join(' + ');
}

/**
 * The cloud model a user gets before they have chosen one: **the cheapest model
 * the server is configured to serve**, which the backend also marks in the
 * payload (`isDefault`, see `llmProviders.getDefaultModel()`) and uses for a
 * request that names no model.
 *
 * The flag is preferred because the ranking is a server-side policy (it needs the
 * metering table, `apiCosts`, which the client never sees). The local ranking is
 * the fallback for a payload that predates the flag — same basis, input + output
 * per 1M, summed — and the always-on baseline is the last resort, for no payload
 * at all. There is always exactly one answer, so a picker can never render an
 * empty selection.
 */
export function defaultCloudModel(portfolioLLMProviders) {
  const live = buildCloudModelList(portfolioLLMProviders);
  if (live.length === 0) return FALLBACK_CLOUD_MODEL;

  const flagged = live.find((m) => m.isDefault);
  if (flagged) return flagged;

  const priced = live.filter((m) => typeof m.inputRate === 'number' && typeof m.outputRate === 'number');
  if (priced.length === live.length) {
    return [...priced].sort((a, b) => (a.inputRate + a.outputRate) - (b.inputRate + b.outputRate))[0];
  }

  return live[0];
}

/** The id of `defaultCloudModel()` — what a picker selects for a new user. */
export function defaultCloudModelId(portfolioLLMProviders) {
  return defaultCloudModel(portfolioLLMProviders).id;
}

/**
 * The settings change that records "the user picked this model".
 *
 * The id and the record of the choice have to move together: a stored id on its
 * own cannot be told apart from the app's own default (see
 * `LEGACY_DEFAULT_CLOUD_MODEL_IDS`), so writing one without the other is how a
 * pick silently reverts to the default on the next load.
 */
export function cloudModelChoicePatch(modelId) {
  return { portfolioModel: modelId, portfolioModelChosen: modelId };
}

/**
 * Resolve the model id that should actually be used/displayed for Cloud mode.
 *
 * Precedence, and why:
 *
 *   1. **The user's recorded choice** (`portfolioModelChosen`) — always wins
 *      while the server still offers it. This is what "unless a user changes it"
 *      means.
 *   2. **A stored id that is some other model than a legacy default** — a choice
 *      made before the chosen-flag existed, so it is still respected.
 *   3. **The cheapest configured model** (`defaultCloudModel`). Everything else
 *      lands here: never chosen, a stored id equal to a legacy default (the app
 *      wrote that, the user did not pick it), a retired id from a previous
 *      provider, or a model the server no longer offers.
 *
 * @param {string} storedModelId - `settings.portfolioModel`
 * @param {object} portfolioLLMProviders - live `/llm-providers` payload
 * @param {string} [chosenModelId] - `settings.portfolioModelChosen` ('' if never)
 */
export function getEffectiveCloudModelId(storedModelId, portfolioLLMProviders, chosenModelId = '') {
  const cloudModels = buildCloudModelList(portfolioLLMProviders);
  const isLive = (id) => !!id && cloudModels.some(m => m.id === id);

  if (isLive(chosenModelId)) return chosenModelId;
  if (isLive(storedModelId) && !LEGACY_DEFAULT_CLOUD_MODEL_IDS.includes(storedModelId)) return storedModelId;
  return defaultCloudModelId(portfolioLLMProviders);
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

/**
 * Human-readable name for a cloud model id: the name the backend reported
 * for it, else the shared label map, else the bare id's tail.
 */
export function resolveCloudModelName(modelId, portfolioLLMProviders) {
  const match = buildCloudModelList(portfolioLLMProviders).find(m => m.id === modelId);
  return match?.name || modelDisplayName(modelId) || FALLBACK_CLOUD_MODEL.name;
}

/**
 * "Name (Provider)" label for a cloud model id — e.g.
 * "Claude Haiku 4.5 (AWS Bedrock)". Prefer this over writing a model or
 * provider name inline wherever the UI states what it is using.
 */
export function resolveCloudModelLabel(modelId, portfolioLLMProviders) {
  const provider = resolveCloudModelProvider(modelId, portfolioLLMProviders);
  return `${resolveCloudModelName(modelId, portfolioLLMProviders)} (${providerLabel(provider)})`;
}
