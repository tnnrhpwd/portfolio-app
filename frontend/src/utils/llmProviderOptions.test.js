import fs from 'fs';
import path from 'path';
import {
  buildCloudModelList,
  cloudModelChoicePatch,
  cloudModelOptionLabel,
  cloudModelOptions,
  cloudProviderSummary,
  defaultCloudModel,
  defaultCloudModelId,
  getEffectiveCloudModelId,
  resolveCloudModelName,
  resolveCloudModelProvider,
} from './llmProviderOptions.js';
import { DEFAULT_CLOUD_MODEL_ID, DEFAULT_CLOUD_MODEL_NAME } from '../constants/aiModel.js';

/**
 * The payload `GET /api/data/llm-providers` actually returns when both cloud
 * providers are configured — captured live rather than invented, so these tests
 * assert against the shape the app really gets (`{ success, providers }` →
 * redux keeps `providers`). Rates are the real ones ($0.27/$1.10, $0.55/$2.19,
 * $1.00/$5.00 per 1M in/out), which is what makes DeepSeek-V3 the cheapest.
 */
const LIVE_PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    models: {
      'deepseek-chat': {
        name: 'DeepSeek-V3 (Chat)', contextWindow: 64000, rate: '$0.27/1M',
        inputRate: 0.27, outputRate: 1.10, requiredTier: 'free', isDefault: true,
      },
      'deepseek-reasoner': {
        name: 'DeepSeek-R1 (Reasoner)', contextWindow: 64000, rate: '$0.55/1M',
        inputRate: 0.55, outputRate: 2.19, requiredTier: 'free', isDefault: false,
      },
    },
  },
  bedrock: {
    name: 'AWS Bedrock',
    models: {
      [DEFAULT_CLOUD_MODEL_ID]: {
        name: DEFAULT_CLOUD_MODEL_NAME, contextWindow: 200000, rate: '$1.00/1M',
        inputRate: 1, outputRate: 5, requiredTier: 'free', isDefault: false,
      },
    },
  },
};

/** The same payload without the server's flag — an older backend. */
const LIVE_PROVIDERS_UNFLAGGED = {
  deepseek: {
    name: 'DeepSeek',
    models: Object.fromEntries(Object.entries(LIVE_PROVIDERS.deepseek.models).map(([id, m]) => [id, { ...m, isDefault: false }])),
  },
  bedrock: {
    name: 'AWS Bedrock',
    models: Object.fromEntries(Object.entries(LIVE_PROVIDERS.bedrock.models).map(([id, m]) => [id, { ...m, isDefault: false }])),
  },
};

const BEDROCK_ONLY = { bedrock: LIVE_PROVIDERS.bedrock };

describe('cloudModelOptions — every configured cloud model is offerable', () => {
  test('offers all models from all providers, not just the current/default one', () => {
    const ids = cloudModelOptions(LIVE_PROVIDERS).map((m) => m.id);
    expect(ids).toEqual([
      'deepseek-chat',
      'deepseek-reasoner',
      DEFAULT_CLOUD_MODEL_ID,
    ]);
  });

  /**
   * The regression this whole module exists for: the picker UI showed Claude
   * while the backend was serving DeepSeek too. Any surface that builds its own
   * list skips this assertion, which is why `CloudModelSelect` renders this one.
   */
  test('loses no model the payload reported', () => {
    const offered = new Set(cloudModelOptions(LIVE_PROVIDERS).map((m) => m.id));
    buildCloudModelList(LIVE_PROVIDERS).forEach((m) => {
      expect(offered.has(m.id)).toBe(true);
    });
  });

  test('labels every option with its provider, so same-named models stay distinct', () => {
    const labels = Object.fromEntries(
      cloudModelOptions(LIVE_PROVIDERS).map((m) => [m.id, cloudModelOptionLabel(m)])
    );
    expect(labels['deepseek-chat']).toBe('DeepSeek-V3 (Chat) (DeepSeek)');
    expect(labels['deepseek-reasoner']).toBe('DeepSeek-R1 (Reasoner) (DeepSeek)');
    expect(labels[DEFAULT_CLOUD_MODEL_ID]).toBe('Claude Haiku 4.5 (AWS Bedrock)');
  });

  describe('never empty, and never a stale id', () => {
    test.each([
      ['undefined', undefined],
      ['null', null],
      ['empty object', {}],
      ['a non-object', 'nope'],
    ])('falls back to the always-on default for %s', (_label, payload) => {
      const options = cloudModelOptions(payload);
      expect(options).toHaveLength(1);
      expect(options[0].id).toBe(DEFAULT_CLOUD_MODEL_ID);
      expect(options[0].name).toBe(DEFAULT_CLOUD_MODEL_NAME);
    });
  });
});

describe('cloudProviderSummary — the label follows the live provider set', () => {
  test('names every provider backing cloud chat', () => {
    expect(cloudProviderSummary(LIVE_PROVIDERS)).toBe('AWS Bedrock + DeepSeek');
  });

  test('stays truthful when only one provider is configured', () => {
    expect(cloudProviderSummary(BEDROCK_ONLY)).toBe('AWS Bedrock');
  });

  test('reads the same whatever order the server serialized its providers in', () => {
    const reversedPayload = { bedrock: LIVE_PROVIDERS.bedrock, deepseek: LIVE_PROVIDERS.deepseek };
    expect(cloudProviderSummary(reversedPayload)).toBe(cloudProviderSummary(LIVE_PROVIDERS));
  });

  test('names the default provider before the payload arrives', () => {
    expect(cloudProviderSummary({})).toBe('AWS Bedrock');
    expect(cloudProviderSummary(undefined)).toBe('AWS Bedrock');
  });
});

describe('cloud model resolution against the live payload', () => {
  test('a served model resolves to its own provider and name', () => {
    expect(resolveCloudModelProvider('deepseek-reasoner', LIVE_PROVIDERS)).toBe('deepseek');
    expect(resolveCloudModelName('deepseek-reasoner', LIVE_PROVIDERS)).toBe('DeepSeek-R1 (Reasoner)');
  });

  test('a provider the server is not offering now is not treated as available', () => {
    // The payload is authoritative: if the backend has no DeepSeek credentials
    // it will not report them, and the UI must not claim otherwise.
    expect(getEffectiveCloudModelId('deepseek-chat', BEDROCK_ONLY)).toBe(DEFAULT_CLOUD_MODEL_ID);
    expect(resolveCloudModelProvider('deepseek-chat', BEDROCK_ONLY)).toBe('bedrock');
  });
});

/**
 * "The default model should be the cheapest unless a user changes it."
 *
 * The subtlety these tests pin down: `settings.portfolioModel` alone cannot say
 * which of the two it is. Every existing user's store holds the id this app used
 * to write as its default (Bedrock's Claude), and that value is indistinguishable
 * from a deliberate pick of Claude — so the picker also records the choice
 * (`portfolioModelChosen`), and a legacy default with no record reads as "never
 * chosen".
 */
describe('the default is the cheapest model, until the user picks one', () => {
  test('prefers the model the server flags as its default', () => {
    expect(defaultCloudModelId(LIVE_PROVIDERS)).toBe('deepseek-chat');
    expect(defaultCloudModel(LIVE_PROVIDERS).name).toBe('DeepSeek-V3 (Chat)');
  });

  test('ranks on the same basis when the payload carries no flag', () => {
    // Same sum of per-1M rates the backend ranks on, so an older payload still
    // resolves to the cheapest model rather than to whatever came first.
    expect(defaultCloudModelId(LIVE_PROVIDERS_UNFLAGGED)).toBe('deepseek-chat');
  });

  test('falls back to the always-on baseline with no payload at all', () => {
    expect(defaultCloudModelId(undefined)).toBe(DEFAULT_CLOUD_MODEL_ID);
    expect(defaultCloudModelId({})).toBe(DEFAULT_CLOUD_MODEL_ID);
  });

  test('a user who never chose a model gets the cheapest one', () => {
    expect(getEffectiveCloudModelId('', LIVE_PROVIDERS)).toBe('deepseek-chat');
    expect(getEffectiveCloudModelId(undefined, LIVE_PROVIDERS)).toBe('deepseek-chat');
  });

  test('the app\'s own former default is not treated as a choice', () => {
    // The exact case every existing account is in: the store holds Claude
    // because the app seeded it, not because anyone picked it.
    expect(getEffectiveCloudModelId(DEFAULT_CLOUD_MODEL_ID, LIVE_PROVIDERS)).toBe('deepseek-chat');
  });

  test('a recorded choice always wins, including a re-pick of the old default', () => {
    expect(getEffectiveCloudModelId(DEFAULT_CLOUD_MODEL_ID, LIVE_PROVIDERS, DEFAULT_CLOUD_MODEL_ID))
      .toBe(DEFAULT_CLOUD_MODEL_ID);
    expect(getEffectiveCloudModelId('deepseek-reasoner', LIVE_PROVIDERS, 'deepseek-reasoner'))
      .toBe('deepseek-reasoner');
  });

  test('a pre-flag pick of some non-default model is still respected', () => {
    expect(getEffectiveCloudModelId('deepseek-reasoner', LIVE_PROVIDERS)).toBe('deepseek-reasoner');
  });

  test('a retired or no-longer-offered id resolves to the default', () => {
    expect(getEffectiveCloudModelId('gpt-4o-mini', LIVE_PROVIDERS)).toBe('deepseek-chat');
    // Recorded, but the server stopped offering it → back to the default.
    expect(getEffectiveCloudModelId('deepseek-chat', BEDROCK_ONLY, 'deepseek-chat')).toBe(DEFAULT_CLOUD_MODEL_ID);
  });

  test('a choice writes the id and the record of it together', () => {
    // One patch, so a pick cannot half-apply and silently revert next load.
    expect(cloudModelChoicePatch('deepseek-reasoner')).toEqual({
      portfolioModel: 'deepseek-reasoner',
      portfolioModelChosen: 'deepseek-reasoner',
    });
  });
});

/**
 * The data was never the problem — the *rendering* was. `/net`'s sidebar showed
 * the resolved current model as static text while the backend also served
 * DeepSeek, so the one place a chat user looks to change models named a single
 * provider. Rendering is now owned by one component, and these two checks keep
 * it that way: a surface may not build its own list, and the surfaces that offer
 * cloud models must actually use the shared picker.
 */
describe('one place decides which cloud models the UI offers', () => {
  const SRC = path.resolve(__dirname, '..');
  const ALLOWED = new Set([
    'utils/llmProviderOptions.js', // defines the list
    'components/SimpleAddon/CloudModelSelect.jsx', // renders it
  ]);

  const sourceFiles = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!/\.(js|jsx)$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
      return [full];
    });

  const relative = (file) => path.relative(SRC, file).split(path.sep).join('/');
  const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');

  test('no surface builds its own cloud model list', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !ALLOWED.has(relative(file)))
      .filter((file) => /(buildCloudModelList|cloudModelOptions|cloudModelOptionLabel)\s*\(/.test(read(relative(file))))
      .map(relative);
    expect(offenders).toEqual([]);
  });

  test.each([
    'components/SimpleAddon/Sidebar.jsx', // the /net conversation rail
    'components/SimpleAddon/AIWorkflowSettings.jsx', // Advanced Settings + /settings
  ])('%s offers cloud models through the shared picker', (file) => {
    expect(read(file)).toMatch(/<CloudModelSelect/);
  });
});
