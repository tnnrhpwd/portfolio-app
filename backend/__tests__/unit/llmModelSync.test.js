/**
 * llmModelSync.test.js — drift guard between the backend's model catalogue (the
 * source of truth) and the frontend's copies of that identity.
 *
 * The source of truth is `backend/utils/llmProviders.js` PROVIDERS: it is what
 * `GET /api/data/llm-providers` reports, what `validateProviderModel()` accepts,
 * and what `parseCompressionRequest()` routes to. The frontend cannot import it
 * (Render deploys `backend/`, Netlify builds `frontend/` — same split that
 * `pricingSync.test.js` handles), so it mirrors the identity in
 * `frontend/src/constants/aiModel.js` and derives its pickers from the live
 * payload via `frontend/src/utils/llmProviderOptions.js`.
 *
 * Two failures this test exists to prevent, both real:
 *
 *   1. `CLOUD_PROVIDERS` (the frontend's cloud allowlist) not covering a
 *      provider the backend serves — the UI then hides a model the chat can
 *      actually use. A backend provider must be triaged here: add it to the
 *      allowlist, or to NON_CLOUD_PROVIDERS with a reason.
 *   2. `MODEL_LABELS` naming a model the backend no longer serves (the retired
 *      GitHub Models ids did exactly this), or the fallback identity drifting
 *      from the model the backend serves when a client names none.
 *
 * The frontend files are ESM (Vite), which Node/Jest won't parse as-is, so they
 * are transpiled to CommonJS with @babel/core and evaluated in a sandbox.
 */

const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

// Set before the module loads: `PROVIDERS.deepseek.apiKey` is read lazily but
// Bedrock's is captured at require time, and dotenv never overrides an existing
// value — so this makes the "both providers configured" case deterministic
// without touching the developer's real credentials.
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-deepseek-key';

const { PROVIDERS, getAvailableProviders, getDefaultModel } = require('../../utils/llmProviders.js');
const { API_COSTS } = require('../../utils/apiUsageTracker.js');
const { parseCompressionRequest } = require('../../services/llmService.js');

/** Providers the backend defines that deliberately do NOT back Cloud chat. */
const NON_CLOUD_PROVIDERS = [];

/** Transpile an ESM frontend module (and its relative imports) to CommonJS. */
function loadEsm(file) {
  const source = fs.readFileSync(file, 'utf8');
  const { code } = babel.transformSync(source, {
    filename: file,
    presets: [['@babel/preset-env', { modules: 'commonjs', targets: { node: 'current' } }]],
  });
  const mod = { exports: {} };
  const dir = path.dirname(file);
  const localRequire = (request) => {
    if (request.startsWith('.')) {
      const target = path.resolve(dir, request);
      for (const candidate of [target, `${target}.js`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return loadEsm(candidate);
      }
    }
    return require(request);
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'module', 'require', code)(mod.exports, mod, localRequire);
  return mod.exports;
}

const aiModel = loadEsm(path.resolve(__dirname, '../../../frontend/src/constants/aiModel.js'));
const providerOptions = loadEsm(path.resolve(__dirname, '../../../frontend/src/utils/llmProviderOptions.js'));

const modelEntries = (providerKey) => Object.entries(PROVIDERS[providerKey].models);

describe('LLM model identity — frontend matches the backend catalogue', () => {
  test('the frontend cloud allowlist covers every provider the backend defines', () => {
    const backendProviders = Object.keys(PROVIDERS).sort();
    const frontendProviders = [...providerOptions.CLOUD_PROVIDERS, ...NON_CLOUD_PROVIDERS].sort();
    expect(frontendProviders).toEqual(backendProviders);
  });

  test.each(providerOptions.CLOUD_PROVIDERS)(
    '%s has the same user-facing label on both sides',
    (providerKey) => {
      expect(PROVIDERS[providerKey]).toBeDefined();
      expect(aiModel.PROVIDER_LABELS[providerKey]).toBe(PROVIDERS[providerKey].name);
    }
  );

  test('every model id the frontend can render a label for is one the backend serves', () => {
    // Local models are provider-scoped HuggingFace ids ("Qwen/Qwen2.5-0.5B-Instruct");
    // cloud ids never contain a slash. This is the check that would have caught the
    // retired `gpt-4o-mini` left in MODEL_LABELS after the Bedrock migration.
    const servedIds = new Set(
      Object.values(PROVIDERS).flatMap((p) => Object.keys(p.models))
    );
    const cloudIdsInLabels = Object.keys(aiModel.MODEL_LABELS).filter((id) => !id.includes('/'));
    expect(cloudIdsInLabels.length).toBeGreaterThan(0);
    cloudIdsInLabels.forEach((id) => {
      expect(servedIds.has(id)).toBe(true);
    });
  });

  describe('the default cloud model mirrors the model the backend serves', () => {
    const bedrockModels = modelEntries('bedrock');

    test('Bedrock exposes exactly one model and the frontend mirrors its identity', () => {
      expect(bedrockModels).toHaveLength(1);
      const [id, info] = bedrockModels[0];
      expect(aiModel.DEFAULT_CLOUD_MODEL_ID).toBe(id);
      expect(aiModel.DEFAULT_CLOUD_MODEL_NAME).toBe(info.name);
      expect(aiModel.DEFAULT_CLOUD_MODEL).toEqual({
        id,
        name: info.name,
        provider: 'bedrock',
      });
    });

    test('the pre-payload fallback mirrors the always-on provider', () => {
      // `FALLBACK_CLOUD_MODEL` is what every picker shows before the live payload
      // lands (and what a payload-less call resolves to). It is the baseline, not
      // the default a user gets — that needs the live catalogue (below).
      expect(providerOptions.FALLBACK_CLOUD_MODEL.id).toBe(aiModel.DEFAULT_CLOUD_MODEL_ID);
      expect(providerOptions.FALLBACK_CLOUD_MODEL.name).toBe(aiModel.DEFAULT_CLOUD_MODEL_NAME);
    });
  });

  /**
   * "The default model should be the cheapest unless a user changes it."
   *
   * The server decides this, because ranking needs the metering table
   * (API_COSTS) that the client never sees: `getDefaultModel()` is what a
   * nameless request runs on, and the payload flags the same model `isDefault`
   * for the pickers. These tests hold the two together.
   */
  describe('the default model is the cheapest configured one', () => {
    const costPer1M = (providerKey, modelId) => {
      const cost = API_COSTS[providerKey]?.[modelId] || API_COSTS[providerKey]?.default;
      return cost ? cost.input + (cost.output || 0) : Number.POSITIVE_INFINITY;
    };

    test('no configured model is cheaper than the one it picks', () => {
      const { provider, model } = getDefaultModel();
      const chosen = costPer1M(provider, model);
      Object.entries(PROVIDERS).forEach(([providerKey, providerCfg]) => {
        if (!providerCfg.apiKey) return;
        Object.keys(providerCfg.models).forEach((modelId) => {
          expect(chosen).toBeLessThanOrEqual(costPer1M(providerKey, modelId));
        });
      });
    });

    test('with DeepSeek configured it picks DeepSeek-V3, not the dearer Claude', () => {
      // The regression: "default" used to mean Bedrock's model by construction, so
      // every user who never opened the picker stayed on the dearest model.
      expect(getDefaultModel()).toEqual({ provider: 'deepseek', model: 'deepseek-chat' });
    });

    test('the payload flags exactly that model, once', () => {
      const { provider, model } = getDefaultModel();
      const flagged = [];
      Object.entries(getAvailableProviders()).forEach(([providerKey, cfg]) => {
        Object.entries(cfg.models).forEach(([modelId, info]) => {
          if (info.isDefault) flagged.push({ provider: providerKey, model: modelId });
        });
      });
      expect(flagged).toEqual([{ provider, model }]);
    });

    test('the payload carries comparable numeric rates, not just display strings', () => {
      const models = getAvailableProviders().deepseek.models;
      expect(models['deepseek-chat'].inputRate).toBeCloseTo(0.27);
      expect(models['deepseek-chat'].outputRate).toBeCloseTo(1.10);
      expect(models['deepseek-reasoner'].outputRate).toBeCloseTo(2.19);
    });

    test('the frontend resolves the same default from the real payload', () => {
      // The invariant that matters: one catalogue, two languages, one answer.
      const payload = getAvailableProviders();
      const { model } = getDefaultModel();
      expect(providerOptions.defaultCloudModel(payload).id).toBe(model);
      expect(providerOptions.defaultCloudModelId(payload)).toBe(model);
    });

    test('a never-chosen user resolves to it, and a recorded choice survives', () => {
      const payload = getAvailableProviders();
      const { model } = getDefaultModel();
      expect(providerOptions.getEffectiveCloudModelId('', payload)).toBe(model);
      // The app's own former default is not a choice…
      expect(providerOptions.getEffectiveCloudModelId(aiModel.DEFAULT_CLOUD_MODEL_ID, payload)).toBe(model);
      // …but a recorded pick of that same model is.
      expect(providerOptions.getEffectiveCloudModelId(
        aiModel.DEFAULT_CLOUD_MODEL_ID, payload, aiModel.DEFAULT_CLOUD_MODEL_ID
      )).toBe(aiModel.DEFAULT_CLOUD_MODEL_ID);
    });
  });

  describe('a request that names no model bills the cheapest one', () => {
    const requestFor = (provider, model) => ({
      body: {
        data: JSON.stringify({ text: 'Net:{"message":"hi"}' }),
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
      },
    });

    test('no provider/model in the body resolves to the default', () => {
      const { provider, model } = getDefaultModel();
      expect(parseCompressionRequest(requestFor())).toMatchObject({ provider, model });
    });

    test('an explicitly requested, servable model is honoured', () => {
      expect(parseCompressionRequest(requestFor('deepseek', 'deepseek-reasoner')))
        .toMatchObject({ provider: 'deepseek', model: 'deepseek-reasoner' });
      expect(parseCompressionRequest(requestFor('bedrock', aiModel.DEFAULT_CLOUD_MODEL_ID)))
        .toMatchObject({ provider: 'bedrock', model: aiModel.DEFAULT_CLOUD_MODEL_ID });
    });

    test('a retired provider or unknown id falls back to the default', () => {
      const { provider, model } = getDefaultModel();
      // GitHub Models was retired; a legacy client still asking for it must not
      // produce a request for a model that no longer exists.
      expect(parseCompressionRequest(requestFor('github', 'gpt-4o'))).toMatchObject({ provider, model });
      expect(parseCompressionRequest(requestFor('deepseek', 'not-a-model'))).toMatchObject({ provider, model });
    });
  });

  describe('DeepSeek models match, id for id and name for name', () => {
    test('every frontend DeepSeek entry is one the backend serves', () => {
      const served = Object.fromEntries(modelEntries('deepseek'));
      expect(aiModel.DEEPSEEK_MODELS.length).toBeGreaterThan(0);
      aiModel.DEEPSEEK_MODELS.forEach((m) => {
        expect(served[m.id]).toBeDefined();
        expect(served[m.id].name).toBe(m.name);
      });
    });

    test('the backend serves no DeepSeek model the frontend cannot name', () => {
      const labelled = new Set(aiModel.DEEPSEEK_MODELS.map((m) => m.id));
      modelEntries('deepseek').forEach(([id]) => {
        expect(labelled.has(id)).toBe(true);
      });
    });

    test('the default DeepSeek model is one of the offered ones', () => {
      expect(aiModel.DEEPSEEK_MODELS.map((m) => m.id)).toContain(aiModel.DEFAULT_DEEPSEEK_MODEL_ID);
    });
  });
});
