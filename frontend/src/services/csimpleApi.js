/**
 * CSimple API Service Layer
 * 
 * Abstracts communication with the local CSimple addon (Express server)
 * and optionally the portfolio backend for cloud features.
 * 
 * Architecture:
 *   - Local addon runs at localhost:3001 (HTTP) / localhost:3444 (HTTPS)
 *   - Portfolio backend runs at the deployed backend URL
 *   - This service detects addon presence and routes requests accordingly
 */

const ADDON_DEFAULT_PORT = 3001;
const ADDON_HEALTH_ENDPOINT = '/api/status';
const ADDON_POLL_INTERVAL = 30000; // 30s between health checks

/** Cached addon state */
let _addonStatus = {
  isConnected: false,
  baseUrl: null,
  lastCheck: 0,
  version: null,
};

/** All registered listeners for addon status changes */
const _statusListeners = new Set();

/**
 * Detect if the CSimple local addon is running.
 * Tries localhost ports and returns the base URL if found.
 */
export async function detectAddon() {
  const ports = [ADDON_DEFAULT_PORT, 3444];
  const protocols = ['http', 'https'];

  for (const proto of protocols) {
    for (const port of ports) {
      const url = `${proto}://localhost:${port}`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const res = await fetch(`${url}${ADDON_HEALTH_ENDPOINT}`, {
          signal: controller.signal,
          mode: 'cors',
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const newStatus = {
            isConnected: true,
            baseUrl: url,
            lastCheck: Date.now(),
            version: data.version || null,
            uptime: data.uptime || null,
          };
          _addonStatus = newStatus;
          _notifyListeners(newStatus);
          return newStatus;
        }
      } catch {
        // Port not available, try next
      }
    }
  }

  const newStatus = {
    isConnected: false,
    baseUrl: null,
    lastCheck: Date.now(),
    version: null,
  };
  _addonStatus = newStatus;
  _notifyListeners(newStatus);
  return newStatus;
}

/**
 * Get the current cached addon status (synchronous).
 */
export function getAddonStatus() {
  return { ..._addonStatus };
}

/**
 * Subscribe to addon status changes.
 * @param {function} listener - Called with status object on change
 * @returns {function} Unsubscribe function
 */
export function onAddonStatusChange(listener) {
  _statusListeners.add(listener);
  return () => _statusListeners.delete(listener);
}

function _notifyListeners(status) {
  _statusListeners.forEach(fn => {
    try { fn(status); } catch (e) { console.error('[CSimpleAPI] Listener error:', e); }
  });
}

/**
 * Start periodic addon health checks.
 * @returns {function} Stop function
 */
export function startAddonPolling(interval = ADDON_POLL_INTERVAL) {
  // Initial check
  detectAddon();

  const id = setInterval(() => detectAddon(), interval);
  return () => clearInterval(id);
}

// ─── Local Addon API Methods ────────────────────────────────────────────────

/**
 * Make a request to the local addon.
 * @throws {Error} if addon is not connected
 */
async function addonFetch(path, options = {}) {
  if (!_addonStatus.isConnected || !_addonStatus.baseUrl) {
    throw new Error('CSimple addon is not connected');
  }

  const url = `${_addonStatus.baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Addon API error ${res.status}: ${text}`);
  }

  return res;
}

/**
 * Get available models from the local addon.
 */
export async function getLocalModels() {
  const res = await addonFetch('/api/models');
  return res.json();
}

/**
 * Send a chat message to the local addon.
 * @param {object} params - { message, model, conversationHistory, settings, agent }
 * @returns {Promise<object>} - { response, action, confirmation }
 */
export async function sendChatMessage({ message, model, conversationHistory = [], settings = {}, agent = null }) {
  const res = await addonFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      model,
      conversationHistory,
      temperature: settings.defaultTemperature ?? 0.7,
      maxTokens: settings.defaultMaxTokens ?? 500,
      behaviorFile: agent?.behaviorFile || 'default.txt',
    }),
  });
  return res.json();
}

/**
 * Send a chat message with SSE streaming.
 * @param {object} params - Chat parameters
 * @param {function} onToken - Called with each token
 * @param {AbortSignal} signal - Optional abort signal
 */
export async function streamChatMessage({ message, model, conversationHistory = [], settings = {}, agent = null }, onToken, signal) {
  if (!_addonStatus.isConnected || !_addonStatus.baseUrl) {
    throw new Error('CSimple addon is not connected');
  }

  const res = await fetch(`${_addonStatus.baseUrl}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      model,
      conversationHistory,
      temperature: settings.defaultTemperature ?? 0.7,
      maxTokens: settings.defaultMaxTokens ?? 500,
      behaviorFile: agent?.behaviorFile || 'default.txt',
    }),
    signal,
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.token) onToken(parsed.token);
          if (parsed.done) return;
        } catch {
          // Non-JSON data line
        }
      }
    }
  }
}

/**
 * Stop the current generation.
 */
export async function stopGeneration() {
  await addonFetch('/api/chat/stop', { method: 'POST' });
}

/**
 * Confirm a pending action.
 */
export async function confirmAction(actionId, choice) {
  const res = await addonFetch('/api/chat/confirm', {
    method: 'POST',
    body: JSON.stringify({ actionId, choice }),
  });
  return res.json();
}

/**
 * Get addon settings from the local settings file.
 */
export async function getAddonSettings() {
  const res = await addonFetch('/api/settings');
  return res.json();
}

/**
 * Save settings to the local addon.
 */
export async function saveAddonSettings(settings) {
  const res = await addonFetch('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
  return res.json();
}

/**
 * Get network information from the local addon.
 */
export async function getNetworkInfo() {
  const res = await addonFetch('/api/network');
  return res.json();
}

/**
 * List behavior files from the local addon.
 */
export async function getBehaviors() {
  const res = await addonFetch('/api/behaviors');
  return res.json();
}

/**
 * Read a behavior file.
 */
export async function getBehaviorContent(filename) {
  const res = await addonFetch(`/api/behaviors/${encodeURIComponent(filename)}`);
  return res.text();
}

/**
 * Get action bridge status.
 */
export async function getActionBridgeStatus() {
  const res = await addonFetch('/api/actions/bridge-status');
  return res.json();
}

// ─── Portfolio Backend API Methods ──────────────────────────────────────────

/**
 * Send a chat via the portfolio backend (cloud LLM).
 * Uses the existing Redux data slice's compressData thunk pattern.
 * This is called from the Redux layer, not directly.
 */
export function getPortfolioApiUrl() {
  // In development, proxy handles this. In production, use the deployed URL.
  return '/api/data';
}

/**
 * Get LLM providers from the portfolio backend.
 */
export async function getPortfolioLLMProviders(token) {
  const res = await fetch(`${getPortfolioApiUrl()}/llm-providers`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to fetch LLM providers');
  return res.json();
}
