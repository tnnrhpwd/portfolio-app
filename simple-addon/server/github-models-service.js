/**
 * GitHub Models API Service
 *
 * Uses the GitHub Models inference endpoint (OpenAI-compatible) to access
 * models like GPT-4o-mini, GPT-4o, etc. using a GitHub PAT.
 *
 * Endpoint: https://models.github.ai/inference (current GA endpoint)
 * Auth:     Bearer <GitHub PAT> — fine-grained PATs need the `models:read`
 *           permission; classic PATs work as long as the account has Copilot
 *           access (no special scopes required).
 * Docs:     https://docs.github.com/en/rest/models/inference
 *
 * Model IDs MUST be in the form `<publisher>/<model_name>` (e.g.
 * `openai/gpt-4o-mini`). The old Azure-hosted endpoint
 * (`https://models.inference.ai.azure.com`) was retired and now returns 401
 * for every request, which surfaced as a misleading "PAT expired" error.
 */

const GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference';
const GITHUB_MODELS_API_VERSION = '2022-11-28';

// Models available through GitHub Models API.
// `id` is what we send to the API (publisher-prefixed).
// `legacyId` lists older bare IDs we used to store in settings.json so we can
// upgrade silently without forcing the user to re-select their model.
const GITHUB_MODELS = [
  // OpenAI
  { id: 'openai/gpt-4o-mini', legacyId: ['gpt-4o-mini'], name: 'GPT-4o Mini', provider: 'github', description: 'Fast & cheap — great for most tasks', maxTokens: 4096, rate: 'Free · 150/day' },
  { id: 'openai/gpt-4o', legacyId: ['gpt-4o'], name: 'GPT-4o', provider: 'github', description: 'Highly capable multimodal model', maxTokens: 4096, rate: 'Free · 50/day' },
  { id: 'openai/gpt-4.1', legacyId: ['gpt-4.1'], name: 'GPT-4.1', provider: 'github', description: 'Latest flagship model', maxTokens: 4096, rate: 'Free · 50/day' },
  { id: 'openai/gpt-4.1-mini', legacyId: ['gpt-4.1-mini'], name: 'GPT-4.1 Mini', provider: 'github', description: 'Latest mini model — balanced performance', maxTokens: 4096, rate: 'Free · 150/day' },
  { id: 'openai/gpt-4.1-nano', legacyId: ['gpt-4.1-nano'], name: 'GPT-4.1 Nano', provider: 'github', description: 'Smallest & fastest — ideal for simple tasks', maxTokens: 4096, rate: 'Free · 150/day' },
  { id: 'openai/o3-mini', legacyId: ['o3-mini'], name: 'o3-mini', provider: 'github', description: 'Reasoning model — good for math & code', maxTokens: 4096, rate: 'Free · 50/day' },
  { id: 'openai/o4-mini', legacyId: ['o4-mini'], name: 'o4-mini', provider: 'github', description: 'Latest reasoning model', maxTokens: 4096, rate: 'Free · 50/day' },
  // Meta Llama
  { id: 'meta/Llama-3.3-70B-Instruct', legacyId: ['Llama-3.3-70B-Instruct'], name: 'Llama 3.3 70B', provider: 'github', description: 'Latest Llama — improved quality', maxTokens: 4096, rate: 'Free · 150/day' },
  { id: 'meta/Meta-Llama-3.1-405B-Instruct', legacyId: ['Meta-Llama-3.1-405B-Instruct'], name: 'Llama 3.1 405B', provider: 'github', description: 'Largest open-source model', maxTokens: 4096, rate: 'Free · 50/day' },
  // Mistral
  { id: 'mistral-ai/Mistral-large-2411', legacyId: ['Mistral-large-2411'], name: 'Mistral Large', provider: 'github', description: 'Mistral flagship — strong reasoning', maxTokens: 4096, rate: 'Free · 50/day' },
  { id: 'mistral-ai/Mistral-small', legacyId: ['Mistral-small'], name: 'Mistral Small', provider: 'github', description: 'Efficient Mistral model', maxTokens: 4096, rate: 'Free · 150/day' },
  // DeepSeek
  { id: 'deepseek/DeepSeek-R1', legacyId: ['DeepSeek-R1'], name: 'DeepSeek R1', provider: 'github', description: 'Reasoning-focused open model', maxTokens: 4096, rate: 'Free · 50/day' },
  // Microsoft
  { id: 'microsoft/Phi-4', legacyId: ['Phi-4'], name: 'Phi-4', provider: 'github', description: 'Microsoft small language model', maxTokens: 4096, rate: 'Free · 150/day' },
  // Cohere
  { id: 'cohere/Cohere-command-r-plus', legacyId: ['Cohere-command-r-plus'], name: 'Command R+', provider: 'github', description: 'Cohere flagship — RAG optimized', maxTokens: 4096, rate: 'Free · 50/day' },
];

// Map any legacy bare model ID (e.g. "gpt-4o-mini") to its current publisher-
// prefixed form (e.g. "openai/gpt-4o-mini"). Unknown IDs pass through; if the
// ID already contains a "/", it's assumed to be in the new format.
function resolveModelId(id) {
  if (!id) return id;
  if (id.includes('/')) return id;
  for (const m of GITHUB_MODELS) {
    if (m.legacyId && m.legacyId.includes(id)) return m.id;
  }
  return id;
}

function buildHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_MODELS_API_VERSION,
  };
}

class GitHubModelsService {
  constructor() {
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  getAvailableModels() {
    return GITHUB_MODELS;
  }

  /**
   * Chat with a GitHub Models API model.
   * @param {Object} options
   * @param {string} options.message - User message
   * @param {string} options.modelId - Model ID (e.g. 'gpt-4o-mini')
   * @param {string} options.systemPrompt - System prompt
   * @param {number} options.temperature - Temperature (0-1)
   * @param {number} options.maxLength - Max tokens
   * @param {Array} options.conversationHistory - Previous messages
   * @param {Array} [options.tools] - OpenAI function-calling tool schemas
   * @param {string} [options.tool_choice] - Tool choice mode ('auto', 'none', etc.)
   * @returns {Promise<{text: string, generationTime: string, toolCalls: Array|null}>}
   */
  async chat({ message, modelId = 'gpt-4o-mini', systemPrompt = '', temperature = 0.7, maxLength = 500, conversationHistory = [], tools, tool_choice }) {
    if (!this.token) {
      throw new Error('GitHub token not configured. Go to Settings → General → LLM Provider and add your GitHub PAT.');
    }

    const startTime = Date.now();

    // Build messages array
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Add conversation history
    for (const msg of conversationHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    const resolvedModelId = resolveModelId(modelId);
    const body = {
      model: resolvedModelId,
      messages,
      temperature,
      max_tokens: maxLength,
    };

    // Add function-calling tools if provided
    if (tools && tools.length > 0) {
      body.tools = tools;
      if (tool_choice) body.tool_choice = tool_choice;
    }

    console.log(`[GitHub Models] Calling ${resolvedModelId} with ${messages.length} messages${tools ? ` and ${tools.length} tools` : ''}...`);

    const response = await fetch(`${GITHUB_MODELS_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(this.token),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let detail = errText;
      try { detail = JSON.parse(errText)?.error?.message || errText; } catch {}

      console.error(`[GitHub Models] API error ${response.status}: ${detail}`);

      if (response.status === 401) {
        throw new Error(
          'GitHub Models rejected the request (401). Either the PAT is invalid/expired, ' +
          'the account has no Copilot access, or — if you upgraded the addon — please ' +
          'restart it so the new GitHub Models endpoint is picked up. ' +
          'Manage PATs at [github.com/settings/tokens](https://github.com/settings/tokens) (fine-grained PATs need the `models:read` permission).'
        );
      }
      if (response.status === 404) {
        throw new Error(`GitHub Models could not find model "${resolvedModelId}". Pick a different model in Settings.`);
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. GitHub Models has usage limits — wait a moment and try again.');
      }
      throw new Error(`GitHub Models API error (${response.status}): ${detail}`);
    }

    const data = await response.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const choice = data.choices?.[0];
    const text = choice?.message?.content?.trim() || '';
    const toolCalls = choice?.message?.tool_calls || null;

    console.log(`[GitHub Models] ${modelId} responded in ${elapsed}s (${data.usage?.total_tokens || '?'} tokens)${toolCalls ? ` with ${toolCalls.length} tool call(s)` : ''}`);

    return {
      text: text || (toolCalls ? '' : '(no response)'),
      generationTime: `${elapsed}s`,
      toolCalls,
      message: choice?.message, // Full message object for multi-turn tool loops
      usage: data.usage || null, // { prompt_tokens, completion_tokens, total_tokens }
    };
  }

  /**
   * Send a raw messages array (used for tool-call follow-up rounds).
   * @param {Object} options
   * @param {Array} options.messages - Full messages array including tool results
   * @param {string} options.modelId - Model ID
   * @param {number} options.temperature - Temperature
   * @param {number} options.maxLength - Max tokens
   * @param {Array} [options.tools] - Tool schemas
   * @param {string} [options.tool_choice] - Tool choice mode
   * @returns {Promise<{text: string, toolCalls: Array|null, message: Object}>}
   */
  async chatRaw({ messages, modelId = 'gpt-4o-mini', temperature = 0.7, maxLength = 500, tools, tool_choice }) {
    if (!this.token) {
      throw new Error('GitHub token not configured.');
    }

    const body = { model: resolveModelId(modelId), messages, temperature, max_tokens: maxLength };
    if (tools && tools.length > 0) {
      body.tools = tools;
      if (tool_choice) body.tool_choice = tool_choice;
    }

    const response = await fetch(`${GITHUB_MODELS_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(this.token),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`GitHub Models API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content?.trim() || '',
      toolCalls: choice?.message?.tool_calls || null,
      message: choice?.message,
      usage: data.usage || null,
    };
  }

  /**
   * Chat with image (vision). Sends a base64-encoded image to the model.
   * @param {Object} options
   * @param {string} options.prompt - Text prompt
   * @param {string} options.imageBase64 - Base64-encoded image (JPEG/PNG)
   * @param {string} options.mimeType - Image MIME type e.g. 'image/jpeg'
   * @param {string} options.modelId - Model ID (must support vision: gpt-4o-mini, gpt-4o)
   * @param {number} options.temperature - Temperature
   * @param {number} options.maxLength - Max tokens
   * @returns {Promise<{text: string, generationTime: string}>}
   */
  async chatWithImage({ prompt, imageBase64, mimeType = 'image/jpeg', modelId = 'gpt-4o-mini', temperature = 0.1, maxLength = 300 }) {
    if (!this.token) {
      throw new Error('GitHub token not configured.');
    }

    const startTime = Date.now();

    const resolvedModelId = resolveModelId(modelId);
    const body = {
      model: resolvedModelId,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      temperature,
      max_tokens: maxLength,
    };

    console.log(`[GitHub Models Vision] Calling ${resolvedModelId} with image...`);

    const response = await fetch(`${GITHUB_MODELS_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(this.token),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`GitHub Models Vision API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const text = data.choices?.[0]?.message?.content?.trim() || '(no response)';

    console.log(`[GitHub Models Vision] ${modelId} responded in ${elapsed}s`);

    return { text, generationTime: `${elapsed}s` };
  }
}

module.exports = { GitHubModelsService, GITHUB_MODELS };
