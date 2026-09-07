/**
 * workspaceApi.js — cloud/backend API for Simple (the portfolio backend).
 *
 * Extracted from simpleAddonApi.js: every function here talks to the portfolio
 * backend (`getPortfolioApiUrl()` → `/api/data/...`) — the cloud LLM, cloud
 * settings/conversations/files sync, and the OpenClaw-style workspace store.
 * The local-addon + cloud-relay surface stays in simpleAddonApi.js, which
 * re-exports this module for backward compatibility.
 *
 * Stateless by design — no addon connection state lives in this module.
 */

/** Base URL for the portfolio backend (Vite proxies this in dev). */
export function getPortfolioApiUrl() {
  // In development, proxy handles this. In production, use the deployed URL.
  return '/api/data';
}

/**
 * fetch() with retry/backoff for cloud bootstrap requests. During local
 * development Vite's proxy answers 500 while the backend is still booting
 * (or nodemon is restarting), so retry network failures and 5xx responses a
 * few times before giving up.
 */
export async function fetchWithRetry(url, options, { retries = 4, delayMs = 500 } = {}) {
  let lastRes = null;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res;
      lastRes = res; // 5xx — backend likely still booting; retry
    } catch (err) {
      lastErr = err; // network error — backend not reachable yet
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, delayMs * 2 ** attempt));
    }
  }
  if (lastRes) return lastRes; // surface the final 5xx response to the caller
  throw lastErr || new Error('fetch failed');
}

/**
 * Turn a non-2xx JSON error body into an Error with rate-limit metadata
 * attached (status, limiter id, retryAfterSeconds), and append a human
 * "(retry in Xm)" hint to the message when the server told us how long to
 * wait — so 429s are actionable instead of just a raw generic string.
 */
function _errorFromResponse(res, json, text, fallback) {
  const msg = json?.dataMessage || json?.message || json?.error || text || fallback;
  const retryAfterSeconds = json?.retryAfterSeconds;
  let fullMsg = msg;
  if (retryAfterSeconds && !/retry in|try again in/i.test(msg)) {
    const mins = Math.ceil(retryAfterSeconds / 60);
    fullMsg = `${msg} (retry in ~${mins} minute${mins === 1 ? '' : 's'})`;
  }
  const err = new Error(fullMsg);
  err.status = res.status;
  if (json?.limiter) err.limiter = json.limiter;
  if (retryAfterSeconds !== undefined) err.retryAfterSeconds = retryAfterSeconds;
  return err;
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
  const text = await res.text().catch(() => '');
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    // Rethrow as plain Error — NOT as a 401 that triggers app-level logout
    throw _errorFromResponse(res, json, text, `Compiler error (${res.status})`);
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
    throw _errorFromResponse(res, json, text, `Editor error (${res.status})`);
  }
  return json;
}

/**
 * Get LLM providers from the portfolio backend.
 */
export async function getPortfolioLLMProviders(token) {
  const res = await fetchWithRetry(`${getPortfolioApiUrl()}/llm-providers`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to fetch LLM providers');
  return res.json();
}

// ─── Cloud Settings Sync API Methods ────────────────────────────────────────

// Backend-side ciphertext marker for secrets-at-rest. GitHub PAT support has
// been fully retired along with GitHub Models — this list is now empty, but
// the scrub machinery is kept generic so any future sensitive setting can
// opt in the same way.
const ENCRYPTED_PREFIX = 'enc:v1:';
const SENSITIVE_SETTING_KEYS = [];

function scrubEncryptedSecrets(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  for (const key of SENSITIVE_SETTING_KEYS) {
    const v = out[key];
    if (typeof v === 'string' && v.startsWith(ENCRYPTED_PREFIX)) {
      console.warn(`[simpleAddonApi] Cloud returned undecrypted ${key} — ignoring. Check backend JWT_SECRET / deployment.`);
      out[key] = '';
    }
  }
  return out;
}

/**
 * Get user's Simple settings from the cloud.
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
 * Save Simple settings to the cloud.
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

// ─── Cloud conversation merge (bidirectional sync) ─────────────────────────

const DELETED_CONVOS_KEY = 'csimple_deleted_convo_ids';

/** Get locally-recorded conversation deletion tombstones (array of ids). */
export function getDeletedConversationIds() {
  try {
    const raw = localStorage.getItem(DELETED_CONVOS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Record a conversation id as deleted so it stays deleted across devices. */
export function addDeletedConversationId(id) {
  if (id == null) return;
  try {
    const ids = getDeletedConversationIds();
    const sid = String(id);
    if (!ids.includes(sid)) {
      ids.push(sid);
      localStorage.setItem(DELETED_CONVOS_KEY, JSON.stringify(ids));
    }
  } catch { /* localStorage unavailable */ }
}

/**
 * Replace the locally-recorded deletion tombstones with the authoritative
 * server-persisted set. Called after every merge so every device converges on
 * the same deleted-conversation list (server wins on the union).
 * @param {Array<string|number>} ids - Deletion tombstones
 */
export function setDeletedConversationIds(ids) {
  try {
    const clean = Array.isArray(ids) ? ids.map(String) : [];
    localStorage.setItem(DELETED_CONVOS_KEY, JSON.stringify(clean));
  } catch { /* localStorage unavailable */ }
}

/**
 * Merge local conversations with the cloud copy (server-side union by
 * conversation id + per-message id), returning the authoritative merged list.
 * This is used for BOTH initial pull and debounced save so that:
 *   - conversations created on other devices appear here, and
 *   - same-id conversations (e.g. the default "New Chat") merge messages
 *     instead of one device silently overwriting the other.
 * @param {string} token - JWT auth token
 * @param {Array} conversations - Local conversations array
 * @param {Array<string>} [deletedIds] - Deletion tombstones
 * @returns {{ conversations: Array, updatedAt: string }}
 */
export async function mergeCloudConversations(token, conversations, deletedIds = []) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/conversations/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversations, deletedIds }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to merge conversations: ${text}`);
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
