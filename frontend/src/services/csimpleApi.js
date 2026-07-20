/**
 * CSimple API Service Layer
 * 
 * Abstracts communication with the local CSimple addon (Express server)
 * and optionally the portfolio backend for cloud features.
 * 
 * Architecture:
 *   - Local addon runs at localhost:3001 (HTTP) / localhost:3444 (HTTPS)
 *   - Remote addon can be reached via LAN IP (e.g. 192.168.1.13:3001)
 *   - Cloud relay: phone → backend → desktop addon (when no local addon detected)
 *   - Portfolio backend runs at the deployed backend URL
 *   - This service detects addon presence and routes requests accordingly
 */

const ADDON_DEFAULT_PORT = 3001;
const ADDON_HEALTH_ENDPOINT = '/api/status';
const ADDON_POLL_INTERVAL = 30000; // 30s between health checks
// The addon auto-increments its port if the default is already taken
// (e.g. a leftover process from a previous version still holding 3001
// during an update). Probe a small range of fallback ports so detection
// doesn't silently fail just because the addon landed on 3002+.
const ADDON_PORT_FALLBACK_RANGE = 4;
const CUSTOM_HOST_KEY = 'csimple_addon_host'; // localStorage key
const OPT_IN_KEY = 'csimple_addon_optin'; // localStorage key

/** Cached addon state */
let _addonStatus = {
  isConnected: false,
  baseUrl: null,
  lastCheck: 0,
  version: null,
};

/** All registered listeners for addon status changes */
const _statusListeners = new Set();

// ─── Custom Addon Host (for phone → PC control over LAN) ───────────────────

/**
 * Auto-apply ?addon= URL parameter if present.
 * e.g. https://sthopwood.com/net?addon=192.168.1.13:3001
 */
(function _initFromUrlParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    const addonParam = params.get('addon');
    if (addonParam) {
      // Normalize: strip protocol if user included it, store just host:port
      const cleaned = addonParam.replace(/^https?:\/\//, '');
      localStorage.setItem(CUSTOM_HOST_KEY, cleaned);
      // Arriving via the QR's ?addon= param is an explicit user choice to
      // control a PC from this device, so we treat it as an opt-in to addon
      // detection on this HTTPS origin. Without this, the page would sit on
      // the "Enable local addon?" CTA and chats would silently fall back to
      // the tool-less cloud LLM (which then hallucinates "I can't open apps").
      localStorage.setItem(OPT_IN_KEY, '1');
    }
  } catch { /* SSR or no window */ }
})();

/**
 * Get the saved custom addon host (e.g. "192.168.1.13:3001").
 * Returns null if not set.
 */
export function getCustomAddonHost() {
  try {
    return localStorage.getItem(CUSTOM_HOST_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Whether the user has opted in to local addon detection on the current
 * (HTTPS) origin. On insecure origins (e.g. http://localhost:3000) detection
 * is always enabled; on HTTPS origins it must be explicitly enabled because
 * contacting the addon's self-signed cert downgrades the page's lock icon.
 */
export function isAddonOptedIn() {
  try { return localStorage.getItem(OPT_IN_KEY) === '1'; } catch { return false; }
}

export function setAddonOptIn(value) {
  try {
    if (value) localStorage.setItem(OPT_IN_KEY, '1');
    else localStorage.removeItem(OPT_IN_KEY);
  } catch { /* ignore */ }
  // Re-detect immediately so UI reflects the change
  detectAddon();
}

/**
 * Set a custom addon host for LAN access (e.g. "192.168.1.13:3001").
 * Pass null/empty to clear and revert to localhost detection.
 */
export function setCustomAddonHost(host) {
  try {
    if (host) {
      const cleaned = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      localStorage.setItem(CUSTOM_HOST_KEY, cleaned);
    } else {
      localStorage.removeItem(CUSTOM_HOST_KEY);
    }
    // Re-detect immediately with the new host
    detectAddon();
  } catch { /* ignore */ }
}

/**
 * Detect if the CSimple local addon is running.
 * Tries custom host first (if set), then localhost ports.
 *
 * NOTE on HTTPS pages (e.g. https://sthopwood.com): browsers block plain
 * HTTP requests to localhost as mixed content. We therefore only attempt
 * the HTTPS variant (port 3444) from secure origins. The addon ships a
 * self-signed cert, so users must visit https://localhost:3444/api/status
 * once and click "Advanced → Proceed" before the browser will trust it.
 */
export async function detectAddon() {
  const pageIsSecure = typeof window !== 'undefined'
    && window.location?.protocol === 'https:';

  // On HTTPS pages, gate detection behind explicit user opt-in. Contacting
  // the addon's self-signed cert downgrades the page's lock icon to "Not
  // Secure" for the rest of the tab session, so we don't probe by default.
  if (pageIsSecure && !isAddonOptedIn()) {
    const newStatus = {
      isConnected: false,
      baseUrl: null,
      lastCheck: Date.now(),
      version: null,
      needsOptIn: true,
    };
    _addonStatus = newStatus;
    _notifyListeners(newStatus);
    return newStatus;
  }

  // Build candidate URLs — custom host first, then localhost fallbacks
  const candidates = [];

  const customHost = getCustomAddonHost();
  if (customHost) {
    // On HTTPS pages, only HTTPS to the custom host can succeed.
    if (pageIsSecure) {
      candidates.push(`https://${customHost}`);
    } else {
      candidates.push(`https://${customHost}`, `http://${customHost}`);
    }
  }

  // Always try localhost as fallback — the primary ports first, then the
  // range the addon falls back to if 3001/3444 were already taken.
  // Also probe the literal 127.0.0.1 IP: the addon binds to that exact
  // IPv4 address, but "localhost" can resolve to ::1 (IPv6) first on some
  // systems, which fails to connect even though the addon is listening
  // fine on IPv4. The addon's self-signed cert includes IP:127.0.0.1 as a
  // SAN, so HTTPS to the literal IP is trusted the same as to "localhost".
  const httpPorts = [ADDON_DEFAULT_PORT];
  const httpsPorts = [3444];
  for (let i = 1; i <= ADDON_PORT_FALLBACK_RANGE; i++) {
    httpPorts.push(ADDON_DEFAULT_PORT + i);
    httpsPorts.push(3444 + i);
  }
  const protocols = pageIsSecure ? ['https'] : ['http', 'https'];
  const hosts = ['localhost', '127.0.0.1'];
  for (const proto of protocols) {
    const ports = proto === 'https' ? httpsPorts : httpPorts;
    for (const port of ports) {
      for (const host of hosts) {
        candidates.push(`${proto}://${host}:${port}`);
      }
    }
  }

  // Try each candidate in order (primary port first, then the fallback
  // range) with a short per-request timeout.
  for (const url of candidates) {
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

  const newStatus = {
    isConnected: false,
    baseUrl: null,
    lastCheck: Date.now(),
    version: null,
    // When detection fails from an HTTPS origin, the most common cause is
    // the user not having accepted the addon's self-signed cert yet.
    // The UI can use this hint to surface a one-time "trust the cert" CTA.
    needsCertTrust: pageIsSecure,
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
// Automation routes that require the addon's automation layer to be mounted.
const AUTOMATION_ROUTE_PREFIXES = [
  '/api/agent/', '/api/automation/', '/api/skill/', '/api/recorder/',
  '/api/voice/', '/api/perception/', '/api/triggers',
];
let _remountInProgress = false;

/** Extract a clean human-readable message from an error response (may be HTML or JSON). */
function _parseErrorBody(text, status) {
  if (!text) return `Addon error (${status})`;
  // HTML 404 from Express "Cannot POST /path"
  const htmlMatch = text.match(/<pre>(Cannot [A-Z]+ [^<]+)<\/pre>/);
  if (htmlMatch) return htmlMatch[1];
  // JSON with known fields
  try {
    const j = JSON.parse(text);
    if (j.dataMessage) return j.dataMessage;
    if (j.error) return typeof j.error === 'string' ? j.error : j.error.message || text;
    if (j.message) return j.message;
  } catch {}
  return text.length > 200 ? `Addon error (${status})` : text;
}

function _isAddonNetworkError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('failed to fetch')
    || msg.includes('networkerror')
    || msg.includes('load failed')
    || msg.includes('network request failed');
}

function _formatAddonUnavailableMessage(baseUrl) {
  const where = baseUrl || 'the local addon endpoint';
  return `Could not reach the CSimple addon at ${where}. It is likely not running or was restarted during the request.\n\nStart/relaunch "CSimple Addon" and try again.`;
}

async function addonFetch(path, options = {}) {
  if (!_addonStatus.isConnected || !_addonStatus.baseUrl) {
    throw new Error('CSimple addon is not connected');
  }

  const doFetch = async () => {
    const url = `${_addonStatus.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(_parseErrorBody(text, res.status));
    }
    return res;
  };

  try {
    return await doFetch();
  } catch (e) {
    if (_isAddonNetworkError(e)) {
      _addonStatus = {
        ..._addonStatus,
        isConnected: false,
        lastCheck: Date.now(),
      };
      _notifyListeners(_addonStatus);
      throw new Error(_formatAddonUnavailableMessage(_addonStatus.baseUrl));
    }
    const msg = e.message || '';
    const isAutomationRoute = AUTOMATION_ROUTE_PREFIXES.some(p => path.startsWith(p));
    const isRouteNotFound = msg.startsWith('Cannot POST') || msg.startsWith('Cannot GET') || msg.startsWith('Cannot DELETE');

    if (isAutomationRoute && isRouteNotFound && !_remountInProgress) {
      // The automation layer is not mounted on the running addon server.
      // Step 1: Check /api/status to get the exact mount error
      let mountError = null;
      try {
        const statusRes = await fetch(`${_addonStatus.baseUrl}/api/status`);
        if (statusRes.ok) {
          const statusJson = await statusRes.json();
          if (statusJson.automationError) mountError = statusJson.automationError;
        }
      } catch {}

      // Step 2: Try /api/admin/remount (exists in updated addon builds)
      _remountInProgress = true;
      let remounted = false;
      try {
        const r = await fetch(`${_addonStatus.baseUrl}/api/admin/remount`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        });
        remounted = r.ok;
      } catch {}
      _remountInProgress = false;

      if (remounted) {
        try { return await doFetch(); } catch {}
      }

      // Remount failed or still 404 — show actionable message with actual error if known
      const detail = mountError ? `\n\nError: ${mountError}` : '';
      throw new Error(
        `Automation features are not active.${detail}\n\nRight-click the CSimple tray icon → Quit, then relaunch the app.`
      );
    }
    throw e;
  }
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
      modelId: model,
      conversationHistory,
      temperature: settings.defaultTemperature ?? 0.7,
      maxLength: settings.defaultMaxTokens ?? 500,
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
      modelId: model,
      conversationHistory,
      temperature: settings.defaultTemperature ?? 0.7,
      maxLength: settings.defaultMaxTokens ?? 500,
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
export async function confirmAction(confirmationId, selectedOption) {
  const res = await addonFetch('/api/chat/confirm', {
    method: 'POST',
    body: JSON.stringify({ confirmationId, selectedOption }),
  });
  return res.json();
}

/**
 * Get addon settings from the local settings file.
 */
export async function getAddonSettings() {
  const res = await addonFetch('/api/settings');
  const data = await res.json();
  return scrubEncryptedSecrets(data);
}

/**
 * Save settings to the local addon.
 */
export async function saveAddonSettings(settings) {
  // Refuse to ever write ciphertext into the addon's local store — it would
  // be sent as a Bearer token to GitHub and produce a misleading 401.
  const safe = scrubEncryptedSecrets(settings);
  const res = await addonFetch('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(safe),
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
 * Create a behavior file on the local addon.
 */
export async function createBehavior(filename, content) {
  const res = await addonFetch('/api/behaviors', {
    method: 'POST',
    body: JSON.stringify({ filename, content }),
  });
  return res.json();
}

/**
 * Update a behavior file on the local addon.
 */
export async function updateBehavior(filename, content) {
  const res = await addonFetch(`/api/behaviors/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
  return res.json();
}

/**
 * Delete a behavior file on the local addon.
 */
export async function deleteBehavior(filename) {
  const res = await addonFetch(`/api/behaviors/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
  return res.json();
}

/**
 * List memory files from the local addon.
 */
export async function getMemoryFiles() {
  const res = await addonFetch('/api/memory');
  return res.json();
}

/**
 * Read a memory file.
 */
export async function getMemoryContent(filename) {
  const res = await addonFetch(`/api/memory/${encodeURIComponent(filename)}`);
  return res.json();
}

/**
 * Create a memory file on the local addon.
 */
export async function createMemory(filename, content) {
  const res = await addonFetch('/api/memory', {
    method: 'POST',
    body: JSON.stringify({ filename, content }),
  });
  return res.json();
}

/**
 * Update a memory file on the local addon.
 */
export async function updateMemory(filename, content) {
  const res = await addonFetch(`/api/memory/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
  return res.json();
}

/**
 * Delete a memory file on the local addon.
 */
export async function deleteMemory(filename) {
  const res = await addonFetch(`/api/memory/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
  return res.json();
}

/**
 * List personality files from the local addon.
 */
export async function getPersonalityFiles() {
  const res = await addonFetch('/api/personality');
  return res.json();
}

/**
 * Read a personality file.
 */
export async function getPersonalityContent(filename) {
  const res = await addonFetch(`/api/personality/${encodeURIComponent(filename)}`);
  return res.json();
}

/**
 * Update a personality file on the local addon.
 */
export async function updatePersonality(filename, content) {
  const res = await addonFetch(`/api/personality/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
  return res.json();
}

/**
 * List workspace files from the local addon.
 */
export async function getWorkspaceFiles(type = 'files') {
  const res = await addonFetch(`/api/workspace/files?type=${type}`);
  return res.json();
}

/**
 * Read a workspace file.
 */
export async function getWorkspaceFile(filename, type = 'files') {
  const res = await addonFetch(`/api/workspace/files/${encodeURIComponent(filename)}?type=${type}`);
  return res.json();
}

/**
 * Create a workspace file.
 */
export async function createWorkspaceFile(filename, content, type = 'files') {
  const res = await addonFetch('/api/workspace/files', {
    method: 'POST',
    body: JSON.stringify({ filename, content, type }),
  });
  return res.json();
}

/**
 * Execute a script in the workspace.
 */
export async function executeWorkspaceScript(filename, args = []) {
  const res = await addonFetch('/api/workspace/execute', {
    method: 'POST',
    body: JSON.stringify({ filename, args }),
  });
  return res.json();
}

/**
 * Open a workspace file in the OS default viewer.
 */
export async function openFile(filePath) {
  const res = await addonFetch('/api/open-file', {
    method: 'POST',
    body: JSON.stringify({ path: filePath }),
  });
  return res.json();
}

/**
 * Get the addon base URL for building preview links.
 * Returns null if addon is not connected.
 */
export function getAddonBaseUrl() {
  return _addonStatus.isConnected ? _addonStatus.baseUrl : null;
}

// ─── Automation agent control (local addon) ─────────────────────────────────

/** Current agent loop status: { running, currentGoal, step, ... }. */
export async function getAgentStatus() {
  const res = await addonFetch('/api/agent/status');
  return res.json();
}

/** Start the autonomous agent loop. Optional { goalSlug, modelId, maxSteps }. */
export async function startAgent(opts = {}) {
  const res = await addonFetch('/api/agent/start', {
    method: 'POST',
    body: JSON.stringify(opts || {}),
  });
  return res.json();
}

/** Stop the agent loop. */
export async function stopAgent(reason = 'user requested stop') {
  const res = await addonFetch('/api/agent/stop', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return res.json();
}

/** Pending tool approvals awaiting user decision. */
export async function getPendingApprovals() {
  const res = await addonFetch('/api/automation/pending-approvals');
  return res.json();
}

/** Approve or deny a pending tool call by id. */
export async function resolveApproval(id, approved, reason = '') {
  const res = await addonFetch('/api/automation/approve', {
    method: 'POST',
    body: JSON.stringify({ id, approved, reason }),
  });
  return res.json();
}

/** Activate the global kill switch (stops all tools + the agent). */
export async function activateKillSwitch() {
  const res = await addonFetch('/api/automation/permissions/kill', { method: 'POST' });
  return res.json();
}

/**
 * Turn the global kill switch back off. The kill switch persists to disk
 * across addon restarts, so once activated it blocks every automation tool
 * call ("Denied by permission policy") until explicitly cleared here.
 */
export async function deactivateKillSwitch() {
  const res = await addonFetch('/api/automation/permissions', {
    method: 'PUT',
    body: JSON.stringify({ globalKillSwitch: false }),
  });
  return res.json();
}

/** Read the addon automation permission config. */
export async function getAutomationPermissions() {
  const res = await addonFetch('/api/automation/permissions');
  return res.json();
}

/**
 * Toggle unattended auto-approval. When enabled, tool calls that would normally
 * prompt ('ask' mode) run without a popup. Hard stops (deny, kill switch, shell
 * deny-list) are unaffected.
 */
export async function setAutoApproveAll(enabled) {
  const res = await addonFetch('/api/automation/permissions', {
    method: 'PUT',
    body: JSON.stringify({ autoApproveAll: !!enabled }),
  });
  return res.json();
}

/**
 * Capture + upload a live screenshot thumbnail via the addon, which publishes a
 * `screen.frame` SSE event with the resulting URL.
 */
export async function relayScreenFrame(opts = {}) {
  const res = await addonFetch('/api/automation/execute', {
    method: 'POST',
    body: JSON.stringify({ name: 'screen_relay', args: opts || {} }),
  });
  return res.json();
}

// ─── Macros / recorded skills (local addon) ─────────────────────────────────
// The addon records raw input demonstrations, compiles them into parameterised
// "skills" (a.k.a. macros), and can run or hotkey-bind them. Persistence of the
// macro itself lives in the cloud workspace (kind='skill'); these helpers cover
// the local, foreground record → compile → run pipeline plus hotkey sync.

/** Begin recording a demonstration. Requires a connected local addon. */
export async function startRecording(name) {
  const res = await addonFetch('/api/recorder/start', {
    method: 'POST',
    body: JSON.stringify({ name: name || 'macro' }),
  });
  return res.json();
}

/** Stop the active recording. Returns { sessionId, eventCount, durationMs }. */
export async function stopRecording() {
  const res = await addonFetch('/api/recorder/stop', { method: 'POST' });
  return res.json();
}

/** Current recorder status: { active, eventCount, startedAt, sessionId }. */
export async function getRecorderStatus() {
  const res = await addonFetch('/api/recorder/status');
  return res.json();
}

/** Insert a user annotation marker into the active recording. */
export async function appendRecorderMarker(label) {
  const res = await addonFetch('/api/recorder/marker', {
    method: 'POST',
    body: JSON.stringify({ label: label || '' }),
  });
  return res.json();
}

/** List previously saved raw recordings (not yet compiled). */
export async function listRecordings() {
  const res = await addonFetch('/api/recorder/list');
  return res.json();
}

/** Delete a raw recording by sessionId. */
export async function deleteRecording(sessionId) {
  const res = await addonFetch(`/api/recorder/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  return res.json();
}

/**
 * Compile a raw recording into a skill object (does NOT persist).
 * @param {{ sessionId: string, name?: string, description?: string }} opts
 * @returns {Promise<{ skill: object }>}
 */
export async function compileSkill({ sessionId, name, description } = {}) {
  const res = await addonFetch('/api/skill/compile', {
    method: 'POST',
    body: JSON.stringify({ sessionId, name, description }),
  });
  return res.json();
}

/**
 * Save a compiled skill: caches locally in the addon and persists to the cloud
 * workspace (kind='skill'). The macro object should include any `hotkey`.
 */
export async function saveSkill(skill) {
  const res = await addonFetch('/api/skill/save', {
    method: 'POST',
    body: JSON.stringify({ skill }),
  });
  return res.json();
}

/**
 * Run a saved macro by slug through the local addon (permission-gated).
 *
 * @param {string} slug
 * @param {object} [params] key/value substitutions for ${param.x} placeholders
 * @param {object} [inlineSkill] optional full skill object to seed the addon's
 *   in-memory cache before lookup. Recommended when the caller already has the
 *   compiled skill loaded — it avoids a workspace round-trip and works even
 *   when the addon just restarted (empty cache) or has no cloud auth token yet.
 */
export async function runSkill(slug, params = {}, inlineSkill = null) {
  const body = { slug, params: params || {} };
  if (inlineSkill && inlineSkill.slug === slug) body.skill = inlineSkill;
  const res = await addonFetch('/api/skill/run', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * Push the full macro→hotkey binding map to the local addon, which registers
 * them as global OS keyboard shortcuts and persists them across restarts.
 * @param {Array<{ slug: string, accelerator: string }>} hotkeys
 * @returns {Promise<{ ok: boolean, registered: Array, skipped: Array }>}
 */
export async function syncSkillHotkeys(hotkeys) {
  const res = await addonFetch('/api/skill/hotkeys', {
    method: 'POST',
    body: JSON.stringify({ hotkeys: hotkeys || [] }),
  });
  return res.json();
}

/** Read the macro hotkeys currently registered by the local addon. */
export async function getSkillHotkeys() {
  const res = await addonFetch('/api/skill/hotkeys');
  return res.json();
}

// ─── Natural Language Macro Compiler ─────────────────────────────────────────

/**
 * Force-remount the automation layer on the addon server.
 * Called automatically when automation endpoints return 404 — this fixes the
 * "Duplicate tool" crash that happens after tray "Restart Server" without a
 * full process restart.
 */
export async function remountAutomation() {
  const res = await addonFetch('/api/admin/remount', { method: 'POST' });
  return res.json();
}

/**
 * Compile an English macro description into structured skill steps via the
 * addon's NL compiler (LLM-backed). Results are cached by description hash.
 *
 * @param {string} description - e.g. "mine stone in minecraft until I press escape"
 * @param {object} [opts]
 *   @param {string} [opts.context]  - optional env context (e.g. foreground window title)
 *   @param {boolean} [opts.noCache] - skip cache and always re-compile
 * @returns {Promise<{ steps: Array, meta: object }>}
 */
export async function compileNaturalMacro(description, { context, noCache, githubToken } = {}) {
  const res = await addonFetch('/api/skill/compile-natural', {
    method: 'POST',
    body: JSON.stringify({ description, context, noCache: !!noCache, githubToken }),
  });
  return res.json();
}

/**
 * Modify an EXISTING macro's steps via an English instruction, e.g.
 * "press z after the shift click", through the addon's NL editor.
 *
 * @param {Array} steps - current step array (either schema)
 * @param {string} instruction - description of the desired change
 * @param {object} [opts]
 *   @param {string} [opts.context]
 *   @param {string} [opts.githubToken]
 * @returns {Promise<{ ok: boolean, steps: Array, meta: object }>}
 */
export async function editMacroNatural(steps, instruction, { context, githubToken } = {}) {
  const res = await addonFetch('/api/skill/edit-natural', {
    method: 'POST',
    body: JSON.stringify({ steps, instruction, context, githubToken }),
  });
  return res.json();
}

// ─── Voice / Audio Pipeline ───────────────────────────────────────────────────

/** Voice pipeline status: { running, listening, wakewordLoop, model, device, lastLevel }. */
export async function getVoiceStatus() {
  const res = await addonFetch('/api/voice/status');
  return res.json();
}

/**
 * Record from the microphone until silence, then return the transcript.
 * @param {{ maxSeconds?: number, silenceMs?: number }} opts
 * @returns {Promise<{ text: string, confidence: number, language: string, wakeword_detected: boolean }>}
 */
export async function voiceListen({ maxSeconds = 10, silenceMs = 800 } = {}) {
  const res = await addonFetch('/api/voice/listen', {
    method: 'POST',
    body: JSON.stringify({ maxSeconds, silenceMs }),
  });
  return res.json();
}

/** Stop any active microphone capture. */
export async function voiceStopListening() {
  const res = await addonFetch('/api/voice/stop', { method: 'POST' });
  return res.json();
}

/**
 * Speak text aloud via TTS on the local machine.
 * @param {string} text
 * @param {{ rate?: number, volume?: number }} opts
 */
export async function voiceSpeak(text, { rate = 175, volume = 1.0 } = {}) {
  const res = await addonFetch('/api/voice/speak', {
    method: 'POST',
    body: JSON.stringify({ text, rate, volume }),
  });
  return res.json();
}

/** List available microphone devices. */
export async function voiceListDevices() {
  const res = await addonFetch('/api/voice/devices');
  return res.json();
}

/** Start the continuous wakeword detection loop ("hey csimple"). */
export async function startWakewordLoop() {
  const res = await addonFetch('/api/voice/wakeword/start', { method: 'POST' });
  return res.json();
}

/** Stop the wakeword detection loop. */
export async function stopWakewordLoop() {
  const res = await addonFetch('/api/voice/wakeword/stop', { method: 'POST' });
  return res.json();
}

// ─── Perception Bus ───────────────────────────────────────────────────────────

/** Perception bus status: { running, hasScreen, hasAudio, hasGaze, hasWindow, ... }. */
export async function getPerceptionStatus() {
  const res = await addonFetch('/api/perception/status');
  return res.json();
}

/**
 * Latest perception frame (without raw image data).
 * @returns {Promise<{ frame: object|null, context: string }>}
 */
export async function getPerceptionFrame() {
  const res = await addonFetch('/api/perception/frame');
  return res.json();
}

// ─── Behavioral Predictor ─────────────────────────────────────────────────────

/**
 * Current behavioral predictions: what the agent is likely to do next.
 * @returns {Promise<{ predictions: Array, stats: object }>}
 */
export async function getAgentPredictions() {
  const res = await addonFetch('/api/agent/predictions');
  return res.json();
}

/**
 * Fetch proactive automation suggestions based on usage patterns.
 * @param {{ force?: boolean }} opts
 */
export async function getAutomationSuggestions({ force = false } = {}) {
  const res = await addonFetch(`/api/agent/suggestions${force ? '?force=true' : ''}`);
  return res.json();
}

/**
 * Create a goal from the current clipboard contents.
 * The addon reads the clipboard on its end (loopback call).
 */
export async function createGoalFromClipboard() {
  const res = await addonFetch('/api/agent/goal-from-clipboard', { method: 'POST' });
  return res.json();
}



/**
 * Build the SSE URL for the agent live event stream. Returns null when the
 * addon is not connected. Pass `types` to filter (comma-joined) and `sinceSeq`
 * to replay buffered events.
 *
 * NOTE: EventSource cannot send headers, but these endpoints are loopback-only
 * and unauthenticated by design (the addon binds to 127.0.0.1).
 */
export function getAgentEventsUrl({ types = null, sinceSeq = 0 } = {}) {
  if (!_addonStatus.isConnected || !_addonStatus.baseUrl) return null;
  const params = new URLSearchParams();
  if (types) params.set('types', Array.isArray(types) ? types.join(',') : String(types));
  if (sinceSeq) params.set('sinceSeq', String(sinceSeq));
  const qs = params.toString();
  return `${_addonStatus.baseUrl}/api/agent/events${qs ? `?${qs}` : ''}`;
}


/**
 * Get action bridge status.
 */
export async function getActionBridgeStatus() {
  const res = await addonFetch('/api/actions/bridge-status');
  return res.json();
}

/**
 * Run a diagnostic test against the local addon.
 * Checks: health, settings read, bridge connection, models list.
 * Returns { passed, checks: [{ name, ok, detail }] }
 */
export async function testAddonConnection() {
  const checks = [];

  // 1. Health / status
  try {
    const res = await addonFetch('/api/status');
    const data = await res.json();
    checks.push({ name: 'Server', ok: true, detail: `Up ${Math.round(data.uptime || 0)}s v${data.version || '?'}` });
    // Surface automation mount status — if false, the user needs to restart the addon
    if (data.automationMounted === false) {
      const errorDetail = data.automationError ? ` (${data.automationError.slice(0, 120)})` : '';
      checks.push({
        name: 'Automation layer',
        ok: false,
        detail: `Not mounted${errorDetail} — right-click tray icon → Quit → relaunch`,
      });
    } else if (data.automationMounted === true) {
      checks.push({ name: 'Automation layer', ok: true, detail: 'Mounted (NL compiler, voice, agent ready)' });
    }
  } catch (e) {
    checks.push({ name: 'Server', ok: false, detail: e.message });
  }

  // 2. Settings read/write
  try {
    const res = await addonFetch('/api/settings');
    const data = await res.json();
    checks.push({ name: 'Settings', ok: true, detail: `provider=${data.llmProvider || 'local'}` });
  } catch (e) {
    checks.push({ name: 'Settings', ok: false, detail: e.message });
  }

  // 3. Action bridge
  try {
    const res = await addonFetch('/api/actions/bridge-status');
    const data = await res.json();
    checks.push({ name: 'Action bridge', ok: data.connected, detail: data.connected ? 'Connected' : 'Not connected' });
  } catch (e) {
    checks.push({ name: 'Action bridge', ok: false, detail: e.message });
  }

  // 4. Models list
  try {
    const res = await addonFetch('/api/models');
    const data = await res.json();
    const count = data.models?.length ?? 0;
    checks.push({ name: 'Models', ok: count > 0, detail: `${count} available` });
  } catch (e) {
    checks.push({ name: 'Models', ok: false, detail: e.message });
  }

  return { passed: checks.every(c => c.ok), checks };
}

// ─── Self-update (single-click) ─────────────────────────────────────────────
// Bridges to the addon's Electron-side auto-updater (see
// csimple-addon/server/update-bridge.js) so the "Update" button in the UI
// can check → download → install with one click instead of sending the user
// to the GitHub releases page to download+run an installer manually.

/**
 * Get the addon's current self-update state.
 * @returns {Promise<{supported:boolean, state:string, updateAvailable:boolean,
 *   updateDownloaded:boolean, downloadProgress:number, latestVersion:?string,
 *   currentVersion:string}>}
 */
export async function getAddonUpdateStatus() {
  const res = await addonFetch('/api/update/status');
  return res.json();
}

/** Ask the addon to check for an update (download starts automatically if found). */
export async function checkAddonUpdate() {
  const res = await addonFetch('/api/update/check', { method: 'POST' });
  return res.json();
}

/** Quit and install an already-downloaded update, relaunching the addon. */
export async function installAddonUpdate() {
  const res = await addonFetch('/api/update/install', { method: 'POST' });
  return res.json();
}

/**
 * Single-click update flow: trigger a check, poll until the update finishes
 * downloading, then install (relaunching the addon). Resolves once install
 * has been requested; rejects if no update is found or downloading times out.
 *
 * The running addon may predate this feature entirely (no `/api/update/*`
 * routes registered — Express responds "Cannot POST /api/update/check").
 * That failure is reported via `error.code = 'unsupported'` so the caller can
 * fall back to the GitHub-releases download link for this one manual update;
 * every update after that will have the routes and use this flow instead.
 *
 * @param {(state:object)=>void} [onProgress] - called with the latest status on each poll
 */
export async function runAddonSingleClickUpdate(onProgress) {
  try {
    await checkAddonUpdate();
  } catch (e) {
    if (/^Cannot (POST|GET) /.test(e.message || '')) {
      const err = new Error('This addon version predates 1-click updates — download this one manually.');
      err.code = 'unsupported';
      throw err;
    }
    throw e;
  }

  const start = Date.now();
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — generous for slow connections
  const POLL_MS = 1500;

  // Give the updater a moment to move off "idle"/"up-to-date" before polling.
  await new Promise((r) => setTimeout(r, 1000));

  while (Date.now() - start < TIMEOUT_MS) {
    const status = await getAddonUpdateStatus();
    onProgress?.(status);

    if (status.state === 'ready') {
      await installAddonUpdate();
      return status;
    }
    if (status.state === 'up-to-date') {
      throw new Error('Already up to date');
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('Update download timed out — try again shortly');
}



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
 * Compile an English macro description via the PORTFOLIO BACKEND.
 * This is the fallback path used when the addon's automation layer is not mounted.
 * Requires the user to be signed in (uses their stored GitHub PAT from DynamoDB).
 *
 * @param {string} token - User JWT
 * @param {string} description - English macro description
 * @param {string} [context] - Optional environment context
 */
export async function compileMacroNaturalViaBackend(token, description, context) {
  if (!token) throw new Error('Sign in required to use cloud macro compilation');
  let res;
  try {
    res = await fetch(`${getPortfolioApiUrl()}/csimple/compile-natural`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ description, context }),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  // IMPORTANT: never let a 401 bubble up — the global auth interceptor would
  // log the user out. Instead, convert all non-2xx to descriptive Error objects.
  const text = await res.text().catch(() => '');
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = json?.dataMessage || json?.message || json?.error || text || `Compiler error (${res.status})`;
    // Rethrow as plain Error — NOT as a 401 that triggers app-level logout
    throw new Error(msg);
  }
  return json;
}

/**
 * Modify an EXISTING macro's steps via an English instruction, using the
 * PORTFOLIO BACKEND. Fallback path used when the addon's automation layer
 * is not mounted. Requires the user to be signed in (uses their stored
 * GitHub PAT from DynamoDB).
 *
 * @param {string} token - User JWT
 * @param {Array} steps - current step array (either schema)
 * @param {string} instruction - description of the desired change
 * @param {string} [context] - Optional environment context
 */
export async function editMacroNaturalViaBackend(token, steps, instruction, context) {
  if (!token) throw new Error('Sign in required to use cloud macro editing');
  let res;
  try {
    res = await fetch(`${getPortfolioApiUrl()}/csimple/edit-natural`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ steps, instruction, context }),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  const text = await res.text().catch(() => '');
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = json?.dataMessage || json?.message || json?.error || text || `Editor error (${res.status})`;
    throw new Error(msg);
  }
  return json;
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

// ─── Cloud Settings Sync API Methods ────────────────────────────────────────

// Backend-side ciphertext marker for secrets-at-rest. If we ever see one of
// these on the wire it means the backend failed to decrypt (stale deploy,
// JWT_SECRET mismatch, etc.). The frontend MUST refuse to use such a value
// as if it were the real secret — otherwise we'd send ciphertext to GitHub
// and the user would see a confusing "PAT expired" 401.
const ENCRYPTED_PREFIX = 'enc:v1:';
const SENSITIVE_SETTING_KEYS = ['githubToken'];

function scrubEncryptedSecrets(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  for (const key of SENSITIVE_SETTING_KEYS) {
    const v = out[key];
    if (typeof v === 'string' && v.startsWith(ENCRYPTED_PREFIX)) {
      console.warn(`[csimpleApi] Cloud returned undecrypted ${key} — ignoring. Check backend JWT_SECRET / deployment.`);
      out[key] = '';
    }
  }
  return out;
}

/**
 * Get user's CSimple settings from the cloud.
 * @param {string} token - JWT auth token
 * @returns {{ settings: object|null, updatedAt: string|null }}
 */
export async function getCloudSettings(token) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { settings: null, updatedAt: null };
  const data = await res.json();
  if (data?.settings) {
    data.settings = scrubEncryptedSecrets(data.settings);
  }
  return data;
}

/**
 * Save CSimple settings to the cloud.
 * @param {string} token - JWT auth token
 * @param {object} settings - Settings object (sensitive keys will be stripped server-side)
 * @returns {{ success: boolean, updatedAt: string }}
 */
export async function saveCloudSettings(token, settings) {
  // Defensive: never push ciphertext back up as if it were plaintext. If we
  // somehow ended up with an "enc:v1:" value in memory (e.g. from a stale
  // backend), drop it rather than overwriting the real value in the DB.
  const safe = scrubEncryptedSecrets(settings);
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ settings: safe, updatedAt: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error('Failed to save cloud settings');
  return res.json();
}

/**
 * Get user's conversations from the cloud.
 * @param {string} token - JWT auth token
 * @returns {{ conversations: Array|null, updatedAt: string|null }}
 */
export async function getCloudConversations(token) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { conversations: null, updatedAt: null };
  return res.json();
}

/**
 * Save conversations to the cloud.
 * @param {string} token - JWT auth token
 * @param {Array} conversations - Conversations array
 * @returns {{ success: boolean, updatedAt: string }}
 */
export async function saveCloudConversations(token, conversations) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/conversations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversations }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to save conversations: ${text}`);
  }
  return res.json();
}

/**
 * Get user's synced behavior files list from the cloud.
 * @param {string} token - JWT auth token
 * @returns {{ behaviors: Array<{ name: string, updatedAt: string }> }}
 */
export async function getCloudBehaviors(token) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/behaviors`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { behaviors: [] };
  return res.json();
}

/**
 * Get a specific behavior file from the cloud.
 * @param {string} token - JWT auth token
 * @param {string} name - Behavior filename
 * @returns {{ name: string, content: string, updatedAt: string }|null}
 */
export async function getCloudBehavior(token, name) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/behaviors/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Save/update a behavior file to the cloud.
 * @param {string} token - JWT auth token
 * @param {string} name - Behavior filename
 * @param {string} content - Behavior file content
 */
export async function saveCloudBehavior(token, name, content) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/behaviors/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to save behavior to cloud');
  return res.json();
}

/**
 * Delete a behavior file from the cloud.
 * @param {string} token - JWT auth token
 * @param {string} name - Behavior filename
 */
export async function deleteCloudBehavior(token, name) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/behaviors/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to delete behavior from cloud');
  return res.json();
}

// ─── Cloud Memory Files API ─────────────────────────────────────────────────

/**
 * List memory files from the cloud.
 * @param {string} token - JWT auth token
 */
export async function getCloudMemoryFiles(token) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/memory`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { files: [] };
  return res.json();
}

/**
 * Get a specific memory file from the cloud.
 * @param {string} token - JWT auth token
 * @param {string} name - Memory filename
 */
export async function getCloudMemoryFile(token, name) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/memory/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Save/update a memory file to the cloud.
 * @param {string} token - JWT auth token
 * @param {string} name - Memory filename
 * @param {string} content - Memory file content
 */
export async function saveCloudMemoryFile(token, name, content) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/memory/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to save memory file to cloud');
  return res.json();
}

/**
 * Delete a memory file from the cloud.
 * @param {string} token - JWT auth token
 * @param {string} name - Memory filename
 */
export async function deleteCloudMemoryFile(token, name) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/memory/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to delete memory file from cloud');
  return res.json();
}

// ─── Cloud Personality Files API ────────────────────────────────────────────

/**
 * List personality files from the cloud.
 * @param {string} token - JWT auth token
 */
export async function getCloudPersonalityFiles(token) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/personality`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { files: [] };
  return res.json();
}

/**
 * Get a specific personality file from the cloud.
 * @param {string} token - JWT auth token
 * @param {string} name - Personality filename
 */
export async function getCloudPersonalityFile(token, name) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/personality/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Save/update a personality file to the cloud.
 * @param {string} token - JWT auth token
 * @param {string} name - Personality filename
 * @param {string} content - Personality file content
 */
export async function saveCloudPersonalityFile(token, name, content) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/personality/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to save personality file to cloud');
  return res.json();
}

// ─── Cloud User Context (aggregate) ────────────────────────────────────────

/**
 * Fetch aggregate user context (memory + personality + behavior) for LLM injection.
 * @param {string} token - JWT auth token
 * @param {string} [behaviorFile='default.txt'] - Active behavior file name
 */
export async function getCloudUserContext(token, behaviorFile = 'default.txt') {
  const res = await fetch(
    `${getPortfolioApiUrl()}/csimple/context?behavior=${encodeURIComponent(behaviorFile)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return { memoryContext: '', personalityContext: '', behaviorContext: '' };
  return res.json();
}

// ─── Workspace API (OpenClaw-style AI workspace) ───────────────────────────

/**
 * List workspace items, optionally filtered.
 * @param {string} token JWT
 * @param {object} [filters] { kind, agent, stage, tag, q }
 */
export async function listWorkspace(token, filters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== '') params.set(k, v);
  }
  const qs = params.toString();
  const res = await fetch(
    `${getPortfolioApiUrl()}/csimple/workspace${qs ? `?${qs}` : ''}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`listWorkspace failed: ${res.status}`);
  return res.json();
}

/** Read one workspace item. Returns { kind, slug, name, content, ... }. */
export async function getWorkspaceItem(token, kind, slug) {
  const res = await fetch(
    `${getPortfolioApiUrl()}/csimple/workspace/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getWorkspaceItem failed: ${res.status}`);
  return res.json();
}

/**
 * Create or update a workspace item.
 * @param {object} body { name, content, agent?, stage?, tags?, expectedUpdatedAt? }
 */
export async function upsertWorkspaceItem(token, kind, slug, body) {
  const res = await fetch(
    `${getPortfolioApiUrl()}/csimple/workspace/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`upsertWorkspaceItem failed: ${res.status} ${txt}`);
  }
  return res.json();
}

/** Soft-delete a workspace item (hard=true to permanently remove). */
export async function deleteWorkspaceItem(token, kind, slug, { hard = false } = {}) {
  const qs = hard ? '?hard=1' : '';
  const res = await fetch(
    `${getPortfolioApiUrl()}/csimple/workspace/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}${qs}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`deleteWorkspaceItem failed: ${res.status}`);
  return res.json();
}

/** Append a line to today's daily log. */
export async function appendWorkspaceLog(token, text) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/workspace/log/append`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`appendWorkspaceLog failed: ${res.status}`);
  return res.json();
}

/** Preview the assembled workspace context the LLM will see. */
export async function getWorkspaceContextPreview(token, { agent, message } = {}) {
  const params = new URLSearchParams();
  if (agent) params.set('agent', agent);
  if (message) params.set('message', message);
  const qs = params.toString();
  const res = await fetch(
    `${getPortfolioApiUrl()}/csimple/workspace/context${qs ? `?${qs}` : ''}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`getWorkspaceContextPreview failed: ${res.status}`);
  return res.json();
}

/**
 * Aggregate per-tool execution telemetry from the user's action ring buffer.
 * @param {string} token user JWT
 * @param {object} opts
 * @param {number} [opts.days=7] look-back window, capped at 30 server-side
 * @param {string} [opts.tool]   restrict to a single tool name
 * @returns {Promise<{windowDays:number,totalRecords:number,tools:Array}>}
 */
export async function getWorkspaceTelemetrySummary(token, { days, tool } = {}) {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  if (tool) params.set('tool', tool);
  const qs = params.toString();
  const res = await fetch(
    `${getPortfolioApiUrl()}/csimple/workspace/telemetry/summary${qs ? `?${qs}` : ''}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`getWorkspaceTelemetrySummary failed: ${res.status}`);
  return res.json();
}

/** Get core-file templates + kind allow-list + per-kind size caps. */
export async function getWorkspaceTemplates(token) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/workspace/templates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getWorkspaceTemplates failed: ${res.status}`);
  return res.json();
}

// ─── Cloud Relay (phone → backend → desktop addon) ─────────────────────────

/** Cached remote addon state */
let _remoteAddonStatus = {
  online: false,
  lastSeen: null,
  version: null,
  hostname: null,
};

/** Remote addon status listeners */
const _remoteListeners = new Set();

function _notifyRemoteListeners(status) {
  _remoteListeners.forEach(fn => {
    try { fn(status); } catch (e) { console.error('[CSimpleAPI] Remote listener error:', e); }
  });
}

/**
 * Subscribe to remote addon status changes.
 * @param {function} listener - Called with remote status object
 * @returns {function} Unsubscribe function
 */
export function onRemoteAddonStatusChange(listener) {
  _remoteListeners.add(listener);
  return () => _remoteListeners.delete(listener);
}

/**
 * Get the current cached remote addon status.
 */
export function getRemoteAddonStatus() {
  return { ..._remoteAddonStatus };
}

/**
 * Check if the user's addon is online via the backend (cloud relay).
 * @param {string} token - JWT auth token
 */
export async function checkRemoteAddon(token) {
  if (!token) {
    _remoteAddonStatus = { online: false, lastSeen: null, version: null, hostname: null };
    _notifyRemoteListeners(_remoteAddonStatus);
    return _remoteAddonStatus;
  }

  try {
    const res = await fetch(`${getPortfolioApiUrl()}/addon/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error('Failed to check remote addon');
    const data = await res.json();
    _remoteAddonStatus = {
      online: data.online ?? false,
      lastSeen: data.lastSeen ?? null,
      version: data.version ?? null,
      hostname: data.hostname ?? null,
    };
  } catch {
    _remoteAddonStatus = { online: false, lastSeen: null, version: null, hostname: null };
  }

  _notifyRemoteListeners(_remoteAddonStatus);
  return _remoteAddonStatus;
}

/**
 * Register the user's JWT with the local addon to enable cloud relay.
 * Called when the desktop frontend detects a local addon AND the user is logged in.
 * @param {string} token - User's JWT
 */
export async function registerCloudRelay(token) {
  if (!_addonStatus.isConnected || !_addonStatus.baseUrl || !token) return;

  try {
    const res = await fetch(`${_addonStatus.baseUrl}/api/cloud/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      console.log('[CSimpleAPI] Cloud relay registered with local addon');
    }
  } catch (e) {
    console.warn('[CSimpleAPI] Failed to register cloud relay:', e.message);
  }
}

/**
 * Queue a chat command for remote addon execution via the backend.
 * @param {string} token - JWT auth token
 * @param {object} payload - Chat payload (message, modelId, conversationHistory, etc.)
 * @returns {{ commandId: string }}
 */
export async function queueRemoteCommand(token, payload) {
  const res = await fetch(`${getPortfolioApiUrl()}/addon/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'chat', payload }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to queue command: ${text}`);
  }
  return res.json();
}

/**
 * Poll for a remote command result.
 * @param {string} token - JWT auth token
 * @param {string} commandId - Command ID to check
 * @returns {{ status: 'pending'|'completed'|'error', result?, error? }}
 */
export async function getRemoteCommandResult(token, commandId) {
  const res = await fetch(`${getPortfolioApiUrl()}/addon/result/${encodeURIComponent(commandId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to get command result');
  return res.json();
}
