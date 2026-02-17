/**
 * GitHub Models API Service
 *
 * Uses the GitHub Models inference endpoint (OpenAI-compatible) to access
 * models like GPT-4o-mini, GPT-4o, etc. using a GitHub PAT.
 *
 * Endpoint: https://models.inference.ai.azure.com
 * Auth: Bearer token (GitHub PAT with "models" scope, or Copilot subscription)
 */

const GITHUB_MODELS_ENDPOINT = 'https://models.inference.ai.azure.com';

// Models available through GitHub Models API
const GITHUB_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'github', description: 'Fast & cheap — great for most tasks', maxTokens: 4096 },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'github', description: 'Most capable — best for complex reasoning', maxTokens: 4096 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'github', description: 'Latest mini model — balanced performance', maxTokens: 4096 },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'github', description: 'Smallest & fastest — ideal for simple tasks', maxTokens: 4096 },
];

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
   * @returns {Promise<{text: string, generationTime: string}>}
   */
  async chat({ message, modelId = 'gpt-4o-mini', systemPrompt = '', temperature = 0.7, maxLength = 500, conversationHistory = [] }) {
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

    const body = {
      model: modelId,
      messages,
      temperature,
      max_tokens: maxLength,
    };

    console.log(`[GitHub Models] Calling ${modelId} with ${messages.length} messages...`);

    const response = await fetch(`${GITHUB_MODELS_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let detail = errText;
      try { detail = JSON.parse(errText)?.error?.message || errText; } catch {}

      console.error(`[GitHub Models] API error ${response.status}: ${detail}`);

      if (response.status === 401) {
        throw new Error(
          'GitHub Models returned 401 (Unauthorized). Your PAT needs access to GitHub Models. ' +
          'Create a classic PAT at github.com/settings/tokens with no special scopes — ' +
          'GitHub Models access comes from your Copilot subscription, not PAT scopes.'
        );
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. GitHub Models has usage limits — wait a moment and try again.');
      }
      throw new Error(`GitHub Models API error (${response.status}): ${detail}`);
    }

    const data = await response.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const text = data.choices?.[0]?.message?.content?.trim() || '(no response)';

    console.log(`[GitHub Models] ${modelId} responded in ${elapsed}s (${data.usage?.total_tokens || '?'} tokens)`);

    return {
      text,
      generationTime: `${elapsed}s`,
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

    const body = {
      model: modelId,
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

    console.log(`[GitHub Models Vision] Calling ${modelId} with image...`);

    const response = await fetch(`${GITHUB_MODELS_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
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
